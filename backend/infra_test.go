package main

import (
	"bytes"
	"compress/gzip"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/gin-gonic/gin"
)

// nowMinus returns an instant d in the past, for exercising time-based sweeps
// without sleeping.
func nowMinus(d time.Duration) time.Time {
	return time.Now().Add(-d)
}

// Middleware that is easy to get subtly wrong and hard to notice in production:
// a gzip writer that drops the body, a CORS header that is invalid for the
// browser, a rate limiter that either never fires or never opens.

func newTestRouter(middleware ...gin.HandlerFunc) *gin.Engine {
	gin.SetMode(gin.TestMode)
	r := gin.New()
	for _, m := range middleware {
		r.Use(m)
	}
	return r
}

// --- gzip -------------------------------------------------------------------

func TestGzipCompressesLargeJSON(t *testing.T) {
	payload := gin.H{"items": strings.Repeat("abc", 2000)}

	r := newTestRouter(GzipMiddleware())
	r.GET("/big", func(c *gin.Context) { c.JSON(http.StatusOK, payload) })

	request := httptest.NewRequest(http.MethodGet, "/big", nil)
	request.Header.Set("Accept-Encoding", "gzip")
	w := httptest.NewRecorder()
	r.ServeHTTP(w, request)

	if got := w.Header().Get("Content-Encoding"); got != "gzip" {
		t.Fatalf("expected a gzipped response, got Content-Encoding %q", got)
	}
	if !strings.Contains(w.Header().Get("Vary"), "Accept-Encoding") {
		t.Fatal("a compressed response must vary on Accept-Encoding")
	}

	// The body must still be valid, complete JSON.
	reader, err := gzip.NewReader(bytes.NewReader(w.Body.Bytes()))
	if err != nil {
		t.Fatalf("body is not valid gzip: %v", err)
	}
	defer reader.Close()

	decoded, err := io.ReadAll(reader)
	if err != nil {
		t.Fatalf("failed to decompress: %v", err)
	}
	if !strings.Contains(string(decoded), `"items"`) {
		t.Fatalf("decompressed body is not the payload: %s", string(decoded)[:min(120, len(decoded))])
	}
	// The point of the whole exercise.
	if len(w.Body.Bytes()) >= len(decoded) {
		t.Fatalf("compressed size %d must be smaller than %d", len(w.Body.Bytes()), len(decoded))
	}
}

func TestGzipLeavesSmallResponsesAlone(t *testing.T) {
	// Below the floor, the gzip framing can cost more than it saves.
	r := newTestRouter(GzipMiddleware())
	r.GET("/small", func(c *gin.Context) { c.JSON(http.StatusOK, gin.H{"ok": true}) })

	request := httptest.NewRequest(http.MethodGet, "/small", nil)
	request.Header.Set("Accept-Encoding", "gzip")
	w := httptest.NewRecorder()
	r.ServeHTTP(w, request)

	if got := w.Header().Get("Content-Encoding"); got != "" {
		t.Fatalf("a tiny response must not be compressed, got %q", got)
	}
	// And the body must have been written through, not swallowed by the buffer.
	if w.Body.Len() == 0 {
		t.Fatal("the small body was dropped")
	}
	if !strings.Contains(w.Body.String(), `"ok"`) {
		t.Fatalf("unexpected body: %s", w.Body.String())
	}
}

func TestGzipSkippedWhenClientDoesNotAcceptIt(t *testing.T) {
	r := newTestRouter(GzipMiddleware())
	r.GET("/big", func(c *gin.Context) {
		c.JSON(http.StatusOK, gin.H{"items": strings.Repeat("abc", 2000)})
	})

	request := httptest.NewRequest(http.MethodGet, "/big", nil)
	request.Header.Set("Accept-Encoding", "identity")
	w := httptest.NewRecorder()
	r.ServeHTTP(w, request)

	if got := w.Header().Get("Content-Encoding"); got != "" {
		t.Fatalf("must not compress for a client that did not ask, got %q", got)
	}
	if w.Body.Len() == 0 {
		t.Fatal("the body was dropped")
	}
}

func TestGzipHandlesQualifiedAcceptEncoding(t *testing.T) {
	r := newTestRouter(GzipMiddleware())
	r.GET("/big", func(c *gin.Context) {
		c.JSON(http.StatusOK, gin.H{"items": strings.Repeat("abc", 2000)})
	})

	request := httptest.NewRequest(http.MethodGet, "/big", nil)
	request.Header.Set("Accept-Encoding", "br;q=1.0, gzip;q=0.5, *;q=0")
	w := httptest.NewRecorder()
	r.ServeHTTP(w, request)

	if got := w.Header().Get("Content-Encoding"); got != "gzip" {
		t.Fatalf("a qualified gzip acceptance must still compress, got %q", got)
	}
}

func TestGzipPreservesErrorStatusAndBody(t *testing.T) {
	r := newTestRouter(GzipMiddleware())
	r.GET("/fail", func(c *gin.Context) {
		c.JSON(http.StatusBadGateway, gin.H{"error": strings.Repeat("x", 2000)})
	})

	request := httptest.NewRequest(http.MethodGet, "/fail", nil)
	request.Header.Set("Accept-Encoding", "gzip")
	w := httptest.NewRecorder()
	r.ServeHTTP(w, request)

	if w.Code != http.StatusBadGateway {
		t.Fatalf("the status must survive compression, got %d", w.Code)
	}

	reader, err := gzip.NewReader(bytes.NewReader(w.Body.Bytes()))
	if err != nil {
		t.Fatalf("body is not valid gzip: %v", err)
	}
	defer reader.Close()
	decoded, _ := io.ReadAll(reader)
	if !strings.Contains(string(decoded), `"error"`) {
		t.Fatalf("unexpected error body: %s", string(decoded)[:min(80, len(decoded))])
	}
}

// --- CORS -------------------------------------------------------------------

func TestCORSReflectsAllowedOriginWithoutWildcard(t *testing.T) {
	r := newTestRouter(WithCORS([]string{"https://app.example.com"}))
	r.GET("/api/watchlist", func(c *gin.Context) { c.Status(http.StatusOK) })

	request := httptest.NewRequest(http.MethodGet, "/api/watchlist", nil)
	request.Header.Set("Origin", "https://app.example.com")
	w := httptest.NewRecorder()
	r.ServeHTTP(w, request)

	if got := w.Header().Get("Access-Control-Allow-Origin"); got != "https://app.example.com" {
		t.Fatalf("expected the origin to be reflected, got %q", got)
	}
	if got := w.Header().Get("Access-Control-Allow-Credentials"); got != "true" {
		t.Fatalf("expected credentials to be allowed for a specific origin, got %q", got)
	}
	if !strings.Contains(w.Header().Get("Vary"), "Origin") {
		t.Fatal("a reflected origin must vary on Origin")
	}
}

func TestCORSRejectsUnknownOrigin(t *testing.T) {
	r := newTestRouter(WithCORS([]string{"https://app.example.com"}))
	r.GET("/api/watchlist", func(c *gin.Context) { c.Status(http.StatusOK) })

	request := httptest.NewRequest(http.MethodGet, "/api/watchlist", nil)
	request.Header.Set("Origin", "https://evil.example.com")
	w := httptest.NewRecorder()
	r.ServeHTTP(w, request)

	// Omitting the header is what makes the browser block the read.
	if got := w.Header().Get("Access-Control-Allow-Origin"); got != "" {
		t.Fatalf("a disallowed origin must not be granted access, got %q", got)
	}
}

func TestCORSWildcardNeverSendsCredentials(t *testing.T) {
	// `*` with credentials is rejected by browsers, so sending both is a bug
	// even when the operator explicitly asked for a wildcard.
	r := newTestRouter(WithCORS([]string{"*"}))
	r.GET("/api/discover", func(c *gin.Context) { c.Status(http.StatusOK) })

	request := httptest.NewRequest(http.MethodGet, "/api/discover", nil)
	request.Header.Set("Origin", "https://anything.example.com")
	w := httptest.NewRecorder()
	r.ServeHTTP(w, request)

	if got := w.Header().Get("Access-Control-Allow-Origin"); got != "*" {
		t.Fatalf("expected a wildcard, got %q", got)
	}
	if got := w.Header().Get("Access-Control-Allow-Credentials"); got != "" {
		t.Fatalf("the wildcard must never be paired with credentials, got %q", got)
	}
}

func TestCORSAnswersPreflight(t *testing.T) {
	r := newTestRouter(WithCORS([]string{"https://app.example.com"}))
	handlerRan := false
	r.POST("/api/watchlist", func(c *gin.Context) {
		handlerRan = true
		c.Status(http.StatusCreated)
	})

	request := httptest.NewRequest(http.MethodOptions, "/api/watchlist", nil)
	request.Header.Set("Origin", "https://app.example.com")
	w := httptest.NewRecorder()
	r.ServeHTTP(w, request)

	if w.Code != http.StatusNoContent {
		t.Fatalf("expected 204 for a preflight, got %d", w.Code)
	}
	if handlerRan {
		t.Fatal("a preflight must not reach the handler")
	}
}

// --- auth rate limiting -----------------------------------------------------

func TestAuthRateLimiterRefusesBeyondBurst(t *testing.T) {
	limiter := newIPRateLimiter(0.0001, 3) // effectively no refill during the test

	for i := 0; i < 3; i++ {
		if !limiter.allow("203.0.113.7") {
			t.Fatalf("attempt %d should have been allowed within the burst", i+1)
		}
	}

	if limiter.allow("203.0.113.7") {
		t.Fatal("the request past the burst must be refused")
	}

	// A different source has its own allowance.
	if !limiter.allow("203.0.113.8") {
		t.Fatal("one client's limit must not affect another")
	}
}

func TestAuthRateLimiterMiddlewareReturns429(t *testing.T) {
	gin.SetMode(gin.TestMode)
	r := gin.New()
	r.POST("/api/auth/login", RateLimitAuthMiddleware(), func(c *gin.Context) {
		c.JSON(http.StatusOK, gin.H{"token": "x"})
	})

	// The shared limiter has a burst of authRateLimitBurst; exhaust it from one
	// address. Fresh limiter state is not injectable here because the middleware
	// deliberately uses the process-wide instance, so this drives it until it
	// refuses rather than asserting an exact count.
	refused := false
	var lastCode int
	for i := 0; i < authRateLimitBurst+5; i++ {
		request := httptest.NewRequest(http.MethodPost, "/api/auth/login", strings.NewReader("{}"))
		request.Header.Set("Content-Type", "application/json")
		request.RemoteAddr = "198.51.100.42:12345"
		w := httptest.NewRecorder()
		r.ServeHTTP(w, request)
		lastCode = w.Code
		if w.Code == http.StatusTooManyRequests {
			refused = true
			if w.Header().Get("Retry-After") == "" {
				t.Fatal("a 429 must tell the client when to retry")
			}
			break
		}
	}

	if !refused {
		t.Fatalf("the limiter never refused after %d attempts (last status %d)", authRateLimitBurst+5, lastCode)
	}
}

func TestAuthRateLimiterSweepsIdleBuckets(t *testing.T) {
	limiter := newIPRateLimiter(10, 10)

	// A bucket far past the idle TTL.
	limiter.buckets["203.0.113.99"] = &ipBucket{
		bucket:   newTokenBucket(10, 10),
		lastSeen: nowMinus(authLimiterIdleTTL * 2),
	}
	limiter.buckets["203.0.113.100"] = &ipBucket{
		bucket:   newTokenBucket(10, 10),
		lastSeen: nowMinus(0),
	}

	limiter.mu.Lock()
	limiter.evictLocked(nowMinus(0))
	limiter.mu.Unlock()

	if _, ok := limiter.buckets["203.0.113.99"]; ok {
		t.Fatal("an idle bucket must be evicted, or the map grows without bound")
	}
	if _, ok := limiter.buckets["203.0.113.100"]; !ok {
		t.Fatal("an active bucket must be kept")
	}
}

// --- method label -----------------------------------------------------------

func TestNormalizeHTTPMethodIsBounded(t *testing.T) {
	// A realistic method passes through.
	if got := normalizeHTTPMethod(http.MethodGet); got != "GET" {
		t.Fatalf("expected GET, got %q", got)
	}
	// Anything a client invents collapses into one bucket, so the Prometheus
	// label cannot grow once per crafted request.
	for _, bogus := range []string{"FOO", "PROPFIND", "get", "", "G" + strings.Repeat("E", 50) + "T"} {
		if got := normalizeHTTPMethod(bogus); got != "OTHER" {
			t.Fatalf("method %q must normalise to OTHER, got %q", bogus, got)
		}
	}
}
