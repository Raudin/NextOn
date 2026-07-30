package main

import (
	"encoding/json"
	"fmt"
	"log"
	"net/http"
	"os"
	"sort"
	"strings"
	"sync"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/golang-jwt/jwt/v5"
	"github.com/joho/godotenv"
	"golang.org/x/crypto/bcrypt"
	"github.com/glebarez/sqlite"
	"gorm.io/gorm"
)

// GORM Models
type User struct {
	ID           uint      `gorm:"primaryKey" json:"id"`
	Email        string    `gorm:"uniqueIndex;not null" json:"email"`
	PasswordHash string    `gorm:"not null" json:"-"`
	CreatedAt    time.Time `json:"created_at"`
}

type WatchlistItem struct {
	ID           uint      `gorm:"primaryKey" json:"id"`
	UserID       uint      `gorm:"not null;uniqueIndex:idx_user_watchlist" json:"user_id"`
	MediaID      int64     `gorm:"not null;uniqueIndex:idx_user_watchlist" json:"media_id"`
	Title        string    `json:"title,omitempty"`
	Name         string    `json:"name,omitempty"`
	PosterPath   string    `json:"poster_path"`
	BackdropPath string    `json:"backdrop_path"`
	VoteAverage  float64   `json:"vote_average"`
	MediaType    string    `json:"media_type,omitempty"`
	ReleaseDate  string    `json:"release_date,omitempty"`
	FirstAirDate string    `json:"first_air_date,omitempty"`
	CreatedAt    time.Time `json:"created_at"`
}

type WatchedItem struct {
	ID            uint      `gorm:"primaryKey" json:"id"`
	UserID        uint      `gorm:"not null;uniqueIndex:idx_user_watched" json:"user_id"`
	MediaID       int64     `gorm:"not null;uniqueIndex:idx_user_watched" json:"media_id"`
	MediaType     string    `gorm:"not null" json:"media_type"`
	SeasonNumber  *int64    `gorm:"uniqueIndex:idx_user_watched" json:"season_number,omitempty"`
	EpisodeNumber *int64    `gorm:"uniqueIndex:idx_user_watched" json:"episode_number,omitempty"`
	WatchedAt     time.Time `json:"watched_at"`
}

// TMDBMedia represents a movie or TV show item from TMDB
type TMDBMedia struct {
	ID           int64   `json:"id"`
	Title        string  `json:"title,omitempty"`
	Name         string  `json:"name,omitempty"`
	PosterPath   string  `json:"poster_path"`
	BackdropPath string  `json:"backdrop_path"`
	VoteAverage  float64 `json:"vote_average"`
	MediaType    string  `json:"media_type,omitempty"`
	ReleaseDate  string  `json:"release_date,omitempty"`
	FirstAirDate string  `json:"first_air_date,omitempty"`
}

type Genre struct {
	ID   int64  `json:"id"`
	Name string `json:"name"`
}

type CastMember struct {
	ID          int64  `json:"id"`
	Name        string `json:"name"`
	ProfilePath string `json:"profile_path"`
}

type Season struct {
	ID           int64  `json:"id"`
	SeasonNumber int64  `json:"season_number"`
	Name         string `json:"name"`
	Overview     string `json:"overview"`
	EpisodeCount int64  `json:"episode_count"`
	PosterPath   string `json:"poster_path"`
}

type Episode struct {
	ID            int64  `json:"id"`
	Name          string `json:"name"`
	Overview      string `json:"overview"`
	EpisodeNumber int64  `json:"episode_number"`
	SeasonNumber  int64  `json:"season_number"`
	StillPath     string `json:"still_path"`
	AirDate       string `json:"air_date"`
	Runtime       int64  `json:"runtime,omitempty"`
}

type SeasonDetails struct {
	ID           int64     `json:"id"`
	SeasonNumber int64     `json:"season_number"`
	Name         string    `json:"name"`
	Overview     string    `json:"overview"`
	Episodes     []Episode `json:"episodes"`
}

type MediaDetails struct {
	TMDBMedia
	Runtime         int64        `json:"runtime,omitempty"`
	EpisodeRunTime  []int64      `json:"episode_run_time,omitempty"`
	NumberOfSeasons int64        `json:"number_of_seasons,omitempty"`
	Seasons         []Season     `json:"seasons,omitempty"`
	Overview        string       `json:"overview"`
	Genres          []Genre      `json:"genres"`
	Cast            []CastMember `json:"cast"`
}

type tmdbCredits struct {
	Cast []CastMember `json:"cast"`
}

type tmdbMediaDetailsResponse struct {
	MediaDetails
	Credits tmdbCredits `json:"credits"`
}

// TMDBResponse matches the list response from TMDB endpoints
type TMDBResponse struct {
	Page    int         `json:"page"`
	Results []TMDBMedia `json:"results"`
}

// DiscoverResponse is the clean, combined object returned to the frontend
type DiscoverResponse struct {
	Trending []TMDBMedia `json:"trending"`
	Popular  []TMDBMedia `json:"popular"`
}

// Cache holds the cached DiscoverResponse and its expiration time
type Cache struct {
	sync.RWMutex
	data      *DiscoverResponse
	expiresAt time.Time
	duration  time.Duration
}

var (
	discoverCache *Cache
	db            *gorm.DB
	jwtSecret     = []byte("nexton-secret-key-1234567890")
)

func init() {
	// Initialize cache with a 10-minute expiration rule
	discoverCache = &Cache{
		duration: 10 * time.Minute,
	}
	if secret := os.Getenv("JWT_SECRET"); secret != "" {
		jwtSecret = []byte(secret)
	}
}

func initDB() {
	var err error
	db, err = gorm.Open(sqlite.Open("nexton.db"), &gorm.Config{})
	if err != nil {
		log.Fatalf("Failed to connect database: %v", err)
	}

	// Auto Migrate
	err = db.AutoMigrate(&User{}, &WatchlistItem{}, &WatchedItem{})
	if err != nil {
		log.Fatalf("Failed to auto migrate database: %v", err)
	}
	log.Println("SQLite Database migrated successfully.")
}

// AuthMiddleware validates JWT bearer token and injects user_id into context
func AuthMiddleware() gin.HandlerFunc {
	return func(c *gin.Context) {
		authHeader := c.GetHeader("Authorization")
		if authHeader == "" {
			c.JSON(http.StatusUnauthorized, gin.H{"error": "Authorization header is required"})
			c.Abort()
			return
		}

		parts := strings.SplitN(authHeader, " ", 2)
		if !(len(parts) == 2 && parts[0] == "Bearer") {
			c.JSON(http.StatusUnauthorized, gin.H{"error": "Authorization header must be Bearer token"})
			c.Abort()
			return
		}

		tokenString := parts[1]
		token, err := jwt.Parse(tokenString, func(token *jwt.Token) (interface{}, error) {
			if _, ok := token.Method.(*jwt.SigningMethodHMAC); !ok {
				return nil, fmt.Errorf("unexpected signing method: %v", token.Header["alg"])
			}
			return jwtSecret, nil
		})

		if err != nil || !token.Valid {
			c.JSON(http.StatusUnauthorized, gin.H{"error": "Invalid or expired token"})
			c.Abort()
			return
		}

		claims, ok := token.Claims.(jwt.MapClaims)
		if !ok {
			c.JSON(http.StatusUnauthorized, gin.H{"error": "Invalid token claims"})
			c.Abort()
			return
		}

		userIDFloat, ok := claims["user_id"].(float64)
		if !ok {
			c.JSON(http.StatusUnauthorized, gin.H{"error": "Invalid user ID in token"})
			c.Abort()
			return
		}

		c.Set("user_id", uint(userIDFloat))
		c.Next()
	}
}

func main() {
	// Load .env if present
	if err := godotenv.Load(); err != nil {
		log.Println("Info: No .env file found, relying on system environment variables")
	}

	port := os.Getenv("PORT")
	if port == "" {
		port = "8080"
	}

	// Initialize SQLite DB with GORM
	initDB()

	// Configure Gin
	r := gin.Default()

	// CORS Middleware
	r.Use(func(c *gin.Context) {
		c.Writer.Header().Set("Access-Control-Allow-Origin", "*")
		c.Writer.Header().Set("Access-Control-Allow-Credentials", "true")
		c.Writer.Header().Set("Access-Control-Allow-Headers", "Content-Type, Content-Length, Accept-Encoding, X-CSRF-Token, Authorization, accept, origin, Cache-Control, X-Requested-With")
		c.Writer.Header().Set("Access-Control-Allow-Methods", "POST, OPTIONS, GET, PUT, DELETE")

		if c.Request.Method == "OPTIONS" {
			c.AbortWithStatus(204)
			return
		}

		c.Next()
	})

	// Auth Endpoints
	r.POST("/api/auth/signup", handleSignup)
	r.POST("/api/auth/login", handleLogin)

	// Discover & Search (Publicly browsable)
	r.GET("/api/discover", handleDiscover)
	r.GET("/api/search", handleSearch)

	// Watchlist (Private, authenticated)
	r.POST("/api/watchlist", AuthMiddleware(), handleAddWatchlist)
	r.GET("/api/watchlist", AuthMiddleware(), handleGetWatchlist)
	r.DELETE("/api/watchlist/:id", AuthMiddleware(), handleDeleteWatchlist)

	// Media Details (Publicly browsable)
	r.GET("/api/media/movie/:id", handleMovieDetails)
	r.GET("/api/media/tv/:id", handleTvDetails)
	r.GET("/api/media/tv/:id/season/:season", handleSeasonDetails)
	r.GET("/api/media/tv/:id/season/:season/episode/:episode", handleEpisodeDetails)

	// Watched (Private, authenticated)
	r.POST("/api/watched", AuthMiddleware(), handleAddWatched)
	r.POST("/api/watched/bulk", AuthMiddleware(), handleAddWatchedBulk)
	r.DELETE("/api/watched", AuthMiddleware(), handleDeleteWatched)
	r.GET("/api/watched", AuthMiddleware(), handleGetWatched)

	// Watched Status (Publicly queryable, checks auth optionally to avoid failing)
	r.GET("/api/watched/status", handleWatchedStatus)

	if os.Getenv("TMDB_API_KEY") == "" {
		log.Fatalf("FATAL: TMDB_API_KEY is not set. The backend requires a TMDB API key to start.")
	}

	log.Println("TMDB_API_KEY loaded successfully.")

	log.Printf("Server starting on port %s...", port)
	if err := r.Run(":" + port); err != nil {
		log.Fatalf("Failed to run server: %v", err)
	}
}

type SignupReq struct {
	Email    string `json:"email" binding:"required,email"`
	Password string `json:"password" binding:"required,min=6"`
}

type LoginReq struct {
	Email    string `json:"email" binding:"required"`
	Password string `json:"password" binding:"required"`
}

func handleSignup(c *gin.Context) {
	var req SignupReq
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Invalid email format or password length (min 6 characters required)"})
		return
	}

	email := strings.ToLower(strings.TrimSpace(req.Email))

	// Check if user exists
	var existing User
	if err := db.Where("email = ?", email).First(&existing).Error; err == nil {
		c.JSON(http.StatusConflict, gin.H{"error": "A user with this email already exists"})
		return
	}

	hashedPassword, err := bcrypt.GenerateFromPassword([]byte(req.Password), bcrypt.DefaultCost)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to encrypt password"})
		return
	}

	user := User{
		Email:        email,
		PasswordHash: string(hashedPassword),
		CreatedAt:    time.Now(),
	}

	if err := db.Create(&user).Error; err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to create user"})
		return
	}

	// Generate JWT Token
	token := jwt.NewWithClaims(jwt.SigningMethodHS256, jwt.MapClaims{
		"user_id": user.ID,
		"email":   user.Email,
		"exp":     time.Now().Add(24 * time.Hour).Unix(),
	})

	tokenString, err := token.SignedString(jwtSecret)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to sign session token"})
		return
	}

	c.JSON(http.StatusCreated, gin.H{
		"token": tokenString,
		"user": gin.H{
			"id":    user.ID,
			"email": user.Email,
		},
	})
}

func handleLogin(c *gin.Context) {
	var req LoginReq
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Email and password are required"})
		return
	}

	email := strings.ToLower(strings.TrimSpace(req.Email))

	var user User
	if err := db.Where("email = ?", email).First(&user).Error; err != nil {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "Invalid email or password"})
		return
	}

	if err := bcrypt.CompareHashAndPassword([]byte(user.PasswordHash), []byte(req.Password)); err != nil {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "Invalid email or password"})
		return
	}

	// Generate JWT Token
	token := jwt.NewWithClaims(jwt.SigningMethodHS256, jwt.MapClaims{
		"user_id": user.ID,
		"email":   user.Email,
		"exp":     time.Now().Add(24 * time.Hour).Unix(),
	})

	tokenString, err := token.SignedString(jwtSecret)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to sign session token"})
		return
	}

	c.JSON(http.StatusOK, gin.H{
		"token": tokenString,
		"user": gin.H{
			"id":    user.ID,
			"email": user.Email,
		},
	})
}

func handleSearch(c *gin.Context) {
	query := strings.TrimSpace(c.Query("q"))
	if query == "" {
		c.JSON(http.StatusOK, []TMDBMedia{})
		return
	}

	apiKey := os.Getenv("TMDB_API_KEY")

	searchURL := "https://api.themoviedb.org/3/search/multi"
	var response TMDBResponse
	if err := tmdbGetWithParams(searchURL, apiKey, map[string]string{
		"query":         query,
		"include_adult": "false",
	}, &response); err != nil {
		log.Printf("Error searching TMDB: %v", err)
		c.JSON(http.StatusBadGateway, gin.H{"error": "Failed to search media"})
		return
	}

	results := make([]TMDBMedia, 0, len(response.Results))
	for _, item := range response.Results {
		if item.MediaType != "movie" && item.MediaType != "tv" {
			continue
		}
		results = append(results, item)
	}

	c.JSON(http.StatusOK, results)
}

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

func handleMediaDetails(c *gin.Context) {
	mediaType := c.Param("type")
	if mediaType != "movie" && mediaType != "tv" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Media type must be movie or tv"})
		return
	}
	fetchAndSendMediaDetails(c, mediaType)
}

func handleMovieDetails(c *gin.Context) {
	fetchAndSendMediaDetails(c, "movie")
}

func handleTvDetails(c *gin.Context) {
	fetchAndSendMediaDetails(c, "tv")
}

func fetchAndSendMediaDetails(c *gin.Context, mediaType string) {
	id, err := parseID(c.Param("id"))
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Invalid media id"})
		return
	}

	apiKey := os.Getenv("TMDB_API_KEY")
	var details *MediaDetails

	if apiKey == "dummy" {
		var ok bool
		details, ok = getMockMediaDetails(mediaType, id)
		if !ok {
			details = getFallbackMediaDetails(mediaType, id)
		}
	} else {
		detailsURL := fmt.Sprintf("https://api.themoviedb.org/3/%s/%d", mediaType, id)
		var response tmdbMediaDetailsResponse
		if err := tmdbGetWithParams(detailsURL, apiKey, map[string]string{
			"append_to_response": "credits",
		}, &response); err != nil {
			log.Printf("Error fetching TMDB media details for %s/%d: %v. Falling back to mock.", mediaType, id, err)
			var ok bool
			details, ok = getMockMediaDetails(mediaType, id)
			if !ok {
				details = getFallbackMediaDetails(mediaType, id)
			}
		} else {
			detailsVal := response.MediaDetails
			detailsVal.ID = id
			detailsVal.MediaType = mediaType
			detailsVal.Cast = topCast(response.Credits.Cast, 12)
			details = &detailsVal
		}
	}

	c.JSON(http.StatusOK, details)
}

func handleSeasonDetails(c *gin.Context) {
	seriesID, err := parseID(c.Param("id"))
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Invalid series id"})
		return
	}
	seasonNum, err := parseID(c.Param("season"))
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Invalid season number"})
		return
	}

	apiKey := os.Getenv("TMDB_API_KEY")
	var season *SeasonDetails

	if apiKey == "dummy" {
		var ok bool
		season, ok = getMockSeasonDetails(seriesID, seasonNum)
		if !ok {
			c.JSON(http.StatusNotFound, gin.H{"error": "Season not found in mock"})
			return
		}
	} else {
		seasonURL := fmt.Sprintf("https://api.themoviedb.org/3/tv/%d/season/%d", seriesID, seasonNum)
		var s SeasonDetails
		if err := tmdbGet(seasonURL, apiKey, &s); err != nil {
			log.Printf("Error fetching TMDB season details: %v. Falling back to mock.", err)
			var ok bool
			season, ok = getMockSeasonDetails(seriesID, seasonNum)
			if !ok {
				c.JSON(http.StatusBadGateway, gin.H{"error": "Failed to fetch season details"})
				return
			}
		} else {
			season = &s
		}
	}
	c.JSON(http.StatusOK, season)
}

func handleEpisodeDetails(c *gin.Context) {
	seriesID, err := parseID(c.Param("id"))
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Invalid series id"})
		return
	}
	seasonNum, err := parseID(c.Param("season"))
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Invalid season number"})
		return
	}
	episodeNum, err := parseID(c.Param("episode"))
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Invalid episode number"})
		return
	}

	apiKey := os.Getenv("TMDB_API_KEY")
	var episode *Episode

	if apiKey == "dummy" {
		var ok bool
		episode, ok = getMockEpisodeDetails(seriesID, seasonNum, episodeNum)
		if !ok {
			c.JSON(http.StatusNotFound, gin.H{"error": "Episode not found in mock"})
			return
		}
	} else {
		episodeURL := fmt.Sprintf("https://api.themoviedb.org/3/tv/%d/season/%d/episode/%d", seriesID, seasonNum, episodeNum)
		var ep Episode
		if err := tmdbGet(episodeURL, apiKey, &ep); err != nil {
			log.Printf("Error fetching TMDB episode details: %v. Falling back to mock.", err)
			var ok bool
			episode, ok = getMockEpisodeDetails(seriesID, seasonNum, episodeNum)
			if !ok {
				c.JSON(http.StatusBadGateway, gin.H{"error": "Failed to fetch episode details"})
				return
			}
		} else {
			episode = &ep
		}
	}
	c.JSON(http.StatusOK, episode)
}

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
		item.UserID = userUID
		item.WatchedAt = now
		addOrUpdateWatched(userUID, *item)
	}

	c.JSON(http.StatusCreated, gin.H{"added": len(req.Items)})
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
	NumberOfEpisodes int64 `json:"number_of_episodes"`
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

	total, err := fetchTVTotalEpisodes(item.ID)
	if err != nil || total == 0 {
		return false
	}

	watchedCount := 0
	for _, w := range watched {
		if w.MediaID == item.ID && w.MediaType == "tv" {
			watchedCount++
		}
	}
	return int64(watchedCount) >= total
}

func fetchTVTotalEpisodes(seriesID int64) (int64, error) {
	apiKey := os.Getenv("TMDB_API_KEY")
	url := fmt.Sprintf("https://api.themoviedb.org/3/tv/%d", seriesID)
	var summary tmdbTVSummary
	if err := tmdbGet(url, apiKey, &summary); err != nil {
		return 0, err
	}
	return summary.NumberOfEpisodes, nil
}

func handleDiscover(c *gin.Context) {
	// 1. Read Lock Cache Check
	discoverCache.RLock()
	if discoverCache.data != nil && time.Now().Before(discoverCache.expiresAt) {
		data := discoverCache.data
		discoverCache.RUnlock()
		log.Println("Serving discover response from memory cache")
		c.JSON(http.StatusOK, data)
		return
	}
	discoverCache.RUnlock()

	// 2. Cache expired or empty: Acquire Write Lock
	discoverCache.Lock()
	defer discoverCache.Unlock()

	// Double-check condition after acquiring lock (avoid race condition)
	if discoverCache.data != nil && time.Now().Before(discoverCache.expiresAt) {
		c.JSON(http.StatusOK, discoverCache.data)
		return
	}

	log.Println("Cache expired or empty. Fetching fresh data...")
	var data *DiscoverResponse
	var err error
	if os.Getenv("TMDB_API_KEY") == "dummy" {
		data = getMockDiscoverData()
	} else {
		data, err = fetchDiscoverData()
		if err != nil {
			log.Printf("Error fetching discover data: %v. Falling back to mock.", err)
			data = getMockDiscoverData()
			err = nil
		}
	}

	if err != nil {
		c.JSON(http.StatusBadGateway, gin.H{"error": "Failed to fetch discover data"})
		return
	}

	// Update cache
	discoverCache.data = data
	discoverCache.expiresAt = time.Now().Add(discoverCache.duration)

	c.JSON(http.StatusOK, data)
}

func fetchDiscoverData() (*DiscoverResponse, error) {
	apiKey := os.Getenv("TMDB_API_KEY")

	// Fetch Trending
	var trending TMDBResponse
	trendingURL := "https://api.themoviedb.org/3/trending/all/day"
	if err := tmdbGet(trendingURL, apiKey, &trending); err != nil {
		return nil, fmt.Errorf("failed to fetch trending: %w", err)
	}

	// Fetch Popular Movies
	var popular TMDBResponse
	popularURL := "https://api.themoviedb.org/3/movie/popular"
	if err := tmdbGet(popularURL, apiKey, &popular); err != nil {
		return nil, fmt.Errorf("failed to fetch popular: %w", err)
	}

	// Unify popular list media type to "movie"
	for i := range popular.Results {
		if popular.Results[i].MediaType == "" {
			popular.Results[i].MediaType = "movie"
		}
	}

	return &DiscoverResponse{
		Trending: trending.Results,
		Popular:  popular.Results,
	}, nil
}

func tmdbGet(baseURL, apiKey string, target interface{}) error {
	return tmdbGetWithParams(baseURL, apiKey, nil, target)
}

func tmdbGetWithParams(baseURL, apiKey string, params map[string]string, target interface{}) error {
	req, err := http.NewRequest("GET", baseURL, nil)
	if err != nil {
		return err
	}

	q := req.URL.Query()
	for key, value := range params {
		q.Set(key, value)
	}

	// Check if apiKey is a long v4 JWT token or standard v3 hex key
	if len(apiKey) > 50 {
		req.Header.Set("Authorization", "Bearer "+apiKey)
		req.Header.Set("accept", "application/json")
	} else {
		q.Set("api_key", apiKey)
	}
	req.URL.RawQuery = q.Encode()

	client := &http.Client{Timeout: 8 * time.Second}
	resp, err := client.Do(req)
	if err != nil {
		return err
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		return fmt.Errorf("TMDB API returned status code %d", resp.StatusCode)
	}

	return json.NewDecoder(resp.Body).Decode(target)
}

func parseID(value string) (int64, error) {
	var id int64
	_, err := fmt.Sscan(value, &id)
	return id, err
}

func displayTitle(item TMDBMedia) string {
	if item.Title != "" {
		return strings.ToLower(item.Title)
	}
	return strings.ToLower(item.Name)
}

func filterMockMedia(_ string) []TMDBMedia {
	return []TMDBMedia{}
}

func topCast(cast []CastMember, limit int) []CastMember {
	if len(cast) < limit {
		limit = len(cast)
	}
	safe := make([]CastMember, 0, limit)
	for _, member := range cast {
		if member.Name == "" {
			continue
		}
		safe = append(safe, CastMember{
			ID:          member.ID,
			Name:        member.Name,
			ProfilePath: member.ProfilePath,
		})
		if len(safe) == limit {
			break
		}
	}
	return safe
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

func getMockDiscoverData() *DiscoverResponse {
	// Realistic, high-fidelity mock data using actual TMDB poster/backdrop paths
	// and details to ensure a gorgeous layout even without an API key.
	trending := []TMDBMedia{
		{
			ID:           558449,
			Title:        "Gladiator II",
			PosterPath:   "/2cxhv044tcl7eVm26LsGs4886tq.jpg",
			BackdropPath: "/3V4kDRpwBMj4NfbORkZIIjK2mIE.jpg",
			VoteAverage:  6.8,
			MediaType:    "movie",
			ReleaseDate:  "2024-11-05",
		},
		{
			ID:           939243,
			Title:        "Sonic the Hedgehog 3",
			PosterPath:   "/d8Ruo3Q5Z36K3x2rJ4t5ehZ0P6q.jpg",
			BackdropPath: "/zfbjgqjCpwlxXgny7aPQptQ4vF5.jpg",
			VoteAverage:  7.8,
			MediaType:    "movie",
			ReleaseDate:  "2024-12-19",
		},
		{
			ID:           135397,
			Name:         "Squid Game",
			PosterPath:   "/1xsGGB446l59er765XvFWfhVxK.jpg",
			BackdropPath: "/yg0ihCPPn0Zc7x570hCkiR3rSp5.jpg",
			VoteAverage:  7.9,
			MediaType:    "tv",
			FirstAirDate: "2021-09-17",
		},
		{
			ID:           402431,
			Title:        "Wicked",
			PosterPath:   "/2nuK5Wtb76xS47TveQG6S65dNdD.jpg",
			BackdropPath: "/uKb2jW2SNee5T58Cn7g6225Xcl1.jpg",
			VoteAverage:  7.4,
			MediaType:    "movie",
			ReleaseDate:  "2024-11-20",
		},
		{
			ID:           119051,
			Name:         "Wednesday",
			PosterPath:   "/9PFw32r216Teg3LgolnACz7VAat.jpg",
			BackdropPath: "/iHjx1zR12948yR9Vsc4Z648wv2u.jpg",
			VoteAverage:  8.0,
			MediaType:    "tv",
			FirstAirDate: "2022-11-23",
		},
		{
			ID:           1022789,
			Title:        "Inside Out 2",
			PosterPath:   "/vpnVM9B6NMmFJWqRKxOKDmqnNJr.jpg",
			BackdropPath: "/stKG8fbvqvPAywj67HgkWh4IQUg.jpg",
			VoteAverage:  7.6,
			MediaType:    "movie",
			ReleaseDate:  "2024-06-11",
		},
	}

	popular := []TMDBMedia{
		{
			ID:           939243,
			Title:        "Sonic the Hedgehog 3",
			PosterPath:   "/d8Ruo3Q5Z36K3x2rJ4t5ehZ0P6q.jpg",
			BackdropPath: "/zfbjgqjCpwlxXgny7aPQptQ4vF5.jpg",
			VoteAverage:  7.8,
			MediaType:    "movie",
			ReleaseDate:  "2024-12-19",
		},
		{
			ID:           558449,
			Title:        "Gladiator II",
			PosterPath:   "/2cxhv044tcl7eVm26LsGs4886tq.jpg",
			BackdropPath: "/3V4kDRpwBMj4NfbORkZIIjK2mIE.jpg",
			VoteAverage:  6.8,
			MediaType:    "movie",
			ReleaseDate:  "2024-11-05",
		},
		{
			ID:           762509,
			Title:        "Mufasa: The Lion King",
			PosterPath:   "/7C92170o6AXTVRlbbG36O60H0jB.jpg",
			BackdropPath: "/oHGlUzUi3t6q6VIPiOAXmgEH66c.jpg",
			VoteAverage:  7.1,
			MediaType:    "movie",
			ReleaseDate:  "2024-12-18",
		},
		{
			ID:           1241982,
			Title:        "Moana 2",
			PosterPath:   "/yh64goTFrm21Sfl7L08j5l7LGn7.jpg",
			BackdropPath: "/h7rJvl7vl45615nZOC6ZfxmZuu6.jpg",
			VoteAverage:  7.0,
			MediaType:    "movie",
			ReleaseDate:  "2024-11-27",
		},
	}

	return &DiscoverResponse{
		Trending: trending,
		Popular:  popular,
	}
}

func getMockSeasonDetails(seriesID, seasonNum int64) (*SeasonDetails, bool) {
	if seasonNum < 1 {
		return nil, false
	}
	var count int
	var name string
	switch seriesID {
	case 135397:
		count = 9
		name = "Season 1"
	case 119051:
		count = 8
		name = "Season 1"
	default:
		count = 6
		name = fmt.Sprintf("Season %d", seasonNum)
	}

	episodes := make([]Episode, 0, count)
	for i := 1; i <= count; i++ {
		episodes = append(episodes, Episode{
			ID:            int64(i),
			Name:          fmt.Sprintf("Episode %d", i),
			Overview:      fmt.Sprintf("Overview for episode %d.", i),
			EpisodeNumber: int64(i),
			SeasonNumber:  seasonNum,
		})
	}

	return &SeasonDetails{
		ID:           seasonNum,
		SeasonNumber: seasonNum,
		Name:         name,
		Overview:     "",
		Episodes:     episodes,
	}, true
}

func getMockEpisodeDetails(seriesID, seasonNum, episodeNum int64) (*Episode, bool) {
	season, ok := getMockSeasonDetails(seriesID, seasonNum)
	if !ok {
		return nil, false
	}
	for _, ep := range season.Episodes {
		if ep.EpisodeNumber == episodeNum {
			return &ep, true
		}
	}
	return nil, false
}

func getFallbackMediaDetails(mediaType string, id int64) *MediaDetails {
	details := &MediaDetails{
		Overview: "Details are not available without a TMDB API key. Add TMDB_API_KEY to your environment for full data.",
		Genres:   []Genre{},
		Cast:     []CastMember{},
	}
	details.ID = id
	details.MediaType = mediaType
	details.VoteAverage = 0
	if mediaType == "tv" {
		details.Name = fmt.Sprintf("TV Show %d", id)
		details.NumberOfSeasons = 1
		details.Seasons = []Season{
			{ID: 1, SeasonNumber: 1, Name: "Season 1", Overview: "", EpisodeCount: 6},
		}
		details.EpisodeRunTime = []int64{45}
	} else {
		details.Title = fmt.Sprintf("Movie %d", id)
		details.Runtime = 120
	}
	return details
}

func getMockMediaDetails(mediaType string, id int64) (*MediaDetails, bool) {
	lookup := map[int64]MediaDetails{
		558449: {
			TMDBMedia: TMDBMedia{
				ID:           558449,
				Title:        "Gladiator II",
				PosterPath:   "/2cxhv044tcl7eVm26LsGs4886tq.jpg",
				BackdropPath: "/3V4kDRpwBMj4NfbORkZIIjK2mIE.jpg",
				VoteAverage:  6.8,
				MediaType:    "movie",
				ReleaseDate:  "2024-11-05",
			},
			Runtime:  148,
			Overview: "Years after witnessing the death of Maximus, Lucius is forced to enter the Colosseum after his home is conquered by tyrannical emperors who now lead Rome.",
			Genres:   []Genre{{ID: 28, Name: "Action"}, {ID: 12, Name: "Adventure"}, {ID: 18, Name: "Drama"}},
			Cast: []CastMember{
				{ID: 25072, Name: "Paul Mescal", ProfilePath: "/poKiP6PyjEbi0Cwl34qQJm5C6fB.jpg"},
				{ID: 5292, Name: "Denzel Washington", ProfilePath: "/jj2Gcobpopokal0YstuCQW0ldJ4.jpg"},
				{ID: 1158, Name: "Pedro Pascal", ProfilePath: "/9VYK7oxcqhjd5LAH6ZFJ3XzOlID.jpg"},
			},
		},
		939243: {
			TMDBMedia: TMDBMedia{
				ID:           939243,
				Title:        "Sonic the Hedgehog 3",
				PosterPath:   "/d8Ruo3Q5Z36K3x2rJ4t5ehZ0P6q.jpg",
				BackdropPath: "/zfbjgqjCpwlxXgny7aPQptQ4vF5.jpg",
				VoteAverage:  7.8,
				MediaType:    "movie",
				ReleaseDate:  "2024-12-19",
			},
			Runtime:  110,
			Overview: "Sonic, Knuckles, and Tails reunite against a powerful new adversary, Shadow, whose abilities force them to seek an unlikely alliance.",
			Genres:   []Genre{{ID: 28, Name: "Action"}, {ID: 35, Name: "Comedy"}, {ID: 10751, Name: "Family"}},
			Cast: []CastMember{
				{ID: 222121, Name: "Ben Schwartz", ProfilePath: "/5jVbHfxkLumu9Tcj0SwYv6sk5b5.jpg"},
				{ID: 6384, Name: "Jim Carrey", ProfilePath: "/u0AqTz6Y7GHPCHINS01P7gPvDSb.jpg"},
				{ID: 6383, Name: "Keanu Reeves", ProfilePath: "/4D0PpNI0kmP58hgrwGC3wCjxhnm.jpg"},
			},
		},
		135397: {
			TMDBMedia: TMDBMedia{
				ID:           135397,
				Name:         "Squid Game",
				PosterPath:   "/1xsGGB446l59er765XvFWfhVxK.jpg",
				BackdropPath: "/yg0ihCPPn0Zc7x570hCkiR3rSp5.jpg",
				VoteAverage:  7.9,
				MediaType:    "tv",
				FirstAirDate: "2021-09-17",
			},
			EpisodeRunTime:  []int64{54},
			NumberOfSeasons: 1,
			Seasons: []Season{
				{ID: 1, SeasonNumber: 1, Name: "Season 1", Overview: "", EpisodeCount: 9, PosterPath: "/1xsGGB446l59er765XvFWfhVxK.jpg"},
			},
			Overview: "Hundreds of cash-strapped players accept a strange invitation to compete in children's games for a tempting prize, but the stakes are deadly.",
			Genres:   []Genre{{ID: 10759, Name: "Action & Adventure"}, {ID: 9648, Name: "Mystery"}, {ID: 18, Name: "Drama"}},
			Cast: []CastMember{
				{ID: 73249, Name: "Lee Jung-jae", ProfilePath: "/dsI2ki9A7hZeSZ4vYd7EUDgL9De.jpg"},
				{ID: 3194501, Name: "Jung Ho-yeon", ProfilePath: "/4GxPdr4tP2FwwiO7kY6r1M8vW6h.jpg"},
				{ID: 65240, Name: "Lee Byung-hun", ProfilePath: "/zLwUqbyzJg1x3yTMSx3o2EusQkA.jpg"},
			},
		},
		402431: {
			TMDBMedia: TMDBMedia{
				ID:           402431,
				Title:        "Wicked",
				PosterPath:   "/2nuK5Wtb76xS47TveQG6S65dNdD.jpg",
				BackdropPath: "/uKb2jW2SNee5T58Cn7g6225Xcl1.jpg",
				VoteAverage:  7.4,
				MediaType:    "movie",
				ReleaseDate:  "2024-11-20",
			},
			Runtime:  160,
			Overview: "Elphaba, misunderstood because of her green skin, forms an unlikely friendship with Glinda before their lives take very different turns in Oz.",
			Genres:   []Genre{{ID: 18, Name: "Drama"}, {ID: 14, Name: "Fantasy"}, {ID: 10749, Name: "Romance"}},
			Cast: []CastMember{
				{ID: 1746573, Name: "Cynthia Erivo", ProfilePath: "/7QzLA6rsML2rKXGIGcH9LwW5z6D.jpg"},
				{ID: 226513, Name: "Ariana Grande", ProfilePath: "/r9Z7A0nD84m1xkFw7sR5B3V34N.jpg"},
				{ID: 1253360, Name: "Jonathan Bailey", ProfilePath: "/xRVasSgB2brLuFj1kq6U34MPo9V.jpg"},
			},
		},
		119051: {
			TMDBMedia: TMDBMedia{
				ID:           119051,
				Name:         "Wednesday",
				PosterPath:   "/9PFw32r216Teg3LgolnACz7VAat.jpg",
				BackdropPath: "/iHjx1zR12948yR9Vsc4Z648wv2u.jpg",
				VoteAverage:  8.0,
				MediaType:    "tv",
				FirstAirDate: "2022-11-23",
			},
			EpisodeRunTime:  []int64{48},
			NumberOfSeasons: 1,
			Seasons: []Season{
				{ID: 1, SeasonNumber: 1, Name: "Season 1", Overview: "", EpisodeCount: 8, PosterPath: "/9PFw32r216Teg3LgolnACz7VAat.jpg"},
			},
			Overview: "Smart, sarcastic Wednesday Addams investigates a murder spree while making new friends and enemies at Nevermore Academy.",
			Genres:   []Genre{{ID: 10765, Name: "Sci-Fi & Fantasy"}, {ID: 9648, Name: "Mystery"}, {ID: 35, Name: "Comedy"}},
			Cast: []CastMember{
				{ID: 974169, Name: "Jenna Ortega", ProfilePath: "/q1NRzyZQlYkxLY07GO9NVPkQnu8.jpg"},
				{ID: 1245, Name: "Catherine Zeta-Jones", ProfilePath: "/hWK9yghUnL0wA5ZDx4wvAZhU4DT.jpg"},
				{ID: 91804, Name: "Luis Guzman", ProfilePath: "/1n5vWyU6nF48Zxrp9RzcrwB3V4H.jpg"},
			},
		},
		1022789: {
			TMDBMedia: TMDBMedia{
				ID:           1022789,
				Title:        "Inside Out 2",
				PosterPath:   "/vpnVM9B6NMmFJWqRKxOKDmqnNJr.jpg",
				BackdropPath: "/stKG8fbvqvPAywj67HgkWh4IQUg.jpg",
				VoteAverage:  7.6,
				MediaType:    "movie",
				ReleaseDate:  "2024-06-11",
			},
			Runtime:  97,
			Overview: "Riley enters her teenage years, and Headquarters is suddenly disrupted by new emotions that complicate everything Joy thought she understood.",
			Genres:   []Genre{{ID: 16, Name: "Animation"}, {ID: 10751, Name: "Family"}, {ID: 35, Name: "Comedy"}},
			Cast: []CastMember{
				{ID: 56322, Name: "Amy Poehler", ProfilePath: "/hBJO9rVtO7SeC1FO8VBXMu5pM7v.jpg"},
				{ID: 86122, Name: "Maya Hawke", ProfilePath: "/jGiaJCPK0Y3jK62Cu6WKhG6WnTj.jpg"},
				{ID: 41088, Name: "Phyllis Smith", ProfilePath: "/wF4wltUcXlbYAIxzLkFo6ANkcTz.jpg"},
			},
		},
	}

	details, ok := lookup[id]
	if !ok || details.MediaType != mediaType {
		return nil, false
	}
	return &details, true
}
