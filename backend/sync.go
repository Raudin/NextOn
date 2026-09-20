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
	result := db.Model(&UserSyncState{}).
		Where("user_id = ?", userID).
		UpdateColumn("version", gorm.Expr("version + 1"))

	if result.Error == nil && result.RowsAffected > 0 {
		return currentUserVersion(userID)
	}

	// No state row yet. It is created already advanced, so that the first
	// mutation is observable as a version change.
	if err := db.Create(&UserSyncState{
		UserID:  userID,
		Version: initialUserVersion + 1,
	}).Error; err != nil {
		// Lost a race with a concurrent creator; whatever is committed is
		// authoritative.
		return currentUserVersion(userID)
	}
	return initialUserVersion + 1
}

// recordSyncOp appends a change-log entry and returns the version it was
// recorded at.
//
// Every mutation handler calls this. `payload` should be the entity as the
// client should store it (nil for a delete), so the client can apply a delta
// without a follow-up fetch.
func recordSyncOp(userID uint, collection, opType, entityKey string, payload any) uint64 {
	version := bumpUserVersion(userID)

	encoded := ""
	if payload != nil {
		if raw, err := json.Marshal(payload); err == nil {
			encoded = string(raw)
		} else {
			log.Printf("Sync: failed to encode payload for %s/%s: %v", collection, entityKey, err)
		}
	}

	op := SyncOp{
		UserID:     userID,
		Version:    version,
		Collection: collection,
		OpType:     opType,
		EntityKey:  entityKey,
		Payload:    encoded,
		CreatedAt:  time.Now(),
	}
	if err := db.Create(&op).Error; err != nil {
		log.Printf("Sync: failed to record %s %s for user %d: %v", opType, collection, userID, err)
	}

	pruneSyncOps(userID)
	return version
}

// pruneSyncOps trims a user's change log to the retention window, keeping the
// newest entries. Runs opportunistically rather than on a timer so it costs
// nothing when a user is idle.
func pruneSyncOps(userID uint) {
	var count int64
	if err := db.Model(&SyncOp{}).Where("user_id = ?", userID).Count(&count).Error; err != nil {
		return
	}
	if count <= syncOpRetention {
		return
	}

	// Find the version at the retention boundary and delete everything older.
	var boundary SyncOp
	err := db.Where("user_id = ?", userID).
		Order("version DESC").
		Offset(syncOpRetention - 1).
		Limit(1).
		First(&boundary).Error
	if err != nil {
		return
	}

	db.Where("user_id = ? AND version < ?", userID, boundary.Version).Delete(&SyncOp{})
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
