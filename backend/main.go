package main

import (
	"context"
	"errors"
	"log"
	"net/http"
	"os"
	"os/signal"
	"strings"
	"syscall"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/joho/godotenv"
)

// Server timeouts. Without these, a slow or half-open client holds a connection
// and its goroutine indefinitely, which is a cheap denial of service against a
// single-container deployment.
const (
	serverReadHeaderTimeout = 5 * time.Second
	serverReadTimeout       = 15 * time.Second
	serverWriteTimeout      = 30 * time.Second
	serverIdleTimeout       = 120 * time.Second
	serverShutdownGrace     = 15 * time.Second
)

// jwtSecretPlaceholder is the fallback secret in middleware.go. It is public
// (it is in this repository), so accepting it in a release build means anyone
// can mint a token for any user id.
const jwtSecretPlaceholder = "nexton-secret-key-1234567890"

// knownDefaultJWTSecrets are values that must never protect a production
// deployment: the in-repo fallback and the placeholder shipped in
// .env.example / docker-compose.yml.
var knownDefaultJWTSecrets = []string{
	jwtSecretPlaceholder,
	"your_jwt_secret_key_here",
}

func main() {
	// Load .env BEFORE anything reads the environment.
	//
	// These initialisations used to run in an `init()` function, which Go runs
	// before main — so a JWT_SECRET or REDIS_URL set in .env was never seen, and
	// the process silently fell back to the hardcoded placeholder secret. That
	// made every token forgeable in exactly the deployments that configured a
	// real secret.
	if err := godotenv.Load(); err != nil {
		log.Println("Info: No .env file found, relying on system environment variables")
	}

	initJWT()
	// Connects only when REDIS_URL is set and reachable; otherwise the process
	// runs on the in-process caches alone.
	initRedis()

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

	// Refuse to start with a publicly known secret in a release build. A
	// misconfigured deployment must fail loudly at boot rather than issue
	// tokens that anyone can forge.
	validateJWTSecret()

	r := newRouter()

	// Trust no proxy by default. Gin otherwise trusts every proxy, which lets a
	// client spoof X-Forwarded-For and choose its own ClientIP — the exact
	// input any per-IP rate limit keyed on. Deployments behind a known proxy
	// (Dokploy/Traefik) opt in via TRUSTED_PROXIES.
	if err := configureTrustedProxies(r); err != nil {
		log.Fatalf("FATAL: invalid TRUSTED_PROXIES: %v", err)
	}

	if os.Getenv("TMDB_API_KEY") == "" {
		log.Fatalf("FATAL: TMDB_API_KEY is not set. The backend requires a TMDB API key to start.")
	}

	log.Println("TMDB_API_KEY loaded successfully.")
	if os.Getenv("OMDB_API_KEY") == "" {
		log.Println("Warning: OMDB_API_KEY is not set; IMDb, Metascore, and Rotten Tomatoes ratings will be unavailable.")
	} else {
		log.Println("OMDB_API_KEY loaded successfully.")
	}

	// Prometheus exposition, on its own listener so that routing to the API's
	// public domain cannot reach it. No-op when METRICS_ADDR is unset. Started
	// after the configuration checks so that a fatal misconfiguration reports
	// first rather than being preceded by a metrics log line.
	startMetricsServer()

	// Replace r.Run, which builds an http.Server with no timeouts at all.
	server := &http.Server{
		Addr:              ":" + port,
		Handler:           r,
		ReadHeaderTimeout: serverReadHeaderTimeout,
		ReadTimeout:       serverReadTimeout,
		WriteTimeout:      serverWriteTimeout,
		IdleTimeout:       serverIdleTimeout,
	}

	// Stop accepting on SIGINT/SIGTERM and give in-flight requests a bounded
	// window to finish, then release Redis and the database. Previously the
	// process was killed mid-request and the SQLite writes in flight were lost.
	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer stop()

	serverErr := make(chan error, 1)
	go func() {
		log.Printf("Server starting on port %s...", port)
		if err := server.ListenAndServe(); err != nil && !errors.Is(err, http.ErrServerClosed) {
			serverErr <- err
			return
		}
		serverErr <- nil
	}()

	select {
	case err := <-serverErr:
		if err != nil {
			log.Fatalf("Failed to run server: %v", err)
		}
	case <-ctx.Done():
		log.Println("Shutdown signal received; draining connections...")
		shutdownCtx, cancel := context.WithTimeout(context.Background(), serverShutdownGrace)
		defer cancel()
		if err := server.Shutdown(shutdownCtx); err != nil {
			log.Printf("Graceful shutdown did not complete: %v", err)
		}
	}

	closeRedis()
	if sqlDB, err := db.DB(); err == nil {
		_ = sqlDB.Close()
	}
	log.Println("Server stopped.")
}

// validateJWTSecret refuses to boot a release build that would sign tokens with
// a secret published in this repository.
//
// Deliberately release-only. Tests and local development run gin in debug mode
// and rely on the package-level fallback so that signing and verification stay
// consistent without every test setting an environment variable.
func validateJWTSecret() {
	if gin.Mode() != gin.ReleaseMode {
		if !hasUsableJWTSecret() {
			log.Println("Warning: JWT_SECRET is not set; using the built-in development secret. Do not deploy like this.")
		}
		return
	}

	secret := os.Getenv("JWT_SECRET")
	if strings.TrimSpace(secret) == "" {
		log.Fatalf("FATAL: JWT_SECRET is not set. Refusing to start a release build with the built-in default secret.")
	}
	for _, known := range knownDefaultJWTSecrets {
		if secret == known {
			log.Fatalf("FATAL: JWT_SECRET is set to a publicly known default value. Refusing to start.")
		}
	}
}

func hasUsableJWTSecret() bool {
	secret := strings.TrimSpace(os.Getenv("JWT_SECRET"))
	if secret == "" {
		return false
	}
	for _, known := range knownDefaultJWTSecrets {
		if secret == known {
			return false
		}
	}
	return true
}

// configureTrustedProxies applies TRUSTED_PROXIES (comma-separated IPs or CIDRs)
// and otherwise tells gin to trust nothing.
func configureTrustedProxies(r *gin.Engine) error {
	raw := strings.TrimSpace(os.Getenv("TRUSTED_PROXIES"))
	if raw == "" {
		return r.SetTrustedProxies(nil)
	}

	var proxies []string
	for _, part := range strings.Split(raw, ",") {
		if trimmed := strings.TrimSpace(part); trimmed != "" {
			proxies = append(proxies, trimmed)
		}
	}
	return r.SetTrustedProxies(proxies)
}

// newRouter builds the complete route table.
//
// Extracted from main so tests can exercise the real middleware order and route
// wiring. Several of the caching guarantees depend entirely on ordering —
// VersionedETagMiddleware must run after AuthMiddleware to see user_id, and
// CallScopeMiddleware before MetricsMiddleware to be observed — and those are
// exactly the mistakes an integration test through this function will catch.
func newRouter() *gin.Engine {
	// gin.New() plus explicit middleware rather than gin.Default().
	//
	// Default() attaches its own Logger and Recovery, which the package comment
	// then warns about ("Creating an Engine instance with the Logger and
	// Recovery middleware already attached"). Naming them here keeps the
	// middleware order — which several caching guarantees depend on — visible
	// in one place instead of half of it being implicit.
	r := gin.New()
	r.Use(gin.Recovery())
	r.Use(RequestLogger())

	// Gzip before anything reads or writes a response body, so the biggest
	// payloads (the Home schedule, the watchlist with progress, the Discover
	// carousels) go over the wire compressed. JSON of this shape compresses by
	// roughly 5-10x, which matters most on the mobile connections this app
	// targets. CompressibleContentType skips already-compressed responses.
	r.Use(GzipMiddleware())

	// Observability. CallScopeMiddleware must be registered before
	// MetricsMiddleware so the per-request outbound-call scope exists by the
	// time metrics reads it after the handler returns.
	r.Use(CallScopeMiddleware())
	r.Use(MetricsMiddleware())

	// Bound request bodies before anything parses them. Registered early so no
	// route can forget it.
	r.Use(BodyLimitMiddleware(maxRequestBodyBytes))

	// CORS.
	//
	// `Access-Control-Allow-Origin: *` together with
	// `Access-Control-Allow-Credentials: true` is an invalid combination that
	// browsers reject: the wildcard may not be combined with credentials,
	// because it would let any origin read an authenticated response. The
	// correct behaviour is to reflect the actual Origin only when it is one we
	// allow, and to omit the header otherwise (which is what makes a browser
	// block the cross-origin read).
	r.Use(WithCORS(allowedOrigins()))

	// Health probes. Registered before the API routes and deliberately outside
	// the auth and cache-policy middleware: a probe must be cheap, must never
	// be rate limited by an auth limiter, and must not be cached.
	r.GET("/health", handleHealth)
	r.GET("/ready", handleReady)

	// Auth Endpoints. Credentials must never be stored by any cache, and they
	// are the only endpoints that both accept unauthenticated input and are
	// expensive to process (bcrypt), so they are the ones that need an inbound
	// limit.
	r.POST("/api/auth/signup",
		CachePolicyMiddleware(noStoreCachePolicy),
		RateLimitAuthMiddleware(),
		handleSignup)
	r.POST("/api/auth/login",
		CachePolicyMiddleware(noStoreCachePolicy),
		RateLimitAuthMiddleware(),
		handleLogin)

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
	// Franchise films. Requested lazily by the detail screen and only when a
	// movie reports a `collection`, so the extra TMDB call never sits on the
	// critical path of the details request.
	r.GET("/api/media/collection/:id", CachePolicyMiddleware(publicCachePolicy), handleCollectionDetails)

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
