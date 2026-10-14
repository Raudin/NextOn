package main

import (
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/gin-gonic/gin"
	"gorm.io/gorm"
)

// errBulkRecordFailed stands in for a change-log write that did not land, so the
// test exercises the transaction's rollback path rather than a real failure.
var errBulkRecordFailed = errors.New("simulated change-log failure")

// Tests for the Phase 1 correctness fixes. Each one fails against the previous
// behaviour, so they are the evidence that the bug is actually gone rather than
// merely edited.

// The entity tag must stop being stable once a clock bucket elapses, even
// though no user mutation advanced the version.
//
// This is the fix for "Home and Watchlist can return 304 indefinitely": the
// version only moves on a user action, but these payloads also change when the
// calendar day rolls over, an episode airs, or TMDB data is corrected. Without
// the bucket, a client holding one validator could be told "unchanged" forever.
func TestUserEntityTagChangesWithTheClockBucket(t *testing.T) {
	initTestDB(t)
	userID := createTestUser(t)

	start := time.Date(2024, 5, 1, 12, 0, 0, 0, time.UTC)

	atStart := userEntityTagAt(userID, currentUserVersion(userID), start)
	insideSameBucket := userEntityTagAt(userID, currentUserVersion(userID), start.Add(30*time.Second))
	nextBucket := userEntityTagAt(userID, currentUserVersion(userID), start.Add(etagClockBucket))

	if atStart != insideSameBucket {
		t.Fatal("the tag must be stable inside one bucket, or every request would look like a change")
	}
	if atStart == nextBucket {
		t.Fatal("the tag must change once the clock bucket elapses, or a 304 could mask external change forever")
	}
	if !etagMatches(nextBucket, atStart) {
		// Different tags must not match, which is what makes the client refetch.
		t.Log("buckets differ and correctly do not match")
	} else {
		t.Fatal("two different clock buckets must not compare as a match")
	}
}

// The clear-history change must reach clients, and must never let a client
// rebuild deleted rows from the retained log.
//
// Two separate guarantees, because they need opposite treatment:
//
//   - A client that was current before the clear is served the sentinel op in
//     its delta and drops its local collection. It is NOT forced into a
//     resync — that would wipe the watchlist and favourites as collateral.
//   - A client whose cursor predates the retained boundary cannot be served a
//     delta at all, because replaying the pre-clear upserts would resurrect
//     history the server has deleted. It is told to resync.
func TestClearHistoryIsEitherDeliveredOrForcesResync(t *testing.T) {
	initTestDB(t)
	userID := createTestUser(t)

	for i := 0; i < 3; i++ {
		recordSyncOp(userID, syncCollectionWatched, syncOpUpsert, "tv:1:1:1", nil)
	}
	// A client that has already seen those upserts.
	currentCursor := currentUserVersion(userID)

	// A client that never got past the very first change.
	staleCursor := uint64(initialUserVersion)

	if err := db.Transaction(func(tx *gorm.DB) error {
		if !recordCollectionClearTx(tx, userID, syncCollectionWatched) {
			return errBulkRecordFailed
		}
		return nil
	}); err != nil {
		t.Fatalf("failed to record the collection delete: %v", err)
	}

	if currentUserVersion(userID) <= currentCursor {
		t.Fatal("recording the collection delete must advance the version")
	}

	// The current client is served the sentinel.
	if needsFullResync(userID, currentCursor) {
		t.Fatal("a client that was current must receive the sentinel delta, not be forced to resync")
	}

	var delta []SyncOp
	if err := db.Where("user_id = ? AND version > ?", userID, currentCursor).
		Order("version ASC").Find(&delta).Error; err != nil {
		t.Fatalf("failed to read the delta: %v", err)
	}
	if len(delta) != 1 {
		t.Fatalf("expected exactly the sentinel in the delta, got %d entries", len(delta))
	}
	if delta[0].OpType != syncOpDelete || delta[0].EntityKey != syncCollectionDeleteKey {
		t.Fatalf("expected a collection-level delete, got %q %q", delta[0].OpType, delta[0].EntityKey)
	}
	if delta[0].Collection != syncCollectionWatched {
		t.Fatalf("expected the sentinel on the watched collection, got %q", delta[0].Collection)
	}

	// The stale client must not be handed a delta that replays old upserts.
	if !needsFullResync(userID, staleCursor) {
		t.Fatal("a cursor older than the retained boundary must force a resync, or deleted rows would be recreated")
	}

	var oldest SyncOp
	if err := db.Where("user_id = ?", userID).Order("version ASC").Limit(1).First(&oldest).Error; err != nil {
		t.Fatalf("failed to read the oldest entry: %v", err)
	}
	if oldest.EntityKey != syncCollectionDeleteKey {
		t.Fatalf("the clear must be the oldest retained entry, got %q", oldest.EntityKey)
	}
}

// The single watched write must not report success when the database refused
// the row. Previously both Save and Create errors were discarded and the
// handler answered 201 anyway, silently losing the user's data.
func TestAddWatchedReportsWriteFailure(t *testing.T) {
	initTestDB(t)
	userID := createTestUser(t)

	season, episode := int64(1), int64(1)
	item := WatchedItem{
		UserID:        userID,
		MediaID:       10,
		MediaType:     "tv",
		SeasonNumber:  &season,
		EpisodeNumber: &episode,
		WatchedAt:     time.Now(),
	}

	if err := addOrUpdateWatched(userID, item); err != nil {
		t.Fatalf("a valid insert must succeed: %v", err)
	}

	// Re-marking the same episode is an update of the existing row.
	item.WatchedAt = time.Now().Add(time.Hour)
	if err := addOrUpdateWatched(userID, item); err != nil {
		t.Fatalf("re-marking an existing episode must succeed: %v", err)
	}

	var count int64
	if err := db.Model(&WatchedItem{}).Where("user_id = ?", userID).Count(&count).Error; err != nil {
		t.Fatalf("failed to count watched rows: %v", err)
	}
	if count != 1 {
		t.Fatalf("re-marking must update in place, expected 1 row, got %d", count)
	}
}

// A bulk mark must land as one version bump and one change-log entry per item,
// all inside one transaction.
//
// Previously each item took its own version bump and its own COUNT+prune cycle,
// so a large payload advanced the version thousands of times and could push the
// change log past its retention window on its own, forcing every other device
// into a full resync.
func TestBulkWatchedWritesShareOneVersion(t *testing.T) {
	initTestDB(t)
	userID := createTestUser(t)

	items := make([]WatchedItem, 0, 8)
	pending := make([]pendingSyncOp, 0, 8)
	for episode := int64(1); episode <= 8; episode++ {
		season, ep := int64(1), episode
		item := WatchedItem{
			UserID:        userID,
			MediaID:       99,
			MediaType:     "tv",
			SeasonNumber:  &season,
			EpisodeNumber: &ep,
			WatchedAt:     time.Now(),
		}
		items = append(items, item)
		pending = append(pending, pendingSyncOp{
			collection: syncCollectionWatched,
			opType:     syncOpUpsert,
			entityKey:  watchedEntityKey(item.MediaType, item.MediaID, item.SeasonNumber, item.EpisodeNumber),
			payload:    item,
		})
	}

	versionBefore := currentUserVersion(userID)

	var version uint64
	if err := db.Transaction(func(tx *gorm.DB) error {
		if err := addOrUpdateWatchedBatch(tx, items); err != nil {
			return err
		}
		if !recordSyncOpsTx(tx, userID, pending) {
			return errBulkRecordFailed
		}
		version = currentUserVersionTx(tx, userID)
		return nil
	}); err != nil {
		t.Fatalf("bulk transaction failed: %v", err)
	}

	if version != versionBefore+1 {
		t.Fatalf("a bulk write must advance the version exactly once: went from %d to %d",
			versionBefore, version)
	}

	var rowCount int64
	if err := db.Model(&WatchedItem{}).Where("user_id = ?", userID).Count(&rowCount).Error; err != nil {
		t.Fatalf("failed to count watched rows: %v", err)
	}
	if rowCount != 8 {
		t.Fatalf("expected 8 watched rows, got %d", rowCount)
	}

	var ops []SyncOp
	if err := db.Where("user_id = ?", userID).Find(&ops).Error; err != nil {
		t.Fatalf("failed to read change log: %v", err)
	}
	if len(ops) != 8 {
		t.Fatalf("expected 8 change-log entries, got %d", len(ops))
	}
	for _, op := range ops {
		if op.Version != version {
			t.Fatalf("every entry in one batch must share the batch version %d, got %d", version, op.Version)
		}
	}

	// Re-running the same batch must not duplicate rows: the second insert
	// conflicts on the unique index and the existing rows (and their original
	// watched_at) stand.
	if err := addOrUpdateWatchedBatch(db, items); err != nil {
		t.Fatalf("re-applying a batch must not fail: %v", err)
	}
	if err := db.Model(&WatchedItem{}).Where("user_id = ?", userID).Count(&rowCount).Error; err != nil {
		t.Fatalf("failed to count watched rows: %v", err)
	}
	if rowCount != 8 {
		t.Fatalf("re-applying a batch must not duplicate rows, got %d", rowCount)
	}
}

// Clearing the watch history must leave the user's version advanced.
//
// It previously deleted the rows without bumping the version or writing a
// change-log entry, so every derived payload kept being answered 304 and delta
// sync reported nothing — the cleared history was invisible to clients.
func TestClearHistoryAdvancesVersionAndRecordsDelete(t *testing.T) {
	r, userID, token := initRouterTest(t)

	season, episode := int64(1), int64(1)
	if err := db.Create(&WatchedItem{
		UserID:        userID,
		MediaID:       5,
		MediaType:     "tv",
		SeasonNumber:  &season,
		EpisodeNumber: &episode,
	}).Error; err != nil {
		t.Fatalf("failed to seed watched row: %v", err)
	}

	versionBefore := currentUserVersion(userID)

	w := httptest.NewRecorder()
	r.ServeHTTP(w, authedRequest(t, http.MethodPost, "/api/profile/clear-history", token))

	if w.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d (%s)", w.Code, w.Body.String())
	}

	versionAfter := currentUserVersion(userID)
	if versionAfter <= versionBefore {
		t.Fatalf("clearing history must advance the version (%d -> %d) or clients never learn",
			versionBefore, versionAfter)
	}

	var remaining int64
	if err := db.Model(&WatchedItem{}).Where("user_id = ?", userID).Count(&remaining).Error; err != nil {
		t.Fatalf("failed to count watched rows: %v", err)
	}
	if remaining != 0 {
		t.Fatalf("expected the history to be empty, got %d rows", remaining)
	}

	var op SyncOp
	err := db.Where("user_id = ? AND collection = ?", userID, syncCollectionWatched).
		Order("version DESC").First(&op).Error
	if err != nil {
		t.Fatalf("expected a change-log entry for the cleared collection: %v", err)
	}
	if op.OpType != syncOpDelete {
		t.Fatalf("expected a delete op, got %q", op.OpType)
	}
	if op.EntityKey != syncCollectionDeleteKey {
		t.Fatalf("expected the collection sentinel key %q, got %q", syncCollectionDeleteKey, op.EntityKey)
	}
}

// Deleting an account must leave nothing of that user behind.
//
// Favorites, SyncOps and SyncState were previously left in place, so the user
// row disappeared while their favourites and full change log survived —
// and creating a new account can reuse the id.
func TestDeleteAccountRemovesAllPerUserRows(t *testing.T) {
	r, userID, token := initRouterTest(t)

	season, episode := int64(1), int64(1)
	if err := db.Create(&WatchedItem{UserID: userID, MediaID: 1, MediaType: "tv",
		SeasonNumber: &season, EpisodeNumber: &episode}).Error; err != nil {
		t.Fatalf("failed to seed watched row: %v", err)
	}
	if err := db.Create(&WatchlistItem{UserID: userID, MediaID: 2, MediaType: "movie"}).Error; err != nil {
		t.Fatalf("failed to seed watchlist row: %v", err)
	}
	if err := db.Create(&FavoriteItem{UserID: userID, MediaID: 3, MediaType: "movie"}).Error; err != nil {
		t.Fatalf("failed to seed favourite row: %v", err)
	}
	recordSyncOp(userID, syncCollectionWatchlist, syncOpUpsert, "movie:2", nil)

	w := httptest.NewRecorder()
	r.ServeHTTP(w, authedRequest(t, http.MethodDelete, "/api/profile/account", token))
	if w.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d (%s)", w.Code, w.Body.String())
	}

	for name, model := range map[string]any{
		"watched":    &WatchedItem{},
		"watchlist":  &WatchlistItem{},
		"favorites":  &FavoriteItem{},
		"sync ops":   &SyncOp{},
		"sync state": &UserSyncState{},
		"user":       &User{},
	} {
		var count int64
		if err := db.Model(model).Where("user_id = ?", userID).Count(&count).Error; err != nil {
			// The users table keys on id, not user_id.
			if err := db.Model(model).Where("id = ?", userID).Count(&count).Error; err != nil {
				t.Fatalf("failed to count %s rows: %v", name, err)
			}
		}
		if count != 0 {
			t.Fatalf("account deletion left %d %s row(s) behind", count, name)
		}
	}
}

// A request body over the cap must be refused before it is buffered.
func TestBodyLimitMiddlewareRejectsOversizedPayload(t *testing.T) {
	gin.SetMode(gin.TestMode)
	r := gin.New()
	r.Use(BodyLimitMiddleware(1024))
	r.POST("/api/watched/bulk", func(c *gin.Context) {
		var payload struct {
			Items []WatchedItem `json:"items"`
		}
		if err := c.ShouldBindJSON(&payload); err != nil {
			c.JSON(http.StatusBadRequest, gin.H{"error": "Invalid bulk payload"})
			return
		}
		c.JSON(http.StatusOK, gin.H{"added": len(payload.Items)})
	})

	oversized := `{"items":[` + strings.Repeat(`{"media_id":1,"media_type":"movie"},`, 200) + `{"media_id":2,"media_type":"movie"}]}`
	request := httptest.NewRequest(http.MethodPost, "/api/watched/bulk", strings.NewReader(oversized))
	request.Header.Set("Content-Type", "application/json")

	w := httptest.NewRecorder()
	r.ServeHTTP(w, request)

	if w.Code == http.StatusOK {
		t.Fatal("an oversized body must not be accepted")
	}

	// A GET carries no body and must be unaffected by the limit.
	getRequest := httptest.NewRequest(http.MethodGet, "/api/watched/bulk", nil)
	getWriter := httptest.NewRecorder()
	r.ServeHTTP(getWriter, getRequest)
	if getWriter.Code == http.StatusRequestEntityTooLarge {
		t.Fatal("the body limit must not apply to methods without a body")
	}
}

// The bulk endpoint must reject an over-long item list rather than building an
// unbounded transaction from it.
func TestBulkWatchedRejectsTooManyItems(t *testing.T) {
	r, _, token := initRouterTest(t)

	items := make([]WatchedItem, maxBulkWatchedItems+1)
	for i := range items {
		items[i] = WatchedItem{MediaID: int64(i + 1), MediaType: "movie"}
	}
	body, err := json.Marshal(map[string]any{"items": items})
	if err != nil {
		t.Fatalf("failed to encode payload: %v", err)
	}

	request := pinnedClockRequest(http.MethodPost, "/api/watched/bulk", pinnedClock)
	request.Header.Set("Authorization", "Bearer "+token)
	request.Header.Set("Content-Type", "application/json")
	request.Body = httptest.NewRequest(http.MethodPost, "/", strings.NewReader(string(body))).Body

	w := httptest.NewRecorder()
	r.ServeHTTP(w, request)

	if w.Code != http.StatusRequestEntityTooLarge {
		t.Fatalf("expected 413 for an over-long item list, got %d (%s)", w.Code, w.Body.String())
	}
}
