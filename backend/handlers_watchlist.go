package main

import (
	"net/http"
	"sort"
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
		filtered := make([]TMDBMedia, 0, len(items))
		for _, item := range items {
			if isWatchlistItemFullyWatched(userUID, item) {
				continue
			}
			filtered = append(filtered, item)
		}
		items = filtered
	}

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
