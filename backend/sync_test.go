package main

import (
	"testing"
)

func TestCurrentUserVersionStartsAtOne(t *testing.T) {
	initTestDB(t)
	userID := createTestUser(t)

	if got := currentUserVersion(userID); got != 1 {
		t.Fatalf("expected a fresh user to be at version 1, got %d", got)
	}
}

func TestBumpUserVersionIsMonotonic(t *testing.T) {
	initTestDB(t)
	userID := createTestUser(t)

	var previous uint64
	for i := 0; i < 5; i++ {
		got := bumpUserVersion(userID)
		if got < previous {
			t.Fatalf("version went backwards: %d then %d", previous, got)
		}
		previous = got
	}

	if got := currentUserVersion(userID); got != previous {
		t.Fatalf("expected the persisted version %d to match the last bump %d", got, previous)
	}
	if previous < 2 {
		t.Fatalf("expected five bumps to advance the version well past 1, got %d", previous)
	}
}

func TestBumpUserVersionIsIndependentPerUser(t *testing.T) {
	initTestDB(t)
	first := createTestUser(t)

	second := User{Email: "other@example.com", PasswordHash: "x", Name: "Other"}
	if err := db.Create(&second).Error; err != nil {
		t.Fatalf("failed to create second user: %v", err)
	}

	for i := 0; i < 3; i++ {
		bumpUserVersion(first)
	}

	if got := currentUserVersion(second.ID); got != 1 {
		t.Fatalf("the second user's version must be untouched, got %d", got)
	}
	if got := currentUserVersion(first); got == 1 {
		t.Fatal("the first user's version should have advanced")
	}
}

func TestRecordSyncOpStoresPayloadAtBumpedVersion(t *testing.T) {
	initTestDB(t)
	userID := createTestUser(t)

	row := WatchlistItem{UserID: userID, MediaID: 42, Title: "Example", MediaType: "movie"}
	version := recordSyncOp(userID, syncCollectionWatchlist, syncOpUpsert,
		watchlistEntityKey("movie", 42), row)

	if version <= 1 {
		t.Fatalf("expected the version to advance past 1, got %d", version)
	}

	var ops []SyncOp
	if err := db.Where("user_id = ?", userID).Find(&ops).Error; err != nil {
		t.Fatalf("failed to read change log: %v", err)
	}
	if len(ops) != 1 {
		t.Fatalf("expected exactly one change-log entry, got %d", len(ops))
	}

	op := ops[0]
	if op.Version != version {
		t.Fatalf("expected the op at version %d, got %d", version, op.Version)
	}
	if op.Collection != syncCollectionWatchlist || op.OpType != syncOpUpsert {
		t.Fatalf("unexpected collection/op_type: %s/%s", op.Collection, op.OpType)
	}
	if op.Payload == "" {
		t.Fatal("an upsert must carry the entity payload so a client can apply it without a follow-up fetch")
	}
	if op.EntityKey != "movie:42" {
		t.Fatalf("unexpected entity key: %q", op.EntityKey)
	}
}

func TestRecordSyncOpDeleteHasNoPayload(t *testing.T) {
	initTestDB(t)
	userID := createTestUser(t)

	recordSyncOp(userID, syncCollectionWatchlist, syncOpDelete, "movie:42", nil)

	var op SyncOp
	if err := db.Where("user_id = ?", userID).First(&op).Error; err != nil {
		t.Fatalf("failed to read change log: %v", err)
	}
	if op.Payload != "" {
		t.Fatalf("a delete must not carry a payload, got %q", op.Payload)
	}
}

func TestHighestCollectionVersionTracksOnlyThatCollection(t *testing.T) {
	initTestDB(t)
	userID := createTestUser(t)

	recordSyncOp(userID, syncCollectionWatchlist, syncOpUpsert, "movie:1", nil)
	watchedVersion := recordSyncOp(userID, syncCollectionWatched, syncOpUpsert, "tv:1:1:1", nil)

	if got := highestCollectionVersion(userID, syncCollectionWatched); got != watchedVersion {
		t.Fatalf("expected watched version %d, got %d", watchedVersion, got)
	}
	if got := highestCollectionVersion(userID, syncCollectionFavorites); got != 0 {
		t.Fatalf("an untouched collection must report version 0, got %d", got)
	}
}

func TestPruneSyncOpsKeepsNewestEntries(t *testing.T) {
	initTestDB(t)
	userID := createTestUser(t)

	// Write one more than the retention window so pruning must kick in. Each
	// recordSyncOp call prunes, so by the end the log must be bounded.
	total := syncOpRetention + 25
	for i := 0; i < total; i++ {
		recordSyncOp(userID, syncCollectionWatched, syncOpUpsert, "tv:1:1:1", nil)
	}

	var count int64
	if err := db.Model(&SyncOp{}).Where("user_id = ?", userID).Count(&count).Error; err != nil {
		t.Fatalf("failed to count change log: %v", err)
	}
	if count > int64(syncOpRetention) {
		t.Fatalf("change log grew past retention: %d entries (cap %d)", count, syncOpRetention)
	}
	if count == 0 {
		t.Fatal("pruning must not empty the log")
	}

	// The newest entry must survive.
	var newest SyncOp
	if err := db.Where("user_id = ?", userID).Order("version DESC").First(&newest).Error; err != nil {
		t.Fatalf("failed to read the newest entry: %v", err)
	}
	if newest.Version != currentUserVersion(userID) {
		t.Fatalf("expected the newest entry at the current version %d, got %d",
			currentUserVersion(userID), newest.Version)
	}
}

func TestNeedsFullResync(t *testing.T) {
	initTestDB(t)
	userID := createTestUser(t)

	// A first sync (no cursor) is never flagged.
	if needsFullResync(userID, 0) {
		t.Fatal("a first sync must not be flagged as needing a resync")
	}

	recordSyncOp(userID, syncCollectionWatchlist, syncOpUpsert, "movie:1", nil)
	recordSyncOp(userID, syncCollectionWatchlist, syncOpUpsert, "movie:2", nil)
	latest := currentUserVersion(userID)

	// A client at the latest version is up to date.
	if needsFullResync(userID, latest) {
		t.Fatal("a client at the current version is up to date")
	}

	// A client one version behind can still be served the last change.
	if needsFullResync(userID, latest-1) {
		t.Fatalf("a client at version %d should still be serviceable", latest-1)
	}
}

func TestNeedsFullResyncWhenHistoryWasPruned(t *testing.T) {
	initTestDB(t)
	userID := createTestUser(t)

	for i := 0; i < syncOpRetention+10; i++ {
		recordSyncOp(userID, syncCollectionWatched, syncOpUpsert, "tv:1:1:1", nil)
	}

	var oldest SyncOp
	if err := db.Where("user_id = ?", userID).Order("version ASC").First(&oldest).Error; err != nil {
		t.Fatalf("failed to read the oldest entry: %v", err)
	}

	// A cursor before the oldest retained entry cannot be served a complete
	// delta, so the client must be told to resync rather than silently missing
	// changes.
	if !needsFullResync(userID, oldest.Version-2) {
		t.Fatal("a cursor older than the retained log must require a resync")
	}
}

func TestNeedsFullResyncWithNoChangeLog(t *testing.T) {
	initTestDB(t)
	userID := createTestUser(t)

	// The user has state but no retained ops (e.g. the log was pruned to empty
	// or the database was migrated). A client claiming an old version cannot be
	// reconciled incrementally.
	bumpUserVersion(userID)
	bumpUserVersion(userID)

	if !needsFullResync(userID, 1) {
		t.Fatal("a stale cursor with no change log must require a resync")
	}
}

// The entity key is the join between a write and the client's stored row, so
// an add and a later remove must produce exactly the same key.
func TestEntityKeysAreConsistentBetweenAddAndRemove(t *testing.T) {
	addKey := watchlistEntityKey("tv", 1396)
	removeKey := watchlistEntityKey("tv", 1396)
	if addKey != removeKey {
		t.Fatalf("add/remove keys differ: %q vs %q", addKey, removeKey)
	}
	if addKey != "tv:1396" {
		t.Fatalf("unexpected key format: %q", addKey)
	}
}

func TestEntityKeyDefaultsUnsetMediaType(t *testing.T) {
	// Rows written before media_type was populated have an empty value; both
	// paths must still agree so a delete can match.
	if watchlistEntityKey("", 5) != watchlistEntityKey("", 5) {
		t.Fatal("keys must be deterministic")
	}
	if watchlistEntityKey("", 5) != "movie:5" {
		t.Fatalf("an unset media type must normalise to movie, got %q", watchlistEntityKey("", 5))
	}
	if watchlistEntityKey("tv", 5) == watchlistEntityKey("movie", 5) {
		t.Fatal("a tv key must not collide with a movie key for the same id")
	}
}

func TestWatchedEntityKeyDistinguishesEpisodes(t *testing.T) {
	s1, e1 := int64(1), int64(1)
	s1b, e2 := int64(1), int64(2)

	a := watchedEntityKey("tv", 100, &s1, &e1)
	b := watchedEntityKey("tv", 100, &s1b, &e2)
	if a == b {
		t.Fatalf("different episodes must not share a key: %q", a)
	}

	// A movie has no season/episode and must produce a plain key.
	if got := watchedEntityKey("movie", 100, nil, nil); got != "movie:100" {
		t.Fatalf("unexpected movie key: %q", got)
	}
}
