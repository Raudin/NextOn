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

	// Favorites (Private, authenticated)
	r.POST("/api/favorites", AuthMiddleware(), handleAddFavorite)
	r.GET("/api/favorites", AuthMiddleware(), handleGetFavorites)
	r.DELETE("/api/favorites/:id", AuthMiddleware(), handleDeleteFavorite)
	r.GET("/api/favorites/status", AuthMiddleware(), handleFavoriteStatus)

	// Profile (Private, authenticated)
	r.GET("/api/profile", AuthMiddleware(), handleGetProfile)
	r.PUT("/api/profile", AuthMiddleware(), handleUpdateProfile)
	r.POST("/api/profile/clear-history", AuthMiddleware(), handleClearWatchHistory)
	r.DELETE("/api/profile/account", AuthMiddleware(), handleDeleteAccount)

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
