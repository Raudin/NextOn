package main

import (
	"context"
	"encoding/json"
	"log"
	"net/http"
	"strconv"
	"sync"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/hashicorp/golang-lru/v2/expirable"
)

// Helpers for caching whole JSON responses.
//
// The derived payloads this app serves — the Home schedule and the watchlist
// with progress — are expensive to build (a TMDB lookup per title) but are
// identical for every request from the same user until that user changes
// something. Caching them at the HTTP boundary is both the simplest place to
// do it and the place that composes with ETag revalidation: a cached payload
// plus a version-derived ETag means a repeat request costs one header compare.

const (
	// homeScheduleCacheTTL is short because the schedule depends on air dates
	// crossing "today", which no mutation triggers. Version-based invalidation
	// handles everything the user does; the TTL handles the calendar.
	homeScheduleCacheTTL = 60 * time.Second

	// watchlistCacheTTL matches the client's revalidation window.
	watchlistCacheTTL = 60 * time.Second
)

// responsePayloadCache is the in-process tier of whole-response caching.
//
// Without it, every request that misses Redis — which includes *all* requests
// on a deployment without REDIS_URL — rebuilds the payload from scratch. For
// the Home schedule that means one TMDB lookup per watchlist title on every
// screen entry, even though consecutive requests from the same user build a
// byte-identical payload. The TTL is short, so this tier only absorbs repeats
// inside one cache window; correctness still comes from the version-keyed
// cache key and the TTL.
type responsePayloadCache struct {
	entries *expirable.LRU[string, []byte]

	// inflight coalesces concurrent builders for the same key. Two devices of
	// one user opening Home simultaneously must cost one rebuild, not two.
	inflightMu sync.Mutex
	inflight   map[string]*responseCall
}

type responseCall struct {
	done    chan struct{}
	payload []byte
	built   bool // false when build() wrote an error response itself
}

const (
	// responseCacheEntries bounds the tier by count. Keys are (endpoint, user,
	// version) tuples, so working set size is roughly active users x a few
	// query variants.
	responseCacheEntries = 2048

	// responseBuildWaitMax bounds how long a coalesced waiter parks on another
	// request's build. Past this the waiter rebuilds independently rather than
	// inherit a stalled request's latency. A cold Home build with a large
	// watchlist can legitimately take several seconds, so the bound is generous.
	responseBuildWaitMax = 10 * time.Second
)

var responseCache = func() *responsePayloadCache {
	lru := expirable.NewLRU[string, []byte](responseCacheEntries, nil, 0)
	return &responsePayloadCache{
		entries:  lru,
		inflight: make(map[string]*responseCall),
	}
}()

// cachedJSONResponse serves a JSON payload from the in-process cache, then
// Redis, otherwise builds it, stores it in both tiers, and serves it.
//
// Invariants:
//   - Redis being unavailable means "always miss", never an error.
//   - A payload that fails to build is not cached and the error is surfaced by
//     the caller's build function writing its own response. Waiters coalesced
//     onto that build relay the same empty result without writing anything.
//   - Only successful (200) payloads are cached.
func cachedJSONResponse(c *gin.Context, key string, ttl time.Duration, build func() (any, bool)) {
	if payload, ok := responseCache.entries.Get(key); ok {
		metrics.recordLocalResponseHit()
		c.Data(http.StatusOK, "application/json; charset=utf-8", payload)
		return
	}

	if payload, ok := redisGet(key); ok {
		// Re-populate the local tier with the remaining lifetime approximated by
		// the full TTL: overshooting is bounded by the version-keyed name, and
		// the ETag clock bucket already tolerates this width of staleness.
		responseCache.entries.Add(key, payload)
		c.Data(http.StatusOK, "application/json; charset=utf-8", payload)
		return
	}

	call, leader := responseCache.startCall(key)
	if !leader {
		select {
		case <-call.done:
			if call.built {
				metrics.recordResponseCoalesced()
				c.Data(http.StatusOK, "application/json; charset=utf-8", call.payload)
			}
			// Leader's build failed and wrote its own error response; waiters
			// write nothing here, matching the pre-coalescing behaviour where each
			// request ran build() and wrote its own error.
			return
		case <-time.After(responseBuildWaitMax):
			// The leader is stalling. Fall through and build independently.
		case <-c.Request.Context().Done():
			return
		}
	}

	// Deferred so every parked waiter is released even if build() or marshaling
	// panics — the same barrier-safety rule as the TMDB inflight map.
	defer close(call.done)

	result, ok := build()
	if !ok {
		// build() already wrote an error response.
		call.built = false
		responseCache.endCall(key)
		return
	}

	payload, err := json.Marshal(result)
	if err != nil {
		log.Printf("Cache: failed to marshal payload for %s: %v", key, err)
		call.built = false
		responseCache.endCall(key)
		c.JSON(http.StatusOK, result)
		return
	}

	call.payload, call.built = payload, true
	responseCache.entries.Add(key, payload)
	responseCache.endCall(key)
	redisSet(key, payload, ttl)
	c.Data(http.StatusOK, "application/json; charset=utf-8", payload)
}

// startCall returns the in-flight build for key, marking this caller as the
// leader responsible for running it when none exists.
func (rc *responsePayloadCache) startCall(key string) (*responseCall, bool) {
	rc.inflightMu.Lock()
	defer rc.inflightMu.Unlock()
	if call, ok := rc.inflight[key]; ok {
		return call, false
	}
	call := &responseCall{done: make(chan struct{})}
	rc.inflight[key] = call
	return call, true
}

func (rc *responsePayloadCache) endCall(key string) {
	rc.inflightMu.Lock()
	delete(rc.inflight, key)
	rc.inflightMu.Unlock()
}

// warmUserCaches rebuilds a user's derived payloads after their sync version
// advanced, so the first request after a mutation reads them from cache
// instead of paying for a full rebuild on the critical path.
//
// Best-effort by design: it runs detached from the finished request, coalesces
// with any real request already building the same payload (the inflight map in
// cachedJSONResponse), and every failure path simply leaves the next real
// request to build synchronously — exactly the behaviour before this existed.
func warmUserCaches(userID uint) {
	version := currentUserVersion(userID)
	homeKey := homeScheduleCacheKeyAt(userID, version)
	listKey := watchlistCacheKeyAt(userID, version, false, false)

	_, homePresent := responseCache.entries.Get(homeKey)
	_, listPresent := responseCache.entries.Get(listKey)
	if homePresent && listPresent {
		return
	}

	go func() {
		defer func() {
			if r := recover(); r != nil {
				log.Printf("Cache warm: panic while rebuilding for user %d: %v", userID, r)
			}
		}()
		scope := backgroundScope()
		warmPayload(homeKey, func() (any, bool) {
			return buildHomeSchedulePayload(userID, scope)
		})
		warmPayload(listKey, func() (any, bool) {
			return buildWatchlistPayload(userID, false, false, scope)
		})
	}()
}

// warmPayload builds one cache entry into the local tier, then mirrors it to
// Redis through the normal path. A concurrent request already building this
// key wins: the warmer waits rather than duplicating the fan-out.
func warmPayload(key string, produce func() (any, bool)) {
	call, leader := responseCache.startCall(key)
	if !leader {
		select {
		case <-call.done:
		case <-time.After(responseBuildWaitMax):
		}
		return
	}
	// Deferred so a panicking build still releases anyone who joined the call.
	defer close(call.done)

	result, ok := produce()
	if !ok {
		responseCache.endCall(key)
		return
	}
	payload, err := json.Marshal(result)
	if err != nil {
		responseCache.endCall(key)
		return
	}

	call.payload, call.built = payload, true
	responseCache.entries.Add(key, payload)
	responseCache.endCall(key)
	redisSet(key, payload, homeScheduleCacheTTL)
}

// homeScheduleCacheKey scopes the cached schedule to a user and their current
// sync version, so any mutation retires the entry without a scan.
func homeScheduleCacheKey(userID uint) string {
	return homeScheduleCacheKeyAt(userID, currentUserVersion(userID))
}

// homeScheduleCacheKeyAt is homeScheduleCacheKey for a version already in hand.
// The request path uses this so the version is read once per request rather
// than once per cache key.
func homeScheduleCacheKeyAt(userID uint, version uint64) string {
	return redisNamedKey(
		"home",
		strconv.FormatUint(uint64(userID), 10),
		strconv.FormatUint(version, 10),
	)
}

// watchlistCacheKey scopes the cached watchlist the same way, and includes the
// query variants so `filter_watched` and `include=progress` cannot collide.
func watchlistCacheKey(userID uint, filterWatched, includeProgress bool) string {
	return watchlistCacheKeyAt(userID, currentUserVersion(userID), filterWatched, includeProgress)
}

// watchlistCacheKeyAt is watchlistCacheKey for a version already in hand.
func watchlistCacheKeyAt(userID uint, version uint64, filterWatched, includeProgress bool) string {
	return redisNamedKey(
		"watchlist",
		strconv.FormatUint(uint64(userID), 10),
		strconv.FormatUint(version, 10),
		boolFlag(filterWatched),
		boolFlag(includeProgress),
	)
}

func boolFlag(value bool) string {
	if value {
		return "1"
	}
	return "0"
}

// invalidateUserCaches retires every derived payload for a user.
//
// Kept separate from version bumping so the two concerns stay legible: this is
// called by handlers to express "this user's derived data changed", and the
// actual version advance happens in recordSyncOp so that the ETag, the cache
// key and the delta cursor can never disagree.
func invalidateUserCaches(userID uint) {
	// Version-keyed cache entries are retired by the version advance; nothing
	// to delete here. Retained as the single named seam so future per-user
	// cache keys that are NOT version-keyed have an obvious place to be
	// invalidated.
	_ = userID
}
