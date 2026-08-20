package main

import (
	"net/http"
	"sort"
	"time"

	"github.com/gin-gonic/gin"
)

func handleAddFavorite(c *gin.Context) {
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

	var existing FavoriteItem
	if err := db.Where("user_id = ? AND media_id = ?", userUID, item.ID).First(&existing).Error; err == nil {
		c.JSON(http.StatusOK, existing)
		return
	}

	favorite := FavoriteItem{
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

	if err := db.Create(&favorite).Error; err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to add favorite"})
		return
	}

	c.JSON(http.StatusCreated, item)
}

func handleGetFavorites(c *gin.Context) {
	userID, ok := c.Get("user_id")
	if !ok {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "Unauthorized"})
		return
	}
	userUID := userID.(uint)

	var dbItems []FavoriteItem
	if err := db.Where("user_id = ?", userUID).Find(&dbItems).Error; err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to fetch favorites"})
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

	sort.Slice(items, func(i, j int) bool {
		return displayTitle(items[i]) < displayTitle(items[j])
	})

	c.JSON(http.StatusOK, items)
}

func handleDeleteFavorite(c *gin.Context) {
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

	if err := db.Where("user_id = ? AND media_id = ?", userUID, id).Delete(&FavoriteItem{}).Error; err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to delete favorite"})
		return
	}

	c.Status(http.StatusNoContent)
}

func handleFavoriteStatus(c *gin.Context) {
	mediaID, err := parseID(c.Query("media_id"))
	if err != nil || mediaID == 0 {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Invalid media id"})
		return
	}

	userID, ok := c.Get("user_id")
	if !ok {
		c.JSON(http.StatusOK, gin.H{"favorited": false})
		return
	}
	userUID := userID.(uint)

	var existing FavoriteItem
	favorited := db.Where("user_id = ? AND media_id = ?", userUID, mediaID).First(&existing).Error == nil

	c.JSON(http.StatusOK, gin.H{"favorited": favorited})
}
