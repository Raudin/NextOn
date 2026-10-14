package main

import (
	"encoding/json"
	"fmt"
	"log"
	"strconv"
	"time"

	"gorm.io/gorm"
)

// Per-user versioning: the foundation for both ETag revalidation and delta
// sync.
//
// One number per user advances on every mutation. It drives two things:
//
//  1. The ETag on a user's derived payloads, so the client's periodic
//     revalidation becomes a header comparison instead of a rebuild.
//  2. The cursor for delta sync, so a client that was offline for a day can ask
//     for "everything after version N" instead of re-downloading its whole
//     library.
//
// Crucially this lives in the database, not Redis. The Redis layer is a pure
// performance tier that may be absent; correctness must not depend on it.

// syncOpRetention bounds a user's change log. A client that has been offline
// longer than this falls back to a full resync, which the client detects from
// the `resync_required` flag rather than silently missing changes.
const syncOpRetention = 2000

// initialUserVersion is the version of a user who has never mutated anything.
//
// The first mutation must advance *past* this value. If it did not, a client
// that had cached a payload at the initial version would be served a 304 after
// the user's first change and never see it — the exact failure mode ETags are
// supposed to prevent.
const initialUserVersion = 1

// currentUserVersion returns the user's latest version. A user with no state
// row yet is at the initial version.
func currentUserVersion(userID uint) uint64 {
	var state UserSyncState
	if err := db.First(&state, "user_id = ?", userID).Error; err != nil {
		return initialUserVersion
	}
	if state.Version < initialUserVersion {
		return initialUserVersion
	}
	return state.Version
}

// bumpUserVersion atomically advances the user's version and returns the new
// value.
//
// The increment is expressed as `version = version + 1` in SQL so two
// concurrent mutations cannot both compute the same next value from a stale
// read. The read-back may observe a *later* version than this call produced
// (another writer got there first), which is harmless: versions only need to be
// monotonic, not unique per writer.
func bumpUserVersion(userID uint) uint64 {
	return bumpUserVersionTx(db, userID)
}

// bumpUserVersionTx is bumpUserVersion bound to a transaction, so a bulk write
// advances the version exactly once inside the same transaction as its rows.
func bumpUserVersionTx(tx *gorm.DB, userID uint) uint64 {
	result := tx.Model(&UserSyncState{}).
		Where("user_id = ?", userID).
		UpdateColumn("version", gorm.Expr("version + 1"))

	if result.Error == nil && result.RowsAffected > 0 {
		return currentUserVersionTx(tx, userID)
	}

	// No state row yet. It is created already advanced, so that the first
	// mutation is observable as a version change.
	if err := tx.Create(&UserSyncState{
		UserID:  userID,
		Version: initialUserVersion + 1,
	}).Error; err != nil {
		// Lost a race with a concurrent creator; whatever is committed is
		// authoritative.
		return currentUserVersionTx(tx, userID)
	}
	return initialUserVersion + 1
}

// currentUserVersionTx is currentUserVersion bound to a transaction.
func currentUserVersionTx(tx *gorm.DB, userID uint) uint64 {
	var state UserSyncState
	if err := tx.First(&state, "user_id = ?", userID).Error; err != nil {
		return initialUserVersion
	}
	if state.Version < initialUserVersion {
		return initialUserVersion
	}
	return state.Version
}

// pendingSyncOp is a change-log entry that has been decided but not yet written.
// Bulk writers collect these and persist them in one batch.
type pendingSyncOp struct {
	collection string
	opType     string
	entityKey  string
	payload    any
}

// encodeSyncPayload renders an entity as the JSON a client stores. Returns ""
// for a delete (nil payload) and for an entity that cannot be encoded, so a
// single unserialisable row cannot abort a batch.
func encodeSyncPayload(collection, entityKey string, payload any) string {
	if payload == nil {
		return ""
	}
	raw, err := json.Marshal(payload)
	if err != nil {
		log.Printf("Sync: failed to encode payload for %s/%s: %v", collection, entityKey, err)
		return ""
	}
	return string(raw)
}

// recordSyncOp appends a change-log entry and returns the version it was
// recorded at.
//
// Every mutation handler calls this. `payload` should be the entity as the
// client should store it (nil for a delete), so the client can apply a delta
// without a follow-up fetch.
func recordSyncOp(userID uint, collection, opType, entityKey string, payload any) uint64 {
	version := bumpUserVersion(userID)

	op := SyncOp{
		UserID:     userID,
		Version:    version,
		Collection: collection,
		OpType:     opType,
		EntityKey:  entityKey,
		Payload:    encodeSyncPayload(collection, entityKey, payload),
		CreatedAt:  time.Now(),
	}
	if err := db.Create(&op).Error; err != nil {
		log.Printf("Sync: failed to record %s %s for user %d: %v", opType, collection, userID, err)
	}

	pruneSyncOps(userID)
	return version
}

// recordSyncOpsTx writes a whole batch of change-log entries inside one
// transaction at a single version.
//
// This replaces the per-item path for bulk writes, which called recordSyncOp
// once per item and therefore: bumped the version once per item (retiring every
// derived cache and every client's ETag N times), ran the COUNT+prune cycle N
// times, and issued N single-row INSERTs. A 2,000-episode mark could push the
// change log past its retention window on its own, forcing every other device
// into a full resync.
//
// Returns false when the batch could not be recorded; the caller must treat
// that as a failed request, not a partial success.
func recordSyncOpsTx(tx *gorm.DB, userID uint, ops []pendingSyncOp) bool {
	if len(ops) == 0 {
		return true
	}

	version := bumpUserVersionTx(tx, userID)
	now := time.Now()

	rows := make([]SyncOp, 0, len(ops))
	for _, op := range ops {
		rows = append(rows, SyncOp{
			UserID:     userID,
			Version:    version,
			Collection: op.collection,
			OpType:     op.opType,
			EntityKey:  op.entityKey,
			Payload:    encodeSyncPayload(op.collection, op.entityKey, op.payload),
			CreatedAt:  now,
		})
	}

	if err := tx.CreateInBatches(&rows, 200).Error; err != nil {
		log.Printf("Sync: failed to record %d changes for user %d: %v", len(rows), userID, err)
		return false
	}

	pruneSyncOpsTx(tx, userID)
	return true
}

// recordCollectionClearTx records that an entire collection was cleared and
// truncates the change log so that entry is the resync boundary.
//
// The sentinel entry alone is not enough. needsFullResync decides from the
// OLDEST retained entry, so an entry sitting mid-log would let a client with an
// older cursor receive an ordinary delta: it would replay every earlier upsert
// and end up holding rows the server has already deleted. Deleting the older
// entries makes such a cursor fall out of the retention window, which is the
// existing, well-tested signal for "drop your copy and sync from scratch".
//
// Returns false when the change could not be recorded; the caller must treat
// that as a failed request.
func recordCollectionClearTx(tx *gorm.DB, userID uint, collection string) bool {
	if !recordSyncOpsTx(tx, userID, []pendingSyncOp{{
		collection: collection,
		opType:     syncOpDelete,
		entityKey:  syncCollectionDeleteKey,
	}}) {
		return false
	}

	boundary := currentUserVersionTx(tx, userID)
	return tx.Where("user_id = ? AND version < ?", userID, boundary).
		Delete(&SyncOp{}).Error == nil
}

// pruneSyncOps trims a user's change log to the retention window, keeping the
// newest entries. Runs opportunistically rather than on a timer so it costs
// nothing when a user is idle.
func pruneSyncOps(userID uint) {
	pruneSyncOpsTx(db, userID)
}

func pruneSyncOpsTx(tx *gorm.DB, userID uint) {
	var count int64
	if err := tx.Model(&SyncOp{}).Where("user_id = ?", userID).Count(&count).Error; err != nil {
		return
	}
	if count <= syncOpRetention {
		return
	}

	// Find the version at the retention boundary and delete everything older.
	var boundary SyncOp
	err := tx.Where("user_id = ?", userID).
		Order("version DESC").
		Offset(syncOpRetention - 1).
		Limit(1).
		First(&boundary).Error
	if err != nil {
		return
	}

	tx.Where("user_id = ? AND version < ?", userID, boundary.Version).Delete(&SyncOp{})
}

// needsFullResync reports whether a client at cursor `since` can still be
// brought up to date incrementally.
//
// The change log is pruned, so a cursor that predates the oldest retained entry
// cannot be served a complete delta. Reporting that explicitly lets the client
// drop its local copy and resync, rather than silently missing changes and
// drifting permanently out of sync.
func needsFullResync(userID uint, since uint64) bool {
	if since == 0 {
		// No cursor: the client is doing a first sync, which is a full sync by
		// definition and must not be flagged as needing one.
		return false
	}

	var oldest SyncOp
	if err := db.Where("user_id = ?", userID).Order("version ASC").Limit(1).First(&oldest).Error; err != nil {
		// No change log exists. If the client claims an older version than the
		// user's current state, its copy cannot be reconciled incrementally
		// (the log was pruned, or this is a fresh database).
		return currentUserVersion(userID) > since
	}

	// `oldest.Version - 1` is the last version that may have been pruned. A
	// client at or beyond it can still be served; anything earlier cannot.
	return since < oldest.Version-1
}

// SyncCollectionState reports one collection's version and size. The client
// uses it to decide whether a delta is worth requesting.
type SyncCollectionState struct {
	Version uint64 `json:"version"`
	Count   int64  `json:"count"`
}

// SyncStateResponse is the cheap "do I need to sync?" probe.
type SyncStateResponse struct {
	Version     uint64                         `json:"version"`
	Collections map[string]SyncCollectionState `json:"collections"`
}

// SyncChangeResponse is a delta: every change after the client's cursor.
type SyncChangeResponse struct {
	Version uint64   `json:"version"`
	Changes []SyncOp `json:"changes"`
	// ResyncRequired is set when the client's cursor has fallen out of the
	// retention window, so the change list is incomplete. The client must then
	// drop its local copy and do a full sync rather than trusting a partial
	// delta.
	ResyncRequired bool `json:"resync_required"`
}

// highestCollectionVersion returns the latest version at which a collection
// changed, or 0 when it never has.
func highestCollectionVersion(userID uint, collection string) uint64 {
	var op SyncOp
	err := db.Where("user_id = ? AND collection = ?", userID, collection).
		Order("version DESC").
		Limit(1).
		First(&op).Error
	if err != nil {
		return 0
	}
	return op.Version
}

// syncCollectionDeleteKey is the entity key of a change-log entry that means
// "this whole collection was cleared", as opposed to one row being removed.
//
// A row-level delete names a media identity ("tv:1396:2:7"), and clients apply
// it by removing exactly that row. "Clear my watch history" removes an
// unbounded number of rows with no enumerable key list, so it is expressed as
// one collection-level entry instead. Clients must recognise this sentinel and
// drop the whole local collection; the old code recorded no entry at all, so
// the client was never told anything had changed.
const syncCollectionDeleteKey = "*"

// mediaTypeForEntityKey normalizes the media type that goes into a change-log
// key.
//
// Both the write path and the delete path must derive the key the same way, or
// a delete would not match the entity the client already stored. Defaulting an
// unset type to "movie" mirrors watchlistMediaType's own fallback for the rows
// that predate the field being populated.
func mediaTypeForEntityKey(mediaType string) string {
	if mediaType == "tv" {
		return "tv"
	}
	return "movie"
}

// watchlistEntityKey builds the stable identity string used by the change log
// and by clients applying a delta.
func watchlistEntityKey(mediaType string, mediaID int64) string {
	return mediaTypeForEntityKey(mediaType) + ":" + strconv.FormatInt(mediaID, 10)
}

func watchedEntityKey(mediaType string, mediaID int64, seasonNumber, episodeNumber *int64) string {
	key := mediaTypeForEntityKey(mediaType) + ":" + strconv.FormatInt(mediaID, 10)
	if seasonNumber != nil && episodeNumber != nil {
		key += fmt.Sprintf(":%d:%d", *seasonNumber, *episodeNumber)
	}
	return key
}
