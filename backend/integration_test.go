package main

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strconv"
	"testing"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/golang-jwt/jwt/v5"
)

// itoa renders a version for use in a query string.
func itoa(value uint64) string {
	return strconv.FormatUint(value, 10)
}

// Integration tests through newRouter, so they exercise the real middleware
// order and route table rather than a hand-built approximation. The caching
// and sync guarantees in this package depend on ordering (VersionedETag after
// Auth, for instance), which is exactly what a hand-built test router would
// hide.

func initRouterTest(t *testing.T) (*gin.Engine, uint, string) {
	t.Helper()

	initTestDB(t)
	userID := createTestUser(t)

	// A real token, so AuthMiddleware and OptionalAuthMiddleware are both
	// genuinely exercised.
	token := jwt.NewWithClaims(jwt.SigningMethodHS256, jwt.MapClaims{
		"user_id": userID,
		"email":   "test@example.com",
		"exp":     time.Now().Add(time.Hour).Unix(),
	})
	signed, err := token.SignedString(jwtSecret)
	if err != nil {
		t.Fatalf("failed to sign test token: %v", err)
	}

	// The public endpoints under test short-circuit before touching TMDB, but
	// several handlers read this env var.
	t.Setenv("TMDB_API_KEY", "dummy")

	gin.SetMode(gin.TestMode)
	return newRouter(), userID, signed
}

func authedRequest(t *testing.T, method, path, token string) *http.Request {
	t.Helper()
	request := httptest.NewRequest(method, path, nil)
	request.Header.Set("Authorization", "Bearer "+token)
	return request
}

func TestSyncStateRequiresAuth(t *testing.T) {
	r, _, _ := initRouterTest(t)

	w := httptest.NewRecorder()
	r.ServeHTTP(w, httptest.NewRequest(http.MethodGet, "/api/sync/state", nil))

	if w.Code != http.StatusUnauthorized {
		t.Fatalf("expected 401 without a token, got %d", w.Code)
	}
}

func TestSyncStateReportsVersionAndCollections(t *testing.T) {
	r, userID, token := initRouterTest(t)

	// The state endpoint counts the collection's actual rows, so the row must
	// exist as well as the change-log entry.
	row := WatchlistItem{UserID: userID, MediaID: 1, Title: "Example", MediaType: "movie"}
	if err := db.Create(&row).Error; err != nil {
		t.Fatalf("failed to seed watchlist row: %v", err)
	}
	recordSyncOp(userID, syncCollectionWatchlist, syncOpUpsert, "movie:1", row)

	w := httptest.NewRecorder()
	r.ServeHTTP(w, authedRequest(t, http.MethodGet, "/api/sync/state", token))

	if w.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d (%s)", w.Code, w.Body.String())
	}

	var state SyncStateResponse
	if err := json.Unmarshal(w.Body.Bytes(), &state); err != nil {
		t.Fatalf("failed to decode response: %v", err)
	}

	if state.Version != currentUserVersion(userID) {
		t.Fatalf("expected version %d, got %d", currentUserVersion(userID), state.Version)
	}
	if got := state.Collections[syncCollectionWatchlist].Count; got != 1 {
		t.Fatalf("expected 1 watchlist row, got %d", got)
	}
	if got := state.Collections[syncCollectionWatchlist].Version; got == 0 {
		t.Fatal("expected the watchlist collection to report a version")
	}

	// Per-user routes must be marked private and vary on the token.
	if got := w.Header().Get("Vary"); got != "Authorization" {
		t.Fatalf("expected Vary: Authorization, got %q", got)
	}
}

func TestSyncStateETagRoundTrip(t *testing.T) {
	r, userID, token := initRouterTest(t)

	first := httptest.NewRecorder()
	r.ServeHTTP(first, authedRequest(t, http.MethodGet, "/api/sync/state", token))

	etag := first.Header().Get("ETag")
	if etag == "" {
		t.Fatal("expected an ETag on the sync state response")
	}

	request := authedRequest(t, http.MethodGet, "/api/sync/state", token)
	request.Header.Set("If-None-Match", etag)

	second := httptest.NewRecorder()
	r.ServeHTTP(second, request)

	if second.Code != http.StatusNotModified {
		t.Fatalf("expected 304 for an unchanged state, got %d", second.Code)
	}

	// Advance the version and the same validator must stop matching.
	recordSyncOp(userID, syncCollectionWatched, syncOpUpsert, "tv:1:1:1", nil)

	third := httptest.NewRecorder()
	r.ServeHTTP(third, request)

	if third.Code != http.StatusOK {
		t.Fatalf("expected 200 after a mutation, got %d", third.Code)
	}
}

func TestSyncChangesReturnsDeltaWithPayloads(t *testing.T) {
	r, userID, token := initRouterTest(t)

	startVersion := currentUserVersion(userID)

	row := WatchlistItem{UserID: userID, MediaID: 42, Title: "Example", MediaType: "movie"}
	recordSyncOp(userID, syncCollectionWatchlist, syncOpUpsert, watchlistEntityKey("movie", 42), row)
	recordSyncOp(userID, syncCollectionWatchlist, syncOpDelete, watchlistEntityKey("tv", 7), nil)

	w := httptest.NewRecorder()
	r.ServeHTTP(w, authedRequest(t, http.MethodGet,
		"/api/sync/changes?since="+itoa(startVersion), token))

	if w.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d (%s)", w.Code, w.Body.String())
	}

	var delta SyncChangeResponse
	if err := json.Unmarshal(w.Body.Bytes(), &delta); err != nil {
		t.Fatalf("failed to decode response: %v", err)
	}

	if delta.ResyncRequired {
		t.Fatal("a fresh cursor must not require a resync")
	}
	if len(delta.Changes) != 2 {
		t.Fatalf("expected 2 changes, got %d", len(delta.Changes))
	}
	if delta.Changes[0].OpType != syncOpUpsert || delta.Changes[0].Payload == "" {
		t.Fatal("an upsert must arrive with its payload inlined")
	}
	if delta.Changes[1].OpType != syncOpDelete || delta.Changes[1].Payload != "" {
		t.Fatal("a delete must arrive without a payload")
	}
	if delta.Version != currentUserVersion(userID) {
		t.Fatalf("expected the response to report the current version %d, got %d",
			currentUserVersion(userID), delta.Version)
	}
}

func TestSyncChangesRejectsMalformedCursor(t *testing.T) {
	r, _, token := initRouterTest(t)

	w := httptest.NewRecorder()
	r.ServeHTTP(w, authedRequest(t, http.MethodGet, "/api/sync/changes?since=abc", token))

	if w.Code != http.StatusBadRequest {
		t.Fatalf("expected 400 for a non-numeric cursor, got %d", w.Code)
	}
}

// A client that is already current should get an empty change list rather than
// a replay of everything.
func TestSyncChangesIsEmptyWhenUpToDate(t *testing.T) {
	r, userID, token := initRouterTest(t)

	recordSyncOp(userID, syncCollectionWatchlist, syncOpUpsert, "movie:1", nil)

	w := httptest.NewRecorder()
	r.ServeHTTP(w, authedRequest(t, http.MethodGet,
		"/api/sync/changes?since="+itoa(currentUserVersion(userID)), token))

	if w.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d", w.Code)
	}

	var delta SyncChangeResponse
	if err := json.Unmarshal(w.Body.Bytes(), &delta); err != nil {
		t.Fatalf("failed to decode response: %v", err)
	}
	if len(delta.Changes) != 0 {
		t.Fatalf("expected no changes for an up-to-date client, got %d", len(delta.Changes))
	}
}

func TestDebugStatsIsAvailableOutsideReleaseMode(t *testing.T) {
	r, _, _ := initRouterTest(t)

	w := httptest.NewRecorder()
	r.ServeHTTP(w, httptest.NewRequest(http.MethodGet, "/api/debug/stats", nil))

	if w.Code != http.StatusOK {
		t.Fatalf("expected 200 in test mode, got %d", w.Code)
	}
	if got := w.Header().Get("Cache-Control"); got != "no-store" {
		t.Fatalf("debug output must not be cached, got %q", got)
	}

	var payload map[string]any
	if err := json.Unmarshal(w.Body.Bytes(), &payload); err != nil {
		t.Fatalf("failed to decode debug stats: %v", err)
	}
	if _, ok := payload["totals"]; !ok {
		t.Fatal("expected a totals section in the debug stats")
	}
	if _, ok := payload["routes"]; !ok {
		t.Fatal("expected a routes section in the debug stats")
	}
}

// TMDB_API_KEY is required for the process to serve media routes. The guard
// lives in main(), so assert the value the test harness relies on is actually
// what the handlers read.

// watchedStatusBody is the wire shape the media-detail screen reads.
type watchedStatusBody struct {
	Episodes []struct {
		Season  int64 `json:"season"`
		Episode int64 `json:"episode"`
	} `json:"episodes"`
	TvProgress *TvProgressLite `json:"tv_progress"`
}

// The detail screen's "caught up" pill: every aired episode of the mock show is
// watched, and its last episode airs in two days, so the endpoint must report
// the show as caught up and name that episode.
func TestWatchedStatusTvProgressReportsCaughtUp(t *testing.T) {
	r, userID, token := initRouterTest(t)

	// Mock Squid Game: 9 episodes, the 9th airing two days from now.
	for episodeNumber := int64(1); episodeNumber <= 8; episodeNumber++ {
		season, episode := int64(1), episodeNumber
		row := WatchedItem{
			UserID:        userID,
			MediaID:       135397,
			MediaType:     "tv",
			SeasonNumber:  &season,
			EpisodeNumber: &episode,
		}
		if err := db.Create(&row).Error; err != nil {
			t.Fatalf("failed to seed watched row: %v", err)
		}
	}

	w := httptest.NewRecorder()
	r.ServeHTTP(w, authedRequest(t, http.MethodGet,
		"/api/watched/status?media_id=135397&type=tv&include=tv_progress", token))

	if w.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d (%s)", w.Code, w.Body.String())
	}

	var body watchedStatusBody
	if err := json.Unmarshal(w.Body.Bytes(), &body); err != nil {
		t.Fatalf("failed to decode response: %v", err)
	}
	if len(body.Episodes) != 8 {
		t.Fatalf("expected the 8 watched episodes, got %d", len(body.Episodes))
	}
	if body.TvProgress == nil {
		t.Fatal("expected tv_progress in the opted-in response")
	}
	if !body.TvProgress.CaughtUp {
		t.Fatal("expected a caught-up show once every aired episode is watched")
	}
	if !body.TvProgress.Released {
		t.Fatal("expected the show to count as released")
	}
	if body.TvProgress.WatchedEpisodes != 8 || body.TvProgress.TotalEpisodes != 9 {
		t.Fatalf("expected 8/9, got %d/%d",
			body.TvProgress.WatchedEpisodes, body.TvProgress.TotalEpisodes)
	}
	if body.TvProgress.NextEpisode == nil || body.TvProgress.NextEpisode.EpisodeNumber != 9 {
		t.Fatalf("expected episode 9 as the next episode, got %+v", body.TvProgress.NextEpisode)
	}
}

// Callers that only need watched state must keep the database-only response:
// no extra payload, no TMDB lookup, nothing to break.
func TestWatchedStatusWithoutIncludeHasNoTvProgress(t *testing.T) {
	r, userID, token := initRouterTest(t)

	season, episode := int64(1), int64(1)
	row := WatchedItem{
		UserID:        userID,
		MediaID:       135397,
		MediaType:     "tv",
		SeasonNumber:  &season,
		EpisodeNumber: &episode,
	}
	if err := db.Create(&row).Error; err != nil {
		t.Fatalf("failed to seed watched row: %v", err)
	}

	w := httptest.NewRecorder()
	r.ServeHTTP(w, authedRequest(t, http.MethodGet,
		"/api/watched/status?media_id=135397&type=tv", token))

	if w.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d", w.Code)
	}

	var body watchedStatusBody
	if err := json.Unmarshal(w.Body.Bytes(), &body); err != nil {
		t.Fatalf("failed to decode response: %v", err)
	}
	if body.TvProgress != nil {
		t.Fatal("tv_progress must stay opt-in")
	}
	if len(body.Episodes) != 1 {
		t.Fatalf("expected 1 watched episode, got %d", len(body.Episodes))
	}
}
