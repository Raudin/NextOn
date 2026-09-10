package main

import (
	"net/http"
	"sort"
	"sync"
	"time"

	"github.com/gin-gonic/gin"
)

func handleAddWatchlist(c *gin.Context) {
	userID, ok := c.Get("user_id")
	if !ok {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "Unauthorized"})
		return
	}
	userUID := userID.(uint)

	var item TMDBMedia
	if err := c.ShouldBindJSON(&item); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Invalid media payload"})
		return
	}
	if item.ID == 0 {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Media id is required"})
		return
	}

	var existing WatchlistItem
	if err := db.Where("user_id = ? AND media_id = ?", userUID, item.ID).First(&existing).Error; err == nil {
		c.JSON(http.StatusOK, existing)
		return
	}

	watchItem := WatchlistItem{
		UserID:       userUID,
		MediaID:      item.ID,
		Title:        item.Title,
		Name:         item.Name,
		PosterPath:   item.PosterPath,
		BackdropPath: item.BackdropPath,
		VoteAverage:  item.VoteAverage,
		MediaType:    item.MediaType,
		ReleaseDate:  item.ReleaseDate,
		FirstAirDate: item.FirstAirDate,
		CreatedAt:    time.Now(),
	}

	if err := db.Create(&watchItem).Error; err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to add to watchlist"})
		return
	}

	c.JSON(http.StatusCreated, item)
}

func handleGetWatchlist(c *gin.Context) {
	userID, ok := c.Get("user_id")
	if !ok {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "Unauthorized"})
		return
	}
	userUID := userID.(uint)

	filterWatched := c.Query("filter_watched") == "true"

	var dbItems []WatchlistItem
	if err := db.Where("user_id = ?", userUID).Find(&dbItems).Error; err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to fetch watchlist"})
		return
	}

	items := make([]TMDBMedia, 0, len(dbItems))
	for _, dbItem := range dbItems {
		items = append(items, TMDBMedia{
			ID:           dbItem.MediaID,
			Title:        dbItem.Title,
			Name:         dbItem.Name,
			PosterPath:   dbItem.PosterPath,
			BackdropPath: dbItem.BackdropPath,
			VoteAverage:  dbItem.VoteAverage,
			MediaType:    dbItem.MediaType,
			ReleaseDate:  dbItem.ReleaseDate,
			FirstAirDate: dbItem.FirstAirDate,
			CreatedAt:    dbItem.CreatedAt,
		})
	}

	if filterWatched {
		// Load the user's watched history once instead of re-querying it for
		// every watchlist item inside isWatchlistItemFullyWatched.
		watched := getUserWatched(userUID)

		// Movies are pure DB checks, but each TV show needs a TMDB lookup for
		// its total episode count. Run those in parallel (bounded) so endpoint
		// latency is ~max(tmdb latency) instead of the sum of N sequential
		// calls, which previously blew past the mobile client's timeout.
		fullyWatched := make([]bool, len(items))
		for i, item := range items {
			if watchlistMediaType(item) != "tv" {
				fullyWatched[i] = isWatchlistItemFullyWatched(item, watched)
			}
		}

		var wg sync.WaitGroup
		sem := make(chan struct{}, 10)
		for i := range items {
			if watchlistMediaType(items[i]) != "tv" {
				continue
			}
			wg.Add(1)
			go func(idx int, it TMDBMedia) {
				defer wg.Done()
				sem <- struct{}{}
				defer func() { <-sem }()
				fullyWatched[idx] = isWatchlistItemFullyWatched(it, watched)
			}(i, items[i])
		}
		wg.Wait()

		filtered := make([]TMDBMedia, 0, len(items))
		for i, item := range items {
			if !fullyWatched[i] {
				filtered = append(filtered, item)
			}
		}
		items = filtered
	}
	enrichMediaRatings(items)

	sort.Slice(items, func(i, j int) bool {
		return displayTitle(items[i]) < displayTitle(items[j])
	})

	c.JSON(http.StatusOK, items)
}

func handleDeleteWatchlist(c *gin.Context) {
	userID, ok := c.Get("user_id")
	if !ok {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "Unauthorized"})
		return
	}
	userUID := userID.(uint)

	id, err := parseID(c.Param("id"))
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Invalid media id"})
		return
	}

	if err := db.Where("user_id = ? AND media_id = ?", userUID, id).Delete(&WatchlistItem{}).Error; err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to delete from watchlist"})
		return
	}

	c.Status(http.StatusNoContent)
}
