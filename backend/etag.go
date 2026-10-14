package main

import (
	"bytes"
	"crypto/sha256"
	"encoding/hex"
	"fmt"
	"net/http"
	"strings"
	"time"

	"github.com/gin-gonic/gin"
)

// HTTP caching policy.
//
// Why this matters here: React Native's `fetch` does NOT implement an HTTP
// cache, so `Cache-Control` alone changes nothing on the device. The value
// comes from the ETag round trip — the client sends `If-None-Match`, the server
// answers 304 with no body, and the screen keeps showing what it already has.
// `Cache-Control` is still set because Expo Web renders through a real browser,
// and because a reverse proxy in front of the API (Dokploy) will use it.
//
// `Vary: Authorization` is mandatory on any route whose response depends on the
// caller's token. Without it, a shared cache or proxy could serve one user's
// watchlist to another.

type cachePolicy struct {
	cacheControl string
	// varyAuth must be true for every route whose body depends on the bearer
	// token.
	varyAuth bool
	// bodyETag hashes the response body. Used for public content, which is
	// shared and therefore has no per-user version to key on.
	bodyETag bool
}

var (
	// Public content: identical for everyone, safe to cache in a shared cache.
	publicCachePolicy = cachePolicy{
		cacheControl: "public, max-age=60, stale-while-revalidate=600",
		bodyETag:     true,
	}

	// Per-user content: cacheable only in the caller's private cache, and must
	// be revalidated every time. `no-cache` (not `no-store`) is deliberate —
	// it permits conditional requests, which is the whole point.
	privateCachePolicy = cachePolicy{
		cacheControl: "private, no-cache",
		varyAuth:     true,
	}

	// Credentials and mutations must never be stored.
	noStoreCachePolicy = cachePolicy{
		cacheControl: "no-store",
		varyAuth:     true,
	}
)

// CachePolicyMiddleware sets the caching headers for a route and, when
// configured, computes a body ETag and answers conditional requests with 304.
func CachePolicyMiddleware(policy cachePolicy) gin.HandlerFunc {
	return func(c *gin.Context) {
		c.Header("Cache-Control", policy.cacheControl)
		if policy.varyAuth {
			c.Header("Vary", "Authorization")
		}

		if !policy.bodyETag {
			c.Next()
			return
		}

		// Buffer so the ETag can be computed before anything is flushed: a
		// header cannot be set once the response has started.
		capture := &captureWriter{ResponseWriter: c.Writer, body: bytes.Buffer{}}
		c.Writer = capture

		c.Next()

		body := capture.body.Bytes()
		status := capture.Status()

		// Only successful, non-empty bodies are worth validating. Error
		// responses are passed through untouched so a transient failure is
		// never cached as if it were content.
		if status != http.StatusOK || len(body) == 0 {
			capture.ResponseWriter.WriteHeader(status)
			if len(body) > 0 {
				_, _ = capture.ResponseWriter.Write(body)
			}
			return
		}

		sum := sha256.Sum256(body)
		etag := `W/"` + hex.EncodeToString(sum[:16]) + `"`

		if etagMatches(c.GetHeader("If-None-Match"), etag) {
			capture.ResponseWriter.WriteHeader(http.StatusNotModified)
			return
		}

		capture.ResponseWriter.Header().Set("ETag", etag)
		capture.ResponseWriter.WriteHeader(status)
		_, _ = capture.ResponseWriter.Write(body)
	}
}

// VersionedETagMiddleware answers conditional requests for a user's derived
// payloads using the user's sync version instead of a body hash.
//
// This is strictly better than hashing for these routes: the version is known
// before the handler runs, so a matching `If-None-Match` short-circuits to 304
// without touching the database, TMDB, or the payload cache. Hashing could only
// tell us the body was unchanged *after* paying to build it.
//
// Must be registered AFTER the auth middleware, since it needs user_id.
func VersionedETagMiddleware() gin.HandlerFunc {
	return func(c *gin.Context) {
		userIDValue, exists := c.Get("user_id")
		if !exists {
			c.Next()
			return
		}
		userUID, ok := userIDValue.(uint)
		if !ok {
			c.Next()
			return
		}

		// One timestamp for the whole request, so a request that begins inside
		// one clock bucket cannot be answered with a header from the next.
		// One version for the whole request too: it is what the ETag and the
		// payload cache key are both derived from, and reading it twice let a
		// concurrent mutation put the two out of step — a cache entry written
		// under one version while the client was told another.
		version := currentUserVersion(userUID)
		c.Set(userVersionContextKey, version)

		etag := userEntityTagAt(userUID, version, requestClock(c))
		c.Header("ETag", etag)

		if etagMatches(c.GetHeader("If-None-Match"), etag) {
			c.Status(http.StatusNotModified)
			c.Abort()
			return
		}

		c.Next()
	}
}

// etagClockBucket is how long a version-derived ETag stays valid even when
// nothing the user did has changed.
//
// The version alone was not a sound validator. It only advances on a user
// mutation, but these payloads also change for reasons no mutation causes:
// the calendar day rolls over and a show moves from "upcoming" to "ready", a
// new episode airs, TMDB data is corrected, or a rating refresh lands. A client
// holding `W/"user-1-ver-7"` could therefore be answered 304 indefinitely and
// never observe any of them.
//
// The bucket bounds that staleness. It is not arbitrary: every payload cache
// keyed off this version already carries a 60 second TTL
// (see watchlistCacheTTL and homeScheduleCacheTTL), so a clock bucket of the
// same width makes the validator and the cache agree — a client is never told
// "unchanged" for longer than the server itself would reuse the payload.
const etagClockBucket = time.Minute

// userEntityTag derives the ETag for a user's derived payloads.
//
// It carries three parts:
//   - the user id, so two users can never share a validator;
//   - the sync version, so any mutation immediately retires the old tag;
//   - the current clock bucket, so external change still surfaces within
//     etagClockBucket even when the version is untouched.
// userVersionContextKey carries the user's sync version for the duration of one
// request, so every consumer of it inside that request agrees on one value and
// only one database read is spent.
const userVersionContextKey = "user_version"

// currentUserVersionFor returns the request's cached version, reading it from
// the database only when the middleware has not already supplied it. Routes
// without VersionedETagMiddleware still get the plain database read.
func currentUserVersionFor(c *gin.Context, userID uint) uint64 {
	if cached, ok := c.Get(userVersionContextKey); ok {
		if version, ok := cached.(uint64); ok {
			return version
		}
	}
	return currentUserVersion(userID)
}

func userEntityTagAt(userID uint, version uint64, now time.Time) string {
	return fmt.Sprintf(`W/"user-%d-ver-%d-%d"`, userID, version, etagClockBucketAt(now))
}

func userEntityTag(userID uint) string {
	return userEntityTagAt(userID, currentUserVersion(userID), time.Now())
}

// requestClockKey lets a test pin the clock for one request. Nothing in
// production sets it, so requestClock is time.Now in every real deployment; it
// exists so that a test asserting "a matching If-None-Match yields 304" cannot
// fail merely because the suite happened to cross a bucket boundary.
const requestClockKey = "request_clock"

// requestClock returns the instant to derive this request's validator from.
func requestClock(c *gin.Context) time.Time {
	if pinned, ok := c.Get(requestClockKey); ok {
		if t, ok := pinned.(time.Time); ok {
			return t
		}
	}
	return time.Now()
}

// etagClockBucketAt maps an instant onto its bucket index. Split out from
// userEntityTag so the rollover behaviour is testable without waiting for a
// wall-clock minute to pass.
func etagClockBucketAt(t time.Time) int64 {
	return t.UTC().Truncate(etagClockBucket).Unix()
}

// etagMatches implements the weak comparison required by RFC 9110 §8.8.3.2:
// `W/` prefixes are ignored, a list of candidates is allowed, and `*` matches
// any representation.
func etagMatches(header, etag string) bool {
	header = strings.TrimSpace(header)
	if header == "" {
		return false
	}
	if header == "*" {
		return true
	}

	target := stripWeakPrefix(etag)
	for _, candidate := range strings.Split(header, ",") {
		if stripWeakPrefix(candidate) == target {
			return true
		}
	}
	return false
}

func stripWeakPrefix(value string) string {
	value = strings.TrimSpace(value)
	return strings.TrimPrefix(value, "W/")
}

// captureWriter buffers a handler's response so the ETag can be computed before
// any bytes reach the client.
//
// Header() is deliberately not overridden: handlers set Content-Type etc. via
// c.Header(), which writes to the real header map, and those must survive.
type captureWriter struct {
	gin.ResponseWriter
	body        bytes.Buffer
	status      int
	wroteHeader bool
}

func (w *captureWriter) WriteHeader(code int) {
	if w.wroteHeader {
		return
	}
	w.wroteHeader = true
	w.status = code
	// Intentionally not forwarded; the real header is written once the ETag is
	// known.
}

func (w *captureWriter) Write(b []byte) (int, error) {
	if !w.wroteHeader {
		w.WriteHeader(http.StatusOK)
	}
	return w.body.Write(b)
}

// Status is read by the logging and metrics middlewares, which run outside this
// one and therefore see the capture writer rather than the real one.
func (w *captureWriter) Status() int {
	if !w.wroteHeader {
		return http.StatusOK
	}
	return w.status
}

func (w *captureWriter) Written() bool { return w.wroteHeader }

func (w *captureWriter) Size() int { return w.body.Len() }
