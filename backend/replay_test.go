package main

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"github.com/gin-gonic/gin"
)

func TestReplayEndpoint(t *testing.T) {
	gin.SetMode(gin.TestMode)
	initTestDB(t)

	user := User{
		Email:        "replay_test@example.com",
		PasswordHash: "pass",
		Name:         "Replay Watcher",
	}
	db.Create(&user)

	now := time.Now()

	season1 := int64(1)
	ep1 := int64(1)
	ep2 := int64(2)
	db.Create(&WatchedItem{
		UserID:    user.ID,
		MediaID:   558449,
		MediaType: "movie",
		WatchedAt: now.Add(-2 * time.Hour),
	})
	db.Create(&WatchedItem{
		UserID:        user.ID,
		MediaID:       135397,
		MediaType:     "tv",
		SeasonNumber:  &season1,
		EpisodeNumber: &ep1,
		WatchedAt:     now.Add(-4 * time.Hour),
	})
	db.Create(&WatchedItem{
		UserID:        user.ID,
		MediaID:       135397,
		MediaType:     "tv",
		SeasonNumber:  &season1,
		EpisodeNumber: &ep2,
		WatchedAt:     now.Add(-3 * time.Hour),
	})

	r := gin.New()
	r.Use(func(c *gin.Context) {
		c.Set("user_id", user.ID)
		c.Next()
	})
	r.GET("/api/replay", handleGetReplay)

	req := httptest.NewRequest("GET", "/api/replay?period=this_year", nil)
	w := httptest.NewRecorder()
	r.ServeHTTP(w, req)

	if w.Code != http.StatusOK {
		t.Fatalf("Expected 200, got %d", w.Code)
	}

	var summary ReplaySummary
	if err := json.Unmarshal(w.Body.Bytes(), &summary); err != nil {
		t.Fatalf("Failed to decode response: %v", err)
	}

	if summary.IsEmpty {
		t.Fatalf("Expected replay not to be empty")
	}
	if summary.Habits.DistinctMovies != 1 {
		t.Errorf("Expected 1 distinct movie, got %d", summary.Habits.DistinctMovies)
	}
	if summary.Habits.DistinctShows != 1 {
		t.Errorf("Expected 1 distinct show, got %d", summary.Habits.DistinctShows)
	}
	if summary.Habits.TotalEpisodes != 2 {
		t.Errorf("Expected 2 total episodes, got %d", summary.Habits.TotalEpisodes)
	}

	if len(summary.TopShows) == 0 {
		t.Fatalf("Expected top shows, got none")
	}
	if summary.TopShows[0].Count != 2 {
		t.Errorf("Expected top show count 2, got %d", summary.TopShows[0].Count)
	}

	if len(summary.TopNetworks) == 0 || summary.TopNetworks[0].Title != "Netflix" {
		t.Errorf("Expected Netflix in top networks, got %+v", summary.TopNetworks)
	}

	if len(summary.TopGenres) == 0 {
		t.Errorf("Expected top genres, got none")
	}

	emptyUser := User{
		Email: "empty_replay@example.com",
		Name:  "Empty Watcher",
	}
	db.Create(&emptyUser)

	r2 := gin.New()
	r2.Use(func(c *gin.Context) {
		c.Set("user_id", emptyUser.ID)
		c.Next()
	})
	r2.GET("/api/replay", handleGetReplay)

	reqEmpty := httptest.NewRequest("GET", "/api/replay?period=this_week", nil)
	wEmpty := httptest.NewRecorder()
	r2.ServeHTTP(wEmpty, reqEmpty)

	var emptySummary ReplaySummary
	if err := json.Unmarshal(wEmpty.Body.Bytes(), &emptySummary); err != nil {
		t.Fatalf("Failed to decode empty response: %v", err)
	}

	if !emptySummary.IsEmpty {
		t.Errorf("Expected empty replay for new user")
	}
}
