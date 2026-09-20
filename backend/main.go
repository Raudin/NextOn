package main

import (
	"log"
	"os"

	"github.com/gin-gonic/gin"
	"github.com/joho/godotenv"
)

func init() {
	initCache()
	initJWT()
	// Connects only when REDIS_URL is set and reachable; otherwise the process
	// runs on the in-process caches alone.
	initRedis()
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

	// Background OMDb rating refresh. Ratings are read from the database on the
	// request path and filled in asynchronously, so this must be running before
	// the first list request arrives.
	startRatingWorkers()

	r := newRouter()

	if os.Getenv("TMDB_API_KEY") == "" {
		log.Fatalf("FATAL: TMDB_API_KEY is not set. The backend requires a TMDB API key to start.")
	}

	log.Println("TMDB_API_KEY loaded successfully.")
	if os.Getenv("OMDB_API_KEY") == "" {
		log.Println("Warning: OMDB_API_KEY is not set; IMDb, Metascore, and Rotten Tomatoes ratings will be unavailable.")
	} else {
		log.Println("OMDB_API_KEY loaded successfully.")
	}

	log.Printf("Server starting on port %s...", port)
	if err := r.Run(":" + port); err != nil {
		log.Fatalf("Failed to run server: %v", err)
	}
}

// newRouter builds the complete route table.
//
// Extracted from main so tests can exercise the real middleware order and route
// wiring. Several of the caching guarantees depend entirely on ordering —
// VersionedETagMiddleware must run after AuthMiddleware to see user_id, and
// CallScopeMiddleware before MetricsMiddleware to be observed — and those are
// exactly the mistakes an integration test through this function will catch.
func newRouter() *gin.Engine {
	// Configure Gin
	r := gin.Default()

	// Observability. CallScopeMiddleware must be registered before
	// MetricsMiddleware so the per-request outbound-call scope exists by the
	// time metrics reads it after the handler returns.
	r.Use(CallScopeMiddleware())
	r.Use(MetricsMiddleware())

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

	// Auth Endpoints. Credentials must never be stored by any cache.
	r.POST("/api/auth/signup", CachePolicyMiddleware(noStoreCachePolicy), handleSignup)
	r.POST("/api/auth/login", CachePolicyMiddleware(noStoreCachePolicy), handleLogin)

	// Discover & Search. Public and identical for every caller, so a shared
	// cache may hold them; the body ETag makes a repeat request a 304.
	r.GET("/api/discover", CachePolicyMiddleware(publicCachePolicy), handleDiscover)
	r.GET("/api/search", CachePolicyMiddleware(publicCachePolicy), handleSearch)

	// Home schedule (Private, authenticated). Resolves the whole
	// ready/upcoming schedule server-side in one response. VersionedETag means
	// an unchanged schedule costs one header comparison.
	r.GET("/api/home/schedule",
		CachePolicyMiddleware(privateCachePolicy),
		AuthMiddleware(),
		VersionedETagMiddleware(),
		handleHomeSchedule)

	// Delta sync (Private, authenticated)
	r.GET("/api/sync/state",
		CachePolicyMiddleware(privateCachePolicy),
		AuthMiddleware(),
		handleSyncState)
	r.GET("/api/sync/changes",
		CachePolicyMiddleware(privateCachePolicy),
		AuthMiddleware(),
		handleSyncChanges)

	// Watchlist (Private, authenticated)
	r.POST("/api/watchlist", CachePolicyMiddleware(noStoreCachePolicy), AuthMiddleware(), handleAddWatchlist)
	r.GET("/api/watchlist",
		CachePolicyMiddleware(privateCachePolicy),
		AuthMiddleware(),
		VersionedETagMiddleware(),
		handleGetWatchlist)
	r.DELETE("/api/watchlist/:id", CachePolicyMiddleware(noStoreCachePolicy), AuthMiddleware(), handleDeleteWatchlist)

	// Favorites (Private, authenticated)
	r.POST("/api/favorites", CachePolicyMiddleware(noStoreCachePolicy), AuthMiddleware(), handleAddFavorite)
	r.GET("/api/favorites", CachePolicyMiddleware(privateCachePolicy), AuthMiddleware(), handleGetFavorites)
	r.DELETE("/api/favorites/:id", CachePolicyMiddleware(noStoreCachePolicy), AuthMiddleware(), handleDeleteFavorite)
	r.GET("/api/favorites/status", CachePolicyMiddleware(privateCachePolicy), AuthMiddleware(), handleFavoriteStatus)

	// Profile (Private, authenticated)
	r.GET("/api/profile", CachePolicyMiddleware(privateCachePolicy), AuthMiddleware(), handleGetProfile)
	r.PUT("/api/profile", CachePolicyMiddleware(noStoreCachePolicy), AuthMiddleware(), handleUpdateProfile)
	r.POST("/api/profile/clear-history", CachePolicyMiddleware(noStoreCachePolicy), AuthMiddleware(), handleClearWatchHistory)
	r.DELETE("/api/profile/account", CachePolicyMiddleware(noStoreCachePolicy), AuthMiddleware(), handleDeleteAccount)

	// Media Details (Publicly browsable)
	r.GET("/api/media/movie/:id", CachePolicyMiddleware(publicCachePolicy), handleMovieDetails)
	r.GET("/api/media/tv/:id", CachePolicyMiddleware(publicCachePolicy), handleTvDetails)
	r.GET("/api/media/tv/:id/season/:season", CachePolicyMiddleware(publicCachePolicy), handleSeasonDetails)
	r.GET("/api/media/tv/:id/season/:season/episode/:episode", CachePolicyMiddleware(publicCachePolicy), handleEpisodeDetails)

	// Watched (Private, authenticated)
	r.POST("/api/watched", CachePolicyMiddleware(noStoreCachePolicy), AuthMiddleware(), handleAddWatched)
	r.POST("/api/watched/bulk", CachePolicyMiddleware(noStoreCachePolicy), AuthMiddleware(), handleAddWatchedBulk)
	r.POST("/api/watched/bulk-delete", CachePolicyMiddleware(noStoreCachePolicy), AuthMiddleware(), handleDeleteWatchedBulk)
	r.DELETE("/api/watched", CachePolicyMiddleware(noStoreCachePolicy), AuthMiddleware(), handleDeleteWatched)
	r.GET("/api/watched", CachePolicyMiddleware(privateCachePolicy), AuthMiddleware(), handleGetWatched)

	// Watched Status (Publicly queryable; OptionalAuthMiddleware personalises
	// the response when a valid token is supplied). Vary: Authorization is
	// required because the body depends on the caller.
	r.GET("/api/watched/status",
		CachePolicyMiddleware(privateCachePolicy),
		OptionalAuthMiddleware(),
		handleWatchedStatus)

	// Debug counters. Registered outside release mode only, so production never
	// exposes traffic patterns or internal cache hit rates.
	if gin.Mode() != gin.ReleaseMode {
		r.GET("/api/debug/stats", CachePolicyMiddleware(noStoreCachePolicy), handleDebugStats)
		log.Println("Debug endpoint enabled at GET /api/debug/stats (non-release mode)")
	}

	return r
}
