package main

import (
	"context"
	"sync"
	"time"
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
