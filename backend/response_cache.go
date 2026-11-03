package main

import (
	"encoding/json"
	"log"
	"net/http"
	"strconv"
	"sync"
	"sync/atomic"
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

	// responseCacheTTL is how long the in-process tier keeps a payload.
	//
	// It must never exceed the payload TTLs above. etag.go derives its clock
	// bucket from the assumption that the server never reuses a payload for
	// longer than those TTLs, so a longer-lived local copy would let a client be
	// told "unchanged" about data the server is still serving out of an older
	// window: exactly the calendar-driven staleness the payload TTLs exist to
	// bound, and the one reason this tier may not be built with no expiry at all.
	responseCacheTTL = time.Minute

	// responseCacheEntries bounds the in-process tier by count. A whole response
	// here is tens of kilobytes rather than bytes, so the bound is deliberately
	// modest: 512 entries keeps the worst case in the tens of megabytes while
	// still covering the working set of active users times a few query variants.
	responseCacheEntries = 512

	// responseBuildWaitMax bounds how long a coalesced waiter parks on another
	// request's build. Past this the waiter rebuilds independently rather than
	// inherit a stalled request's latency. A cold Home build with a large
	// watchlist can legitimately take several seconds, so the bound is generous.
	responseBuildWaitMax = 10 * time.Second

	// warmDebounceDelay is how long a requested background rebuild waits for a
	// burst of mutations to settle. Clients mark episodes in batches, so without
	// it a ten-episode burst would queue ten full Home fan-outs.
	warmDebounceDelay = 750 * time.Millisecond
)

// responsePayloadCache is the in-process tier of whole-response caching.
//
// Without it, every request that misses Redis — which includes *all* requests
// on a deployment without REDIS_URL — rebuilds the payload from scratch. For
// the Home schedule that means one TMDB lookup per watchlist title on every
// screen entry, even though consecutive requests from the same user build a
// byte-identical payload. Entries expire on responseCacheTTL and the key is
// version-scoped, so the tier can neither outlive the window etag.go promises
// clients nor serve a version the user has already retired.
type responsePayloadCache struct {
	entries *expirable.LRU[string, []byte]

	// inflight coalesces concurrent builders for the same key. Two devices of
	// one user opening Home simultaneously must cost one rebuild, not two.
	inflightMu sync.Mutex
	inflight   map[string]*responseCall
}

// responseCall is one coalesced build.
//
// Only the goroutine that startCall reports as its leader may write to it, close
// it, or retire it. A caller that gives up waiting builds for itself without
// disturbing the call it abandoned: closing another goroutine's channel, or
// overwriting a payload mid-flight, would panic the process and hand the waiters
// a half-written result.
type responseCall struct {
	done    chan struct{}
	payload []byte
	built   bool // false when the build produced no cacheable payload
}

// newResponseCache builds one in-process tier. Tests construct short-lived
// instances of their own instead of reaching into the process-global one.
func newResponseCache(entries int, ttl time.Duration) *responsePayloadCache {
	onEvict := func(string, []byte) { metrics.recordResponseEviction() }
	return &responsePayloadCache{
		entries:  expirable.NewLRU[string, []byte](entries, onEvict, ttl),
		inflight: make(map[string]*responseCall),
	}
}

var responseCache = newResponseCache(responseCacheEntries, responseCacheTTL)

// cachedJSONResponse serves a JSON payload from the in-process cache, then
// Redis, then by building it and storing it in both tiers.
//
// Invariants:
//   - Redis being unavailable means "always miss", never an error.
//   - A payload that fails to build is not cached, and the request that ran the
//     build writes its own error response.
//   - Every request writes exactly one response for its own client. A waiter
//     that inherits a failed build falls back to building (and reporting) for
//     itself rather than returning an empty 200.
//   - Only successful (200) payloads are cached.
func cachedJSONResponse(c *gin.Context, key string, ttl time.Duration, build func() (any, bool)) {
	if payload, ok := responseCache.entries.Get(key); ok {
		metrics.recordLocalResponseHit()
		writeJSONPayload(c, payload)
		return
	}

	if payload, ok := redisGet(key); ok {
		// Re-populate the in-process tier. Redis does not report the remaining
		// lifetime on GET, so the entry gets a fresh responseCacheTTL: bounded
		// overshoot, and the key is version-scoped, so a retired version can
		// never be served anyway.
		responseCache.entries.Add(key, payload)
		writeJSONPayload(c, payload)
		return
	}

	call, leader := responseCache.startCall(key)
	if !leader {
		select {
		case <-call.done:
			if call.built {
				metrics.recordResponseCoalesced()
				writeJSONPayload(c, call.payload)
				return
			}
		// The leader's build failed and it wrote its own error response.
		// Fall through and build independently: this request still owes its
		// own client a response.
		case <-time.After(responseBuildWaitMax):
		// The leader is stalling. Build independently rather than inherit
		// its latency.
		case <-requestDone(c):
			return
		}

		// Independent build. This goroutine does not own the call, so it must not
		// publish to it, close it, or retire it.
		buildAndServe(c, key, ttl, build)
		return
	}

	// Leader: owns call for the rest of this function. Closing before retiring
	// the map entry means a request arriving in between joins a call whose
	// payload is already final instead of starting a second build, and the close
	// is deferred so a panicking build still releases every parked waiter.
	defer func() {
		close(call.done)
		responseCache.endCall(key, call)
	}()

	// Re-check the tier now that this request owns the key: another build may
	// have published between this request's miss and its registration.
	if payload, ok := responseCache.entries.Get(key); ok {
		metrics.recordLocalResponseHit()
		call.payload, call.built = payload, true
		writeJSONPayload(c, payload)
		return
	}

	result, ok := build()
	if !ok {
		// build() already wrote the error response.
		return
	}

	payload, ok := marshalPayload(key, result)
	if !ok {
		// The value could not be encoded, so it is servable but not cacheable.
		c.JSON(http.StatusOK, result)
		return
	}

	call.payload, call.built = payload, true
	responseCache.publish(key, payload, ttl)
	writeJSONPayload(c, payload)
}

// buildAndServe runs one build outside the coalescing layer: the path taken by
// a request whose coalesced build failed, stalled, or arrived too late to join.
func buildAndServe(c *gin.Context, key string, ttl time.Duration, build func() (any, bool)) {
	result, ok := build()
	if !ok {
		// build() already wrote the error response.
		return
	}

	payload, ok := marshalPayload(key, result)
	if !ok {
		c.JSON(http.StatusOK, result)
		return
	}

	responseCache.publish(key, payload, ttl)
	writeJSONPayload(c, payload)
}

// marshalPayload renders a built payload for caching. A marshal failure is
// logged and reported so the caller can serve the value uncached instead of
// caching something it could not encode.
func marshalPayload(key string, result any) ([]byte, bool) {
	payload, err := json.Marshal(result)
	if err != nil {
		log.Printf("Cache: failed to marshal payload for %s: %v", key, err)
		return nil, false
	}
	return payload, true
}

// publish stores a marshaled payload in both tiers, newest first in-process.
func (rc *responsePayloadCache) publish(key string, payload []byte, ttl time.Duration) {
	rc.entries.Add(key, payload)
	redisSet(key, payload, ttl)
}

func writeJSONPayload(c *gin.Context, payload []byte) {
	c.Data(http.StatusOK, "application/json; charset=utf-8", payload)
}

// requestDone returns the request's cancellation channel, or nil when the
// context carries no request (unit tests that build a bare gin.Context). A nil
// channel never fires in a select, which is the behaviour wanted here.
func requestDone(c *gin.Context) <-chan struct{} {
	if c == nil || c.Request == nil {
		return nil
	}
	return c.Request.Context().Done()
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

// endCall retires call, but only if it is still the registered build for key: a
// leader that was abandoned while waiting may already have been replaced.
func (rc *responsePayloadCache) endCall(key string, call *responseCall) {
	rc.inflightMu.Lock()
	if rc.inflight[key] == call {
		delete(rc.inflight, key)
	}
	rc.inflightMu.Unlock()
}

// purge drops every payload and in-flight registration. Tests use it so one
// test cannot read another's payload out of the process-global tier.
func (rc *responsePayloadCache) purge() {
	rc.entries.Purge()
	rc.inflightMu.Lock()
	rc.inflight = make(map[string]*responseCall)
	rc.inflightMu.Unlock()
}

// cacheWarmDisabled switches the background rebuild off. It exists for tests,
// which replace and close the package-level database handle the rebuild reads;
// production never sets it. Atomic because a handler goroutine may still be
// consulting it while a test changes it.
var cacheWarmDisabled atomic.Bool

// warmState tracks, per user, the newest version that still needs warming and
// whether a rebuild loop is already running for that user.
var warmState = struct {
	mu      sync.Mutex
	pending map[uint]uint64
	running map[uint]bool
}{
	pending: make(map[uint]uint64),
	running: make(map[uint]bool),
}

// warmUserCaches asks for a user's derived payloads to be rebuilt in the
// background after their sync version advanced, so the first request after a
// mutation reads them from cache instead of paying for a full rebuild on the
// critical path.
//
// Best-effort by design: it runs detached from the finished request, coalesces
// with any real request already building the same payload (the inflight map in
// cachedJSONResponse), collapses a burst of mutations onto the newest version,
// and every failure path simply leaves the next real request to build
// synchronously, exactly as it did before warming existed.
//
// Callers must pass the version the mutation produced, never a version read
// before it: warming the version that is about to be retired is pure waste.
func warmUserCaches(userID uint, version uint64) {
	if cacheWarmDisabled.Load() {
		return
	}

	warmState.mu.Lock()
	warmState.pending[userID] = version
	running := warmState.running[userID]
	if !running {
		warmState.running[userID] = true
	}
	warmState.mu.Unlock()

	if running {
		// The loop already running will pick the newer version up.
		return
	}

	go warmUserCachesLoop(userID)
}

// warmUserCachesLoop drains one user's pending version, newest last, until
// nothing is pending. The pending check and the running flag are changed under
// one lock hold, so "nothing pending" and "no loop running" can never disagree
// and strand a requested warm.
func warmUserCachesLoop(userID uint) {
	// Let a burst of mutations settle before paying for a rebuild.
	time.Sleep(warmDebounceDelay)

	for {
		warmState.mu.Lock()
		version, pending := warmState.pending[userID]
		if pending {
			delete(warmState.pending, userID)
		} else {
			delete(warmState.running, userID)
		}
		warmState.mu.Unlock()

		if !pending {
			return
		}

		warmUserCachesAt(userID, version)
	}
}

// warmUserCachesAt rebuilds one version of a user's payloads, swallowing panics
// so a single bad rebuild cannot kill the loop that keeps the tier warm.
func warmUserCachesAt(userID uint, version uint64) {
	defer func() {
		if r := recover(); r != nil {
			log.Printf("Cache warm: panic while rebuilding user %d at version %d: %v", userID, version, r)
		}
	}()

	homeKey := homeScheduleCacheKeyAt(userID, version)
	listKey := watchlistCacheKeyAt(userID, version, false, false)

	_, homePresent := responseCache.entries.Get(homeKey)
	_, listPresent := responseCache.entries.Get(listKey)
	if homePresent && listPresent {
		return
	}

	// A background build has no request scope and no response to write: callScope
	// helpers are nil-receiver safe precisely for this (see metrics.go).
	warmPayload(homeKey, homeScheduleCacheTTL, func() (any, error) {
		return buildHomeSchedulePayload(userID, nil)
	})
	warmPayload(listKey, watchlistCacheTTL, func() (any, error) {
		return buildWatchlistPayload(userID, false, false, nil)
	})
}

// warmPayload builds one cache entry into the in-process tier and mirrors it to
// Redis through the normal path. A real request already building this key wins:
// the warmer waits instead of duplicating the fan-out.
func warmPayload(key string, ttl time.Duration, produce func() (any, error)) {
	call, leader := responseCache.startCall(key)
	if !leader {
		select {
		case <-call.done:
		case <-time.After(responseBuildWaitMax):
		}
		return
	}

	// Leader owns call. Deferred so a panicking build still releases anyone who
	// joined, and so the map entry can never outlive its channel.
	defer func() {
		close(call.done)
		responseCache.endCall(key, call)
	}()

	result, err := produce()
	if err != nil {
		log.Printf("Cache warm: build failed for %s: %v", key, err)
		return
	}

	payload, ok := marshalPayload(key, result)
	if !ok {
		return
	}

	call.payload, call.built = payload, true
	responseCache.publish(key, payload, ttl)
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
// key and the delta cursor can never disagree. recordSyncOp is also where the
// background warm is requested, because only there is the new version known.
func invalidateUserCaches(userID uint) {
	// Version-keyed cache entries are retired by the version advance; nothing
	// to delete here. Retained as the single named seam so future per-user
	// cache keys that are NOT version-keyed have an obvious place to be
	// invalidated.
	_ = userID
}
