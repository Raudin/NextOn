package main

import (
	"bytes"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"
)

// Binds a request body that tries to set server-owned fields, and proves the
// server ignores them.

// A client must not be able to choose its own row id, user id or watched
// timestamp: those are server-owned, and honouring `id` would let a request
// address or overwrite a row that was not the one being marked.
func TestAddWatchedIgnoresClientSuppliedIdentity(t *testing.T) {
	r, userID, token := initRouterTest(t)

	body := map[string]any{
		"id":             9999,
		"user_id":        userID + 500,
		"media_id":       603,
		"media_type":     "movie",
		"watched_at":     "1999-01-01T00:00:00Z",
		"season_number":  nil,
		"episode_number": nil,
	}
	encoded, err := json.Marshal(body)
	if err != nil {
		t.Fatalf("encode: %v", err)
	}

	request := pinnedClockRequest(http.MethodPost, "/api/watched", pinnedClock)
	request.Header.Set("Authorization", "Bearer "+token)
	request.Header.Set("Content-Type", "application/json")
	request.Body = httptest.NewRequest(http.MethodPost, "/", bytes.NewReader(encoded)).Body

	w := httptest.NewRecorder()
	r.ServeHTTP(w, request)

	if w.Code != http.StatusCreated {
		t.Fatalf("expected 201, got %d (%s)", w.Code, w.Body.String())
	}

	var row WatchedItem
	if err := db.Where("user_id = ? AND media_id = ?", userID, 603).First(&row).Error; err != nil {
		t.Fatalf("the row was not stored for the authenticated user: %v", err)
	}

	if row.UserID != userID {
		t.Fatalf("user_id must come from the session, got %d", row.UserID)
	}
	if row.ID == 9999 {
		t.Fatal("the client must not be able to choose the row id")
	}
	if row.WatchedAt.Year() == 1999 {
		t.Fatalf("watched_at must be set by the server, got %v", row.WatchedAt)
	}
	if time.Since(row.WatchedAt) > time.Minute {
		t.Fatalf("watched_at should be now, got %v", row.WatchedAt)
	}

	// Nothing may have been written for the user id the client tried to claim.
	var count int64
	if err := db.Model(&WatchedItem{}).Where("user_id = ?", userID+500).Count(&count).Error; err != nil {
		t.Fatalf("count: %v", err)
	}
	if count != 0 {
		t.Fatalf("no row may be written for a client-supplied user id, found %d", count)
	}
}

// The bulk path must apply the same rule per item.
func TestBulkWatchedIgnoresClientSuppliedIdentity(t *testing.T) {
	r, userID, token := initRouterTest(t)

	payload := map[string]any{
		"items": []map[string]any{
			{"id": 4242, "user_id": userID + 900, "media_id": 11, "media_type": "movie"},
			{"id": 4243, "user_id": userID + 900, "media_id": 12, "media_type": "movie"},
		},
	}
	encoded, _ := json.Marshal(payload)

	request := pinnedClockRequest(http.MethodPost, "/api/watched/bulk", pinnedClock)
	request.Header.Set("Authorization", "Bearer "+token)
	request.Header.Set("Content-Type", "application/json")
	request.Body = httptest.NewRequest(http.MethodPost, "/", bytes.NewReader(encoded)).Body

	w := httptest.NewRecorder()
	r.ServeHTTP(w, request)

	if w.Code != http.StatusCreated {
		t.Fatalf("expected 201, got %d (%s)", w.Code, w.Body.String())
	}

	var rows []WatchedItem
	if err := db.Where("user_id = ?", userID).Find(&rows).Error; err != nil {
		t.Fatalf("read: %v", err)
	}
	if len(rows) != 2 {
		t.Fatalf("expected 2 rows for the authenticated user, got %d", len(rows))
	}
	for _, row := range rows {
		if row.ID == 4242 || row.ID == 4243 {
			t.Fatal("a client-supplied id must not be honoured")
		}
		if row.UserID != userID {
			t.Fatalf("user_id must come from the session, got %d", row.UserID)
		}
	}
}

// The bulk mark is the endpoint the report flags for unbounded work. This is a
// coarse guard rather than a benchmark: it asserts that a realistic batch
// completes, that every item lands, and that the cost is bounded enough that the
// test does not need a long timeout.
func TestBulkWatchedHandlesLargeBatchInOneTransaction(t *testing.T) {
	r, userID, token := initRouterTest(t)

	const episodes = 200

	items := make([]map[string]any, 0, episodes)
	for episode := 1; episode <= episodes; episode++ {
		items = append(items, map[string]any{
			"media_id":       550,
			"media_type":     "tv",
			"season_number":  1,
			"episode_number": episode,
		})
	}
	encoded, _ := json.Marshal(map[string]any{"items": items})

	versionBefore := currentUserVersion(userID)
	startedAt := time.Now()

	request := pinnedClockRequest(http.MethodPost, "/api/watched/bulk", pinnedClock)
	request.Header.Set("Authorization", "Bearer "+token)
	request.Header.Set("Content-Type", "application/json")
	request.Body = httptest.NewRequest(http.MethodPost, "/", bytes.NewReader(encoded)).Body

	w := httptest.NewRecorder()
	r.ServeHTTP(w, request)
	elapsed := time.Since(startedAt)

	if w.Code != http.StatusCreated {
		t.Fatalf("expected 201, got %d (%s)", w.Code, w.Body.String())
	}

	var response struct {
		Added int `json:"added"`
	}
	if err := json.Unmarshal(w.Body.Bytes(), &response); err != nil {
		t.Fatalf("decode: %v", err)
	}
	// Mock data marks these as released, so all of them should be applied.
	if response.Added != episodes {
		t.Fatalf("expected %d items applied, got %d", episodes, response.Added)
	}

	var rows int64
	if err := db.Model(&WatchedItem{}).Where("user_id = ?", userID).Count(&rows).Error; err != nil {
		t.Fatalf("count: %v", err)
	}
	if rows != episodes {
		t.Fatalf("expected %d rows, got %d", episodes, rows)
	}

	// One version bump for the whole batch, not one per item. This is the
	// property that keeps a large mark from invalidating every derived cache
	// hundreds of times and pushing other devices past the change-log window.
	if got := currentUserVersion(userID); got != versionBefore+1 {
		t.Fatalf("a bulk mark must advance the version exactly once: %d -> %d", versionBefore, got)
	}

	var ops int64
	if err := db.Model(&SyncOp{}).Where("user_id = ?", userID).Count(&ops).Error; err != nil {
		t.Fatalf("count ops: %v", err)
	}
	if ops != episodes {
		t.Fatalf("expected %d change-log entries, got %d", episodes, ops)
	}

	// A generous ceiling. The point is to catch a regression to the old
	// per-item round-trip behaviour (which took orders of magnitude longer),
	// not to benchmark a specific machine.
	if elapsed > 30*time.Second {
		t.Fatalf("a %d-item batch took %v, which suggests per-item round trips", episodes, elapsed)
	}
	t.Logf("%d-item bulk mark completed in %v", episodes, elapsed)
}

// Guard the shape the client actually depends on: the DTO must accept exactly
// the documented fields and reject a payload missing identity.
func TestWatchedRequestValidation(t *testing.T) {
	r, _, token := initRouterTest(t)

	cases := []struct {
		name string
		body string
		want int
	}{
		{"missing media id", `{"media_type":"movie"}`, http.StatusBadRequest},
		{"bad media type", `{"media_id":1,"media_type":"book"}`, http.StatusBadRequest},
		{"tv without episode", `{"media_id":1,"media_type":"tv"}`, http.StatusBadRequest},
		{"valid movie", `{"media_id":1,"media_type":"movie"}`, http.StatusCreated},
	}

	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			request := pinnedClockRequest(http.MethodPost, "/api/watched", pinnedClock)
			request.Header.Set("Authorization", "Bearer "+token)
			request.Header.Set("Content-Type", "application/json")
			request.Body = httptest.NewRequest(http.MethodPost, "/", bytes.NewReader([]byte(tc.body))).Body

			w := httptest.NewRecorder()
			r.ServeHTTP(w, request)

			if w.Code != tc.want {
				t.Fatalf("%s: expected %d, got %d (%s)", tc.name, tc.want, w.Code, w.Body.String())
			}
		})
	}
}
