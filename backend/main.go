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
	"github.com/joho/godotenv"
)

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

type WatchedItem struct {
	UserID        string    `json:"user_id"`
	MediaID       int64     `json:"media_id"`
	MediaType     string    `json:"media_type"`
	SeasonNumber  *int64    `json:"season_number,omitempty"`
	EpisodeNumber *int64    `json:"episode_number,omitempty"`
	WatchedAt     time.Time `json:"watched_at"`
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
)

var watchlistStore = struct {
	sync.RWMutex
	items map[int64]TMDBMedia
}{items: make(map[int64]TMDBMedia)}

var watchedStore = struct {
	sync.RWMutex
	items map[string][]WatchedItem
}{items: make(map[string][]WatchedItem)}

func init() {
	// Initialize cache with a 10-minute expiration rule
	discoverCache = &Cache{
		duration: 10 * time.Minute,
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

	// Discover Endpoint
	r.GET("/api/discover", handleDiscover)
	r.GET("/api/search", handleSearch)
	r.POST("/api/watchlist", handleAddWatchlist)
	r.GET("/api/watchlist", handleGetWatchlist)
	r.DELETE("/api/watchlist/:id", handleDeleteWatchlist)

	r.GET("/api/media/movie/:id", handleMovieDetails)
	r.GET("/api/media/tv/:id", handleTvDetails)
	r.GET("/api/media/tv/:id/season/:season", handleSeasonDetails)
	r.GET("/api/media/tv/:id/season/:season/episode/:episode", handleEpisodeDetails)

	r.POST("/api/watched", handleAddWatched)
	r.POST("/api/watched/bulk", handleAddWatchedBulk)
	r.DELETE("/api/watched", handleDeleteWatched)
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
	var item TMDBMedia
	if err := c.ShouldBindJSON(&item); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Invalid media payload"})
		return
	}
	if item.ID == 0 {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Media id is required"})
		return
	}

	watchlistStore.Lock()
	watchlistStore.items[item.ID] = item
	watchlistStore.Unlock()

	c.JSON(http.StatusCreated, item)
}

func handleGetWatchlist(c *gin.Context) {
	userID := c.DefaultQuery("user_id", "default")
	filterWatched := c.Query("filter_watched") == "true"

	watchlistStore.RLock()
	items := make([]TMDBMedia, 0, len(watchlistStore.items))
	for _, item := range watchlistStore.items {
		items = append(items, item)
	}
	watchlistStore.RUnlock()

	if filterWatched {
		filtered := make([]TMDBMedia, 0, len(items))
		for _, item := range items {
			if isWatchlistItemFullyWatched(userID, item) {
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
	id, err := parseID(c.Param("id"))
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Invalid media id"})
		return
	}

	watchlistStore.Lock()
	delete(watchlistStore.items, id)
	watchlistStore.Unlock()

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

	detailsURL := fmt.Sprintf("https://api.themoviedb.org/3/%s/%d", mediaType, id)
	var response tmdbMediaDetailsResponse
	if err := tmdbGetWithParams(detailsURL, apiKey, map[string]string{
		"append_to_response": "credits",
	}, &response); err != nil {
		log.Printf("Error fetching TMDB media details for %s/%d: %v", mediaType, id, err)
		c.JSON(http.StatusBadGateway, gin.H{"error": "Failed to fetch media details"})
		return
	}

	details := response.MediaDetails
	details.ID = id
	details.MediaType = mediaType
	details.Cast = topCast(response.Credits.Cast, 12)
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

	seasonURL := fmt.Sprintf("https://api.themoviedb.org/3/tv/%d/season/%d", seriesID, seasonNum)
	var season SeasonDetails
	if err := tmdbGet(seasonURL, apiKey, &season); err != nil {
		log.Printf("Error fetching TMDB season details: %v", err)
		c.JSON(http.StatusBadGateway, gin.H{"error": "Failed to fetch season details"})
		return
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

	episodeURL := fmt.Sprintf("https://api.themoviedb.org/3/tv/%d/season/%d/episode/%d", seriesID, seasonNum, episodeNum)
	var episode Episode
	if err := tmdbGet(episodeURL, apiKey, &episode); err != nil {
		log.Printf("Error fetching TMDB episode details: %v", err)
		c.JSON(http.StatusBadGateway, gin.H{"error": "Failed to fetch episode details"})
		return
	}
	c.JSON(http.StatusOK, episode)
}

func handleAddWatched(c *gin.Context) {
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

	userID := req.UserID
	if userID == "" {
		userID = "default"
	}
	req.UserID = userID
	req.WatchedAt = time.Now()

	addOrUpdateWatched(userID, req)
	c.JSON(http.StatusCreated, req)
}

func handleAddWatchedBulk(c *gin.Context) {
	var req struct {
		UserID string        `json:"user_id"`
		Items  []WatchedItem `json:"items"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Invalid bulk payload"})
		return
	}

	userID := req.UserID
	if userID == "" {
		userID = "default"
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
		item.UserID = userID
		item.WatchedAt = now
		addOrUpdateWatched(userID, *item) 
	}

	c.JSON(http.StatusCreated, gin.H{"added": len(req.Items)})
}

func handleDeleteWatched(c *gin.Context) {
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

	userID := req.UserID
	if userID == "" {
		userID = "default"
	}

	removeWatched(userID, req)
	c.Status(http.StatusNoContent)
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
	userID := c.DefaultQuery("user_id", "default")

	items := getUserWatched(userID)
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

func isWatchlistItemFullyWatched(userID string, item TMDBMedia) bool {
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
	data, err := fetchDiscoverData()
	if err != nil {
		log.Printf("Error fetching discover data: %v", err)
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

func addOrUpdateWatched(userID string, item WatchedItem) {
	watchedStore.Lock()
	defer watchedStore.Unlock()

	list := watchedStore.items[userID]
	for i, existing := range list {
		if existing.MediaID == item.MediaID && existing.MediaType == item.MediaType &&
			ptrInt64Equal(existing.SeasonNumber, item.SeasonNumber) &&
			ptrInt64Equal(existing.EpisodeNumber, item.EpisodeNumber) {
			list[i].WatchedAt = item.WatchedAt
			watchedStore.items[userID] = list
			return
		}
	}
	watchedStore.items[userID] = append(list, item)
}

func removeWatched(userID string, req WatchedItem) {
	watchedStore.Lock()
	defer watchedStore.Unlock()

	list := watchedStore.items[userID]
	filtered := make([]WatchedItem, 0, len(list))
	for _, item := range list {
		if item.MediaID == req.MediaID && item.MediaType == req.MediaType {
			if req.MediaType == "movie" {
				continue
			}
			if req.SeasonNumber == nil || req.EpisodeNumber == nil {
				continue
			}
			if ptrInt64Equal(item.SeasonNumber, req.SeasonNumber) && ptrInt64Equal(item.EpisodeNumber, req.EpisodeNumber) {
				continue
			}
		}
		filtered = append(filtered, item)
	}
	watchedStore.items[userID] = filtered
}

func getUserWatched(userID string) []WatchedItem {
	watchedStore.RLock()
	defer watchedStore.RUnlock()
	return append([]WatchedItem(nil), watchedStore.items[userID]...)
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
