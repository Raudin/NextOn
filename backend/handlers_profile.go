package main

import (
	"net/http"

	"github.com/gin-gonic/gin"
)

func handleGetProfile(c *gin.Context) {
	userID, ok := c.Get("user_id")
	if !ok {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "Unauthorized"})
		return
	}
	userUID := userID.(uint)

	var user User
	if err := db.First(&user, userUID).Error; err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "User not found"})
		return
	}

	// Aggregate stats from watch_history
	var watchedItems []WatchedItem
	db.Where("user_id = ?", userUID).Find(&watchedItems)

	var totalMoviesWatched int64
	var totalEpisodesWatched int64
	for _, item := range watchedItems {
		if item.MediaType == "movie" {
			totalMoviesWatched++
		} else if item.MediaType == "tv" {
			totalEpisodesWatched++
		}
	}

	totalWatchTimeMinutes := (totalMoviesWatched * 120) + (totalEpisodesWatched * 45)
	currentXP := (totalMoviesWatched * 120) + (totalEpisodesWatched * 45)
	currentLevel := currentXP / 1000
	streakDays := calculateStreakGo(watchedItems)

	c.JSON(http.StatusOK, gin.H{
		"user": user,
		"stats": gin.H{
			"total_movies_watched":     totalMoviesWatched,
			"total_episodes_watched":   totalEpisodesWatched,
			"total_watch_time_minutes": totalWatchTimeMinutes,
			"current_xp":               currentXP,
			"current_level":            currentLevel,
			"streak_days":              streakDays,
		},
	})
}

func handleUpdateProfile(c *gin.Context) {
	userID, ok := c.Get("user_id")
	if !ok {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "Unauthorized"})
		return
	}
	userUID := userID.(uint)

	var req UpdateProfileReq
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Invalid profile payload"})
		return
	}

	var user User
	if err := db.First(&user, userUID).Error; err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "User not found"})
		return
	}

	if req.Name != nil {
		user.Name = *req.Name
	}
	if req.AvatarURL != nil {
		user.AvatarURL = *req.AvatarURL
	}
	if req.NotificationsEnabled != nil {
		user.NotificationsEnabled = *req.NotificationsEnabled
	}

	if err := db.Save(&user).Error; err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to update profile"})
		return
	}

	c.JSON(http.StatusOK, user)
}

func handleClearWatchHistory(c *gin.Context) {
	userID, ok := c.Get("user_id")
	if !ok {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "Unauthorized"})
		return
	}
	userUID := userID.(uint)

	if err := db.Where("user_id = ?", userUID).Delete(&WatchedItem{}).Error; err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to clear watch history"})
		return
	}

	c.JSON(http.StatusOK, gin.H{"message": "Watch history cleared successfully"})
}

func handleDeleteAccount(c *gin.Context) {
	userID, ok := c.Get("user_id")
	if !ok {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "Unauthorized"})
		return
	}
	userUID := userID.(uint)

	tx := db.Begin()
	defer func() {
		if r := recover(); r != nil {
			tx.Rollback()
		}
	}()

	if err := tx.Where("user_id = ?", userUID).Delete(&WatchedItem{}).Error; err != nil {
		tx.Rollback()
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to delete watch history"})
		return
	}

	if err := tx.Where("user_id = ?", userUID).Delete(&WatchlistItem{}).Error; err != nil {
		tx.Rollback()
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to delete watchlist"})
		return
	}

	if err := tx.Delete(&User{}, userUID).Error; err != nil {
		tx.Rollback()
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to delete user account"})
		return
	}

	if err := tx.Commit().Error; err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to commit transaction"})
		return
	}

	c.JSON(http.StatusOK, gin.H{"message": "Account deleted successfully"})
}
