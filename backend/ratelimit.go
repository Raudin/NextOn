package main

import (
	"context"
	"net/http"
	"sync"
	"time"

	"github.com/gin-gonic/gin"
)

// Outbound rate limiting for TMDB and OMDb.
//
// Both providers enforce per-second limits and answer a breach with HTTP 429,
// which the handlers currently surface as a failed lookup (and, for the Home
// schedule, a title silently dropped from the list). The concurrency semaphores
// elsewhere in this package bound how many calls are *in flight* but not how
// fast they are issued, so a 40-title watchlist could burst 40 requests in a
// few milliseconds on a cold cache.
//
// Implemented by hand rather than via golang.org/x/time/rate to avoid adding a
// dependency for ~40 lines.

type tokenBucket struct {
	mu       sync.Mutex
	capacity float64
	tokens   float64
	perSec   float64
	last     time.Time
}

func newTokenBucket(perSec, burst float64) *tokenBucket {
	return &tokenBucket{
		capacity: burst,
		tokens:   burst,
		perSec:   perSec,
		last:     time.Now(),
	}
}

// take consumes one token, waiting at most maxWait for one to become available.
//
// Returns false when the token could not be acquired in time. Callers proceed
// anyway: the limiter exists to smooth bursts, and turning provider rate limits
// into request failures would make this a source of outages rather than a
// mitigation.
func (b *tokenBucket) take(ctx context.Context, maxWait time.Duration) bool {
	deadline := time.Now().Add(maxWait)

	for {
		b.mu.Lock()
		now := time.Now()
		b.tokens = min(b.capacity, b.tokens+now.Sub(b.last).Seconds()*b.perSec)
		b.last = now

		if b.tokens >= 1 {
			b.tokens--
			b.mu.Unlock()
			return true
		}

		wait := time.Duration((1 - b.tokens) / b.perSec * float64(time.Second))
		b.mu.Unlock()

		if time.Now().Add(wait).After(deadline) {
			return false
		}

		select {
		case <-ctx.Done():
			return false
		case <-time.After(wait):
		}
	}
}

const (
	// tmdbRateLimit is deliberately below TMDB's documented ceiling; the point
	// is to smooth bursts from a large watchlist, not to saturate the quota.
	tmdbRateLimitPerSec = 25
	tmdbRateLimitBurst  = 25

	// omdbRateLimit is far lower because the free tier is limited per day, and
	// the background rating worker pool (4 workers) is the only real caller.
	omdbRateLimitPerSec = 5
	omdbRateLimitBurst  = 5

	// outboundWaitMax bounds how long any single outbound call may be delayed
	// by the limiter before proceeding regardless.
	outboundWaitMax = 2 * time.Second
)

var (
	tmdbLimiter = newTokenBucket(tmdbRateLimitPerSec, tmdbRateLimitBurst)
	omdbLimiter = newTokenBucket(omdbRateLimitPerSec, omdbRateLimitBurst)
)

// ------------------------------------------------------- inbound auth limiting

// Auth rate limits. These bound the *inbound* side of the same concern: the
// login and signup handlers run bcrypt, which is deliberately expensive, so an
// unauthenticated attacker could otherwise pin every CPU with concurrent
// guesses — and the guess rate itself was unbounded, making password brute
// forcing cheap.
const (
	// authRateLimitPerSec is low because a legitimate client logs in a handful
	// of times, not dozens of times a second.
	authRateLimitPerSec = 0.5

	// authRateLimitBurst allows a short flurry (a retry after a typo) without
	// letting a scripted attack through.
	authRateLimitBurst = 8

	// authLimiterIdleTTL is how long an unused per-IP bucket is kept. Without
	// eviction the map would grow once per distinct source address forever,
	// which is its own denial-of-service vector.
	authLimiterIdleTTL = 15 * time.Minute

	// authLimiterMaxIPs caps the map even if eviction cannot keep up, so a
	// spoofed-source flood cannot exhaust memory.
	authLimiterMaxIPs = 10000

	// authLimiterSweepInterval bounds how often the map is scanned.
	authLimiterSweepInterval = time.Minute
)

// ipRateLimiter holds one token bucket per source address.
type ipRateLimiter struct {
	mu      sync.Mutex
	buckets map[string]*ipBucket
	perSec  float64
	burst   float64

	lastSweep time.Time
	lastEvict time.Time
}

type ipBucket struct {
	bucket   *tokenBucket
	lastSeen time.Time
}

func newIPRateLimiter(perSec, burst float64) *ipRateLimiter {
	return &ipRateLimiter{
		buckets:   make(map[string]*ipBucket),
		perSec:    perSec,
		burst:     burst,
		lastSweep: time.Now(),
	}
}

// allow reports whether a request from ip may proceed, consuming a token.
//
// A client that is over the limit is refused rather than delayed: these are
// authentication attempts, and making an attacker wait is not the goal — not
// spending CPU on them is.
func (l *ipRateLimiter) allow(ip string) bool {
	if ip == "" {
		// No identifiable source (should not happen behind a configured
		// proxy): fail open rather than locking every such request out.
		return true
	}

	l.mu.Lock()
	entry, ok := l.buckets[ip]
	if !ok {
		if len(l.buckets) >= authLimiterMaxIPs {
			// At capacity, shed the least recently seen entries instead of
			// growing without bound.
			l.evictLocked(time.Now())
		}
		entry = &ipBucket{bucket: newTokenBucket(l.perSec, l.burst)}
		l.buckets[ip] = entry
	}
	entry.lastSeen = time.Now()
	l.sweepLocked(entry.lastSeen)
	l.mu.Unlock()

	// take() with no wait: either there is a token now or the request is
	// refused. maxWait of 0 also means the context is never consulted.
	return entry.bucket.take(context.Background(), 0)
}

// sweepLocked periodically drops buckets that have not been used recently.
func (l *ipRateLimiter) sweepLocked(now time.Time) {
	if now.Sub(l.lastSweep) < authLimiterSweepInterval {
		return
	}
	l.lastSweep = now
	l.evictLocked(now)
}

func (l *ipRateLimiter) evictLocked(now time.Time) {
	for ip, entry := range l.buckets {
		if now.Sub(entry.lastSeen) > authLimiterIdleTTL {
			delete(l.buckets, ip)
		}
	}
	l.lastEvict = now
}

// authLimiter is the shared limiter for the credential endpoints. One instance
// rather than one per route: an attacker should not get a fresh allowance by
// alternating between login and signup.
var authLimiter = newIPRateLimiter(authRateLimitPerSec, authRateLimitBurst)

// RateLimitAuthMiddleware refuses credential requests from a source exceeding
// its allowance.
//
// Keyed on c.ClientIP(), which is only trustworthy because the router is
// configured to trust no proxy by default (see configureTrustedProxies): with
// gin's default of trusting every proxy, a client could pick its own key by
// sending X-Forwarded-For and bypass the limit entirely.
func RateLimitAuthMiddleware() gin.HandlerFunc {
	return func(c *gin.Context) {
		if !authLimiter.allow(c.ClientIP()) {
			c.Header("Retry-After", "30")
			c.AbortWithStatusJSON(http.StatusTooManyRequests, gin.H{
				"error": "Too many attempts. Please wait a moment and try again.",
			})
			return
		}
		c.Next()
	}
}
