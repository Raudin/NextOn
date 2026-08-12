package main

import (
	"fmt"
	"net/http"
	"os"
	"strings"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/golang-jwt/jwt/v5"
)

func handleAddWatched(c *gin.Context) {
	userID, ok := c.Get("user_id")
	if !ok {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "Unauthorized"})
		return
	}
	userUID := userID.(uint)

	var req WatchedItem
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Invalid watched payload"})
		return
	}
	if req.MediaType != "movie" && req.MediaType != "tv" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Media type must be movie or tv"})
		return
	}
	if req.MediaID == 0 {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Media id is required"})
		return
	}
	if req.MediaType == "tv" && (req.SeasonNumber == nil || req.EpisodeNumber == nil) {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Season and episode numbers are required for TV episodes"})
		return
	}

	if isUnreleased(req.MediaType, req.MediaID, req.SeasonNumber, req.EpisodeNumber) {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Cannot watch unreleased content"})
		return
	}

	req.UserID = userUID
	req.WatchedAt = time.Now()

	addOrUpdateWatched(userUID, req)
	c.JSON(http.StatusCreated, req)
}

func handleAddWatchedBulk(c *gin.Context) {
	userID, ok := c.Get("user_id")
	if !ok {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "Unauthorized"})
		return
	}
	userUID := userID.(uint)

	var req struct {
		Items []WatchedItem `json:"items"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Invalid bulk payload"})
		return
	}

	now := time.Now()
	var addedCount int
	for i := range req.Items {
		item := &req.Items[i]
		if item.MediaType != "movie" && item.MediaType != "tv" {
			c.JSON(http.StatusBadRequest, gin.H{"error": "Media type must be movie or tv"})
			return
		}
		if item.MediaID == 0 {
			c.JSON(http.StatusBadRequest, gin.H{"error": "Media id is required"})
			return
		}
		if item.MediaType == "tv" && (item.SeasonNumber == nil || item.EpisodeNumber == nil) {
			c.JSON(http.StatusBadRequest, gin.H{"error": "Season and episode numbers are required for TV episodes"})
			return
		}
		if isUnreleased(item.MediaType, item.MediaID, item.SeasonNumber, item.EpisodeNumber) {
			continue
		}
		item.UserID = userUID
		item.WatchedAt = now
		addOrUpdateWatched(userUID, *item)
		addedCount++
	}

	c.JSON(http.StatusCreated, gin.H{"added": addedCount})
}

func handleDeleteWatched(c *gin.Context) {
	userID, ok := c.Get("user_id")
	if !ok {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "Unauthorized"})
		return
	}
	userUID := userID.(uint)

	var req WatchedItem
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Invalid watched payload"})
		return
	}
	if req.MediaType != "movie" && req.MediaType != "tv" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Media type must be movie or tv"})
		return
	}
	if req.MediaID == 0 {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Media id is required"})
		return
	}

	query := db.Where("user_id = ? AND media_id = ? AND media_type = ?", userUID, req.MediaID, req.MediaType)
	if req.MediaType == "tv" {
		if req.SeasonNumber != nil {
			query = query.Where("season_number = ?", *req.SeasonNumber)
		} else {
			query = query.Where("season_number IS NULL")
		}
		if req.EpisodeNumber != nil {
			query = query.Where("episode_number = ?", *req.EpisodeNumber)
		} else {
			query = query.Where("episode_number IS NULL")
		}
	}

	if err := query.Delete(&WatchedItem{}).Error; err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to remove from watched list"})
		return
	}

	c.Status(http.StatusNoContent)
}

func handleGetWatched(c *gin.Context) {
	userID, ok := c.Get("user_id")
	if !ok {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "Unauthorized"})
		return
	}
	userUID := userID.(uint)

	items := getUserWatched(userUID)
	c.JSON(http.StatusOK, items)
}

func handleWatchedStatus(c *gin.Context) {
	mediaID, err := parseID(c.Query("media_id"))
	if err != nil || mediaID == 0 {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Invalid media id"})
		return
	}
	mediaType := c.Query("type")
	if mediaType != "movie" && mediaType != "tv" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Media type must be movie or tv"})
		return
	}

	// Optional authentication check
	var userUID uint
	authHeader := c.GetHeader("Authorization")
	if authHeader != "" {
		parts := strings.SplitN(authHeader, " ", 2)
		if len(parts) == 2 && parts[0] == "Bearer" {
			tokenString := parts[1]
			token, err := jwt.Parse(tokenString, func(token *jwt.Token) (interface{}, error) {
				if _, ok := token.Method.(*jwt.SigningMethodHMAC); !ok {
					return nil, fmt.Errorf("unexpected signing method: %v", token.Header["alg"])
				}
				return jwtSecret, nil
			})
			if err == nil && token.Valid {
				if claims, ok := token.Claims.(jwt.MapClaims); ok {
					if idFloat, ok := claims["user_id"].(float64); ok {
						userUID = uint(idFloat)
					}
				}
			}
		}
	}

	if userUID == 0 {
		// User is not logged in: return empty watched state
		if mediaType == "movie" {
			c.JSON(http.StatusOK, gin.H{"watched": false})
		} else {
			c.JSON(http.StatusOK, gin.H{"episodes": []gin.H{}})
		}
		return
	}

	items := getUserWatched(userUID)
	if mediaType == "movie" {
		watched := false
		for _, item := range items {
			if item.MediaID == mediaID && item.MediaType == "movie" {
				watched = true
				break
			}
		}
		c.JSON(http.StatusOK, gin.H{"watched": watched})
		return
	}

	episodes := []gin.H{}
	for _, item := range items {
		if item.MediaID == mediaID && item.MediaType == "tv" && item.SeasonNumber != nil && item.EpisodeNumber != nil {
			episodes = append(episodes, gin.H{"season": *item.SeasonNumber, "episode": *item.EpisodeNumber})
		}
	}
	c.JSON(http.StatusOK, gin.H{"episodes": episodes})
}

type tmdbTVSummary struct {
	NumberOfEpisodes int64  `json:"number_of_episodes"`
	Status           string `json:"status"`
}

func isWatchlistItemFullyWatched(userID uint, item TMDBMedia) bool {
	mediaType := item.MediaType
	if mediaType == "" {
		if item.Title != "" {
			mediaType = "movie"
		} else {
			mediaType = "tv"
		}
	}

	watched := getUserWatched(userID)

	if mediaType == "movie" {
		for _, w := range watched {
			if w.MediaID == item.ID && w.MediaType == "movie" {
				return true
			}
		}
		return false
	}

	total, status, err := fetchTVTotalEpisodesAndStatus(item.ID)
	if err != nil || total == 0 {
		return false
	}

	watchedCount := 0
	for _, w := range watched {
		if w.MediaID == item.ID && w.MediaType == "tv" {
			watchedCount++
		}
	}

	isFullyWatched := int64(watchedCount) >= total
	if !isFullyWatched {
		return false
	}

	lowerStatus := strings.ToLower(status)
	if lowerStatus == "ended" || lowerStatus == "canceled" || lowerStatus == "cancelled" {
		return true
	}

	return false
}

func fetchTVTotalEpisodesAndStatus(seriesID int64) (int64, string, error) {
	apiKey := os.Getenv("TMDB_API_KEY")
	if apiKey == "dummy" {
		details, ok := getMockMediaDetails("tv", seriesID)
		if !ok {
			details = getFallbackMediaDetails("tv", seriesID)
		}
		var totalEpisodes int64
		for _, season := range details.Seasons {
			if season.SeasonNumber >= 1 {
				totalEpisodes += season.EpisodeCount
			}
		}
		if totalEpisodes == 0 && len(details.Seasons) > 0 {
			totalEpisodes = details.Seasons[0].EpisodeCount
		}
		return totalEpisodes, details.Status, nil
	}

	url := fmt.Sprintf("https://api.themoviedb.org/3/tv/%d", seriesID)
	var summary tmdbTVSummary
	if err := tmdbGet(url, apiKey, &summary); err != nil {
		return 0, "", err
	}
	return summary.NumberOfEpisodes, summary.Status, nil
}

func addOrUpdateWatched(userID uint, item WatchedItem) {
	query := db.Where("user_id = ? AND media_id = ? AND media_type = ?", userID, item.MediaID, item.MediaType)
	if item.SeasonNumber == nil {
		query = query.Where("season_number IS NULL")
	} else {
		query = query.Where("season_number = ?", *item.SeasonNumber)
	}
	if item.EpisodeNumber == nil {
		query = query.Where("episode_number IS NULL")
	} else {
		query = query.Where("episode_number = ?", *item.EpisodeNumber)
	}

	var existing WatchedItem
	if err := query.First(&existing).Error; err == nil {
		existing.WatchedAt = item.WatchedAt
		db.Save(&existing)
	} else {
		db.Create(&item)
	}
}

func getUserWatched(userID uint) []WatchedItem {
	var items []WatchedItem
	db.Where("user_id = ?", userID).Find(&items)
	return items
}

func ptrInt64Equal(a, b *int64) bool {
	if a == nil && b == nil {
		return true
	}
	if a == nil || b == nil {
		return false
	}
	return *a == *b
}

func isUnreleased(mediaType string, mediaID int64, seasonNum, episodeNum *int64) bool {
	if mediaType == "movie" {
		apiKey := os.Getenv("TMDB_API_KEY")
		var releaseDateStr string
		if apiKey == "dummy" {
			details, ok := getMockMediaDetails("movie", mediaID)
			if !ok {
				details = getFallbackMediaDetails("movie", mediaID)
			}
			releaseDateStr = details.ReleaseDate
		} else {
			detailsURL := fmt.Sprintf("https://api.themoviedb.org/3/movie/%d", mediaID)
			var response tmdbMediaDetailsResponse
			if err := tmdbGet(detailsURL, apiKey, &response); err != nil {
				details, ok := getMockMediaDetails("movie", mediaID)
				if !ok {
					details = getFallbackMediaDetails("movie", mediaID)
				}
				releaseDateStr = details.ReleaseDate
			} else {
				releaseDateStr = response.ReleaseDate
			}
		}

		if releaseDateStr == "" {
			return false
		}

		releaseDate, err := time.Parse("2006-01-02", releaseDateStr)
		if err != nil {
			return false
		}

		today := time.Now().Truncate(24 * time.Hour)
		return releaseDate.After(today)
	}

	if mediaType == "tv" {
		if seasonNum == nil || episodeNum == nil {
			return false
		}

		apiKey := os.Getenv("TMDB_API_KEY")
		var airDateStr string
		if apiKey == "dummy" {
			episode, ok := getMockEpisodeDetails(mediaID, *seasonNum, *episodeNum)
			if !ok {
				return false
			}
			airDateStr = episode.AirDate
		} else {
			episodeURL := fmt.Sprintf("https://api.themoviedb.org/3/tv/%d/season/%d/episode/%d", mediaID, *seasonNum, *episodeNum)
			var episode Episode
			if err := tmdbGet(episodeURL, apiKey, &episode); err != nil {
				ep, ok := getMockEpisodeDetails(mediaID, *seasonNum, *episodeNum)
				if !ok {
					return false
				}
				airDateStr = ep.AirDate
			} else {
				airDateStr = episode.AirDate
			}
		}

		if airDateStr == "" {
			return false
		}

		airDate, err := time.Parse("2006-01-02", airDateStr)
		if err != nil {
			return false
		}

		today := time.Now().Truncate(24 * time.Hour)
		return airDate.After(today)
	}

	return false
}
