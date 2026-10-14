package main

import (
	"errors"
	"log"
	"net/http"

	"github.com/gin-gonic/gin"
	"gorm.io/gorm"
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

	// Stats are aggregated in SQL rather than by loading the user's whole watch
	// history into Go and counting it there.
	//
	// The old form issued one unbounded `SELECT *` — every column of every
	// watched row, including media ids the stats never look at — and then
	// walked the slice twice. For a user with a long history that was the
	// largest allocation on the profile screen, re-made on every focus.
	var totals []struct {
		MediaType string `gorm:"column:media_type"`
		Total     int64  `gorm:"column:total"`
	}
	if err := db.Model(&WatchedItem{}).
		Select("media_type, COUNT(*) AS total").
		Where("user_id = ?", userUID).
		Group("media_type").
		Scan(&totals).Error; err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to read watch statistics"})
		return
	}

	var totalMoviesWatched int64
	var totalEpisodesWatched int64
	for _, row := range totals {
		switch row.MediaType {
		case "movie":
			totalMoviesWatched += row.Total
		case "tv":
			totalEpisodesWatched += row.Total
		}
	}

	// The streak only needs which days had activity, so it is one DISTINCT
	// query that returns at most one row per calendar day rather than one per
	// watched episode.
	var watchedDates []string
	if err := db.Model(&WatchedItem{}).
		Where("user_id = ?", userUID).
		Distinct().
		Pluck("date(watched_at)", &watchedDates).Error; err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to read watch history"})
		return
	}
	streakDays := calculateStreakFromDates(watchedDates)

	totalWatchTimeMinutes := (totalMoviesWatched * 120) + (totalEpisodesWatched * 45)
	currentXP := (totalMoviesWatched * 120) + (totalEpisodesWatched * 45)
	currentLevel := currentXP / 1000

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

	// Clearing the history is a mutation and must be recorded as one.
	//
	// It previously deleted the rows without touching the user's version or the
	// change log. Because the client's ETag and its delta cursor are both keyed
	// on that version, nothing told the client anything had happened: every
	// derived payload kept being answered 304, and delta sync reported no
	// changes, so the cleared history stayed on screen and on every other
	// device indefinitely.
	//
	// The change-log entry is a collection-level delete: there is no bounded
	// list of episode keys to enumerate, and clients recognise
	// syncCollectionDeleteKey as "drop the whole local collection". The old code
	// recorded nothing at all, so the client was never told anything changed.
	err := db.Transaction(func(tx *gorm.DB) error {
		if err := tx.Where("user_id = ?", userUID).Delete(&WatchedItem{}).Error; err != nil {
			return err
		}
		// Record the clear and make it the resync boundary; see
		// recordCollectionClearTx for why ordinary clients must be made to
		// resync rather than served a delta that replays pre-clear upserts.
		if !recordCollectionClearTx(tx, userUID, syncCollectionWatched) {
			return errors.New("failed to record history clear")
		}
		return nil
	})
	if err != nil {
		log.Printf("Profile: failed to clear watch history for user %d: %v", userUID, err)
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to clear watch history"})
		return
	}

	invalidateUserCaches(userUID)
	c.JSON(http.StatusOK, gin.H{"message": "Watch history cleared successfully"})
}

func handleDeleteAccount(c *gin.Context) {
	userID, ok := c.Get("user_id")
	if !ok {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "Unauthorized"})
		return
	}
	userUID := userID.(uint)

	// Every per-user table must be covered. Favorites, SyncOps and SyncState
	// were previously left behind, so "delete account" removed the user row
	// while their favourites and complete change log stayed in the database —
	// and reusing the same email would resurrect a fresh account that
	// inherited the orphaned change log through a shared user id.
	//
	// Wrapped in db.Transaction so the ordering matches the explicit
	// Begin/Commit form it replaces while guaranteeing a rollback on any error
	// path, including a panic.
	err := db.Transaction(func(tx *gorm.DB) error {
		for _, target := range []any{
			&WatchedItem{},
			&WatchlistItem{},
			&FavoriteItem{},
			&SyncOp{},
		} {
			if err := tx.Where("user_id = ?", userUID).Delete(target).Error; err != nil {
				return err
			}
		}

		// UserSyncState uses user_id as its primary key rather than as a
		// filtered column, and it must not survive the user it describes.
		if err := tx.Where("user_id = ?", userUID).Delete(&UserSyncState{}).Error; err != nil {
			return err
		}

		return tx.Delete(&User{}, userUID).Error
	})
	if err != nil {
		log.Printf("Profile: failed to delete account %d: %v", userUID, err)
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to delete account"})
		return
	}

	invalidateUserCaches(userUID)
	c.JSON(http.StatusOK, gin.H{"message": "Account deleted successfully"})
}