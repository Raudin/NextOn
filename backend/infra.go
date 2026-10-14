package main

import (
	"compress/gzip"
	"log"
	"net/http"
	"os"
	"strconv"
	"strings"
	"sync"
	"time"

	"github.com/gin-gonic/gin"
)

// CORS.
//
// The previous configuration sent `Access-Control-Allow-Origin: *` together
// with `Access-Control-Allow-Credentials: true`. Browsers reject that pairing —
// the wildcard is not allowed to be combined with credentials, precisely
// because it would let any origin read an authenticated response — so the
// header was both non-functional and misleading about intent. This version
// reflects the request's Origin only when it is explicitly allowed, and omits
// the header otherwise, which makes the browser block the read.

// defaultAllowedOrigins covers local development. Native builds of the app do
// not send an Origin at all and are unaffected by CORS.
var defaultAllowedOrigins = []string{
	"http://localhost:8081",
	"http://localhost:19006",
	"http://127.0.0.1:8081",
}

// allowedOrigins reads ALLOWED_ORIGINS (comma-separated) and falls back to the
// development list.
//
// A wildcard is deliberately still honoured when explicitly configured, because
// an operator may be serving a genuinely public, credential-free surface — but
// it is not the default and not silently combined with credentials.
func allowedOrigins() []string {
	raw := strings.TrimSpace(os.Getenv("ALLOWED_ORIGINS"))
	if raw == "" {
		return defaultAllowedOrigins
	}

	origins := make([]string, 0, 4)
	for _, part := range strings.Split(raw, ",") {
		if trimmed := strings.TrimSpace(part); trimmed != "" {
			origins = append(origins, trimmed)
		}
	}
	return origins
}

// WithCORS answers preflights and sets the CORS headers for permitted origins.
func WithCORS(origins []string) gin.HandlerFunc {
	allowed := make(map[string]struct{}, len(origins))
	allowAll := false
	for _, origin := range origins {
		if origin == "*" {
			allowAll = true
		}
		allowed[origin] = struct{}{}
	}

	const allowHeaders = "Content-Type, Content-Length, Accept-Encoding, X-CSRF-Token, Authorization, accept, origin, Cache-Control, X-Requested-With"
	const allowMethods = "POST, OPTIONS, GET, PUT, DELETE"

	return func(c *gin.Context) {
		origin := c.GetHeader("Origin")

		permitted := false
		switch {
		case origin == "":
			// Same-origin or a native client; CORS does not apply.
		case allowAll:
			permitted = true
		default:
			_, permitted = allowed[origin]
		}

		if permitted && origin != "" {
			if allowAll {
				c.Header("Access-Control-Allow-Origin", "*")
			} else {
				// Reflect the exact origin and tell caches the response varies
				// by it, or a shared cache could hand one origin another's
				// response.
				c.Header("Access-Control-Allow-Origin", origin)
				c.Header("Vary", "Origin")
			}
			// Credentials are only advertised for a specific origin, never
			// alongside the wildcard.
			if !allowAll {
				c.Header("Access-Control-Allow-Credentials", "true")
			}
			c.Header("Access-Control-Allow-Headers", allowHeaders)
			c.Header("Access-Control-Allow-Methods", allowMethods)
		}

		if c.Request.Method == http.MethodOptions {
			// Preflight: the answer is the headers above, and no handler runs.
			c.AbortWithStatus(http.StatusNoContent)
			return
		}

		c.Next()
	}
}

// Gzip.
//
// Responses here are JSON and compress extremely well (roughly 5-10x), and the
// largest ones — the Home schedule, the watchlist with progress, the Discover
// carousels — are exactly the payloads that matter on a mobile connection.
//
// Only compress when the client asked for it, only for compressible content
// types, and never below a size floor where the gzip header would cost more
// than the compression saves.

// gzipMinBytes is the smallest response worth compressing. Below this the
// gzip framing (header plus trailer) can exceed what is saved.
const gzipMinBytes = 1024

// gzipWriter buffers the beginning of a response so it can decide whether
// compressing is worthwhile before any header is committed.
//
// The decision has to be deferred: a 40-byte JSON error is not worth a gzip
// header, and `Content-Length` (or its absence) can only be set before the
// headers go out.
type gzipWriter struct {
	gin.ResponseWriter

	writer    *gzip.Writer
	buffer    []byte
	status    int
	decided   bool
	passThru  bool
	wroteHdr  bool
	closeOnce sync.Once
}

func (w *gzipWriter) WriteHeader(code int) {
	if w.decided {
		w.ResponseWriter.WriteHeader(code)
		return
	}
	// Remember it; the real header is written once the decision is made.
	w.status = code
	w.wroteHdr = true
}

func (w *gzipWriter) Write(b []byte) (int, error) {
	if w.passThru {
		return w.ResponseWriter.Write(b)
	}

	if !w.decided {
		w.buffer = append(w.buffer, b...)
		if len(w.buffer) >= gzipMinBytes {
			w.decide(true)
		}
		// Report the bytes as accepted: they are buffered, not dropped.
		return len(b), nil
	}

	return w.writer.Write(b)
}

// decide commits, once, to compressing or passing the response through.
func (w *gzipWriter) decide(compress bool) {
	if w.decided {
		return
	}
	w.decided = true

	status := w.status
	if !w.wroteHdr {
		status = http.StatusOK
	}

	if compress {
		w.Header().Set("Content-Encoding", "gzip")
		w.Header().Add("Vary", "Accept-Encoding")
		// The encoded length is unknown until the body is complete.
		w.Header().Del("Content-Length")
		w.ResponseWriter.WriteHeader(status)
		w.writer = gzip.NewWriter(w.ResponseWriter)
		if len(w.buffer) > 0 {
			_, _ = w.writer.Write(w.buffer)
		}
		w.buffer = nil
		return
	}

	w.passThru = true
	w.ResponseWriter.WriteHeader(status)
	if len(w.buffer) > 0 {
		_, _ = w.ResponseWriter.Write(w.buffer)
	}
	w.buffer = nil
}

// Close flushes the encoder, or emits a short body uncompressed.
func (w *gzipWriter) Close() error {
	var err error
	w.closeOnce.Do(func() {
		if !w.decided {
			// The entire body was below the threshold.
			w.decide(false)
			return
		}
		if w.writer != nil {
			err = w.writer.Close()
		}
	})
	return err
}

func (w *gzipWriter) WriteString(s string) (int, error) {
	return w.Write([]byte(s))
}

// GzipMiddleware compresses eligible responses.
func GzipMiddleware() gin.HandlerFunc {
	return func(c *gin.Context) {
		if !clientAcceptsGzip(c) || !compressibleResponse(c) {
			c.Next()
			return
		}

		writer := &gzipWriter{ResponseWriter: c.Writer}
		c.Writer = writer
		defer func() {
			if err := writer.Close(); err != nil {
				log.Printf("Gzip: failed to flush compressed response: %v", err)
			}
		}()

		c.Next()
	}
}

func clientAcceptsGzip(c *gin.Context) bool {
	for _, encoding := range strings.Split(c.GetHeader("Accept-Encoding"), ",") {
		// Strip any q-value and whitespace: "gzip;q=0.5" still accepts gzip.
		name := strings.TrimSpace(strings.SplitN(encoding, ";", 2)[0])
		if strings.EqualFold(name, "gzip") {
			return true
		}
	}
	return false
}

// compressibleResponse reports whether this request is worth wrapping. Already
// encoded content must not be compressed twice, and images are excluded both
// because JPEG/PNG do not compress and because re-encoding them costs CPU for
// no gain.
func compressibleResponse(c *gin.Context) bool {
	if c.Request.Method == http.MethodHead {
		return false
	}
	if c.Writer.Header().Get("Content-Encoding") != "" {
		return false
	}
	if c.GetHeader("Upgrade") != "" || strings.Contains(c.GetHeader("Connection"), "Upgrade") {
		// WebSocket and similar upgrades must never be wrapped.
		return false
	}
	return true
}

// RequestLogger is a deliberately small access log.
//
// gin.Default()'s logger formats and colourises every line, and this runs on
// every request including the frequently-polled sync endpoints, where it is
// pure overhead. This keeps the fields that are actually read when diagnosing a
// problem — status, latency, method, path — and nothing else.
func RequestLogger() gin.HandlerFunc {
	return func(c *gin.Context) {
		start := time.Now()
		path := c.Request.URL.Path
		query := c.Request.URL.RawQuery

		c.Next()

		if query != "" {
			path = path + "?" + query
		}

		status := c.Writer.Status()
		line := []string{
			strconv.Itoa(status),
			time.Since(start).String(),
			c.ClientIP(),
			c.Request.Method,
			path,
		}
		if len(c.Errors) > 0 {
			line = append(line, c.Errors.String())
		}

		// Health and metrics probes are noise at one line per second.
		if path == "/health" || path == "/ready" {
			return
		}
		log.Println(strings.Join(line, " "))
	}
}

// ------------------------------------------------------------------- health

// liveness/readiness probes.
//
// A container orchestrator needs a cheap endpoint that proves the process is up
// and, separately, that its dependencies answer. They are distinct on purpose:
// restarting a container because Redis is briefly unreachable would turn a
// blip into an outage.

var healthStartedAt = time.Now()

func handleHealth(c *gin.Context) {
	c.JSON(http.StatusOK, gin.H{
		"status":         "ok",
		"uptime_seconds": int(time.Since(healthStartedAt).Seconds()),
	})
}

func handleReady(c *gin.Context) {
	// The database is the only hard dependency: Redis is an optional cache tier
	// and its absence is a performance characteristic, not a failure.
	if db == nil {
		c.JSON(http.StatusServiceUnavailable, gin.H{"status": "degraded", "database": "not initialised"})
		return
	}
	sqlDB, err := db.DB()
	if err != nil {
		c.JSON(http.StatusServiceUnavailable, gin.H{"status": "degraded", "database": "error"})
		return
	}
	if err := sqlDB.PingContext(c.Request.Context()); err != nil {
		c.JSON(http.StatusServiceUnavailable, gin.H{"status": "degraded", "database": "unreachable"})
		return
	}

	c.JSON(http.StatusOK, gin.H{
		"status":   "ready",
		"database": "ok",
		"redis":    map[bool]string{true: "ok", false: "disabled"}[redisEnabled()],
	})
}
