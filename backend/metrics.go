package main

import (
	"net/http"
	"sort"
	"sync"
	"sync/atomic"
	"time"

	"github.com/gin-gonic/gin"
)

// This file exists to make the performance work in this repository provable.
// Before any caching or aggregation change, we need to know how many inbound
// requests a screen issues and how many outbound TMDB/OMDb calls each inbound
// request causes. Every counter here is lock-free except the per-route table,
// which only takes a mutex when a route is seen for the first time.

// callScope counts outbound third-party calls attributable to a single inbound
// request.
//
// This indirection is deliberate: Go has no goroutine-local storage, and
// diffing the process-wide counters around a handler would attribute other
// concurrent requests' outbound calls to this one (gin serves handlers on the
// same goroutine pool, and handleGetWatchlist fans out its own goroutines).
// Threading an explicit scope is the only accurate option.
type callScope struct {
	tmdb        atomic.Int64
	omdb        atomic.Int64
	omdbLookups atomic.Int64
}

// Nil-receiver safe so call sites do not need to branch when a scope is absent
// (background refreshes and tests run without one).
func (s *callScope) addTMDB() {
	if s != nil {
		s.tmdb.Add(1)
	}
}

// addOMDb records a real outbound OMDb request. After the ratings work this
// should stay near zero on the request path: lookups read the durable store and
// schedule a background refresh instead.
func (s *callScope) addOMDb() {
	if s != nil {
		s.omdb.Add(1)
	}
}

// addOMDbLookup records a durable-store ratings lookup, which is the work the
// request path actually does now.
func (s *callScope) addOMDbLookup() {
	if s != nil {
		s.omdbLookups.Add(1)
	}
}

func (s *callScope) TMDB() int64 {
	if s == nil {
		return 0
	}
	return s.tmdb.Load()
}

func (s *callScope) OMDb() int64 {
	if s == nil {
		return 0
	}
	return s.omdb.Load()
}

func (s *callScope) OMDbLookups() int64 {
	if s == nil {
		return 0
	}
	return s.omdbLookups.Load()
}

const callScopeContextKey = "nexton_call_scope"

// CallScopeMiddleware attaches a fresh callScope to every request so handlers
// and the helpers they call can record outbound calls without knowing about
// each other.
func CallScopeMiddleware() gin.HandlerFunc {
	return func(c *gin.Context) {
		c.Set(callScopeContextKey, &callScope{})
		c.Next()
	}
}

// scopeFrom returns the request's callScope, or nil when the middleware is not
// installed (unit tests, direct handler invocation). All helpers it is passed
// to are nil-safe.
func scopeFrom(c *gin.Context) *callScope {
	if c == nil {
		return nil
	}
	if v, ok := c.Get(callScopeContextKey); ok {
		if s, ok := v.(*callScope); ok {
			return s
		}
	}
	return nil
}

// routeStat aggregates timing and outbound-call counts for one route pattern.
type routeStat struct {
	count       atomic.Int64
	errors      atomic.Int64
	totalNs     atomic.Int64
	maxNs       atomic.Int64
	tmdbCalls   atomic.Int64
	omdbCalls   atomic.Int64
	omdbLookups atomic.Int64
}

func (r *routeStat) observe(ns int64, isError bool, scope *callScope) {
	r.count.Add(1)
	if isError {
		r.errors.Add(1)
	}
	r.totalNs.Add(ns)
	for {
		cur := r.maxNs.Load()
		if ns <= cur || r.maxNs.CompareAndSwap(cur, ns) {
			break
		}
	}
	if scope != nil {
		r.tmdbCalls.Add(scope.TMDB())
		r.omdbCalls.Add(scope.OMDb())
		r.omdbLookups.Add(scope.OMDbLookups())
	}
}

// metricsRegistry is the process-wide counter set behind /api/debug/stats.
type metricsRegistry struct {
	startedAt time.Time

	// Process-wide totals, including calls made outside any request (background
	// ratings refresh, warm-up).
	tmdbFetches atomic.Int64
	tmdbHits    atomic.Int64
	tmdbMisses  atomic.Int64

	omdbFetches   atomic.Int64
	omdbStoreHits atomic.Int64
	omdbStoreMiss atomic.Int64

	// Redis counters are wired in by the Phase 2 cache layer. They live here
	// from the start so the debug endpoint does not need to change shape later.
	redisHits   atomic.Int64
	redisMisses atomic.Int64
	redisErrors atomic.Int64

	mu     sync.RWMutex
	routes map[string]*routeStat
}

var metrics = &metricsRegistry{
	startedAt: time.Now(),
	routes:    make(map[string]*routeStat),
}

func (m *metricsRegistry) route(pattern string) *routeStat {
	m.mu.RLock()
	stat, ok := m.routes[pattern]
	m.mu.RUnlock()
	if ok {
		return stat
	}

	m.mu.Lock()
	defer m.mu.Unlock()
	// Re-check: another goroutine may have inserted while we upgraded the lock.
	if stat, ok := m.routes[pattern]; ok {
		return stat
	}
	stat = &routeStat{}
	m.routes[pattern] = stat
	return stat
}

// MetricsMiddleware records per-route latency and outbound-call fan-out.
//
// It feeds two consumers from one observation: the JSON snapshot behind
// /api/debug/stats (metrics.route(...).observe) and the Prometheus series
// exposed by prometheus.go (observeHTTPRequest). Neither is derived from the
// other, so a change here has to keep both in mind.
func MetricsMiddleware() gin.HandlerFunc {
	return func(c *gin.Context) {
		started := time.Now()
		httpRequestsInFlight.Inc()
		// Deferred rather than decremented after c.Next(): a panicking handler
		// unwinds through this middleware before gin's Recovery middleware
		// catches it, and a gauge stuck above zero is worse than a missing
		// observation.
		defer httpRequestsInFlight.Dec()

		c.Next()

		pattern := c.FullPath()
		if pattern == "" {
			// No route matched (404/405). Group these together rather than
			// letting arbitrary URL paths grow the map without bound.
			pattern = "unmatched"
		}

		// A scrape is not traffic. The exposition is served on its own
		// listener, so this only matters if /metrics is ever wired into this
		// router — in which case it must not appear in its own dashboards.
		if pattern == metricsPath {
			return
		}

		status := c.Writer.Status()
		elapsed := time.Since(started)
		metrics.route(pattern).observe(
			elapsed.Nanoseconds(),
			status >= http.StatusBadRequest,
			scopeFrom(c),
		)
		observeHTTPRequest(pattern, c.Request.Method, status, elapsed, c.Writer.Size())
	}
}

// recordTMDB records a cache hit or a real outbound TMDB fetch.
func (m *metricsRegistry) recordTMDB(hit bool) {
	if hit {
		m.tmdbHits.Add(1)
		return
	}
	m.tmdbMisses.Add(1)
	m.tmdbFetches.Add(1)
}

// recordOMDbFetch records a real outbound OMDb request.
func (m *metricsRegistry) recordOMDbFetch() {
	m.omdbFetches.Add(1)
}

// recordOMDbStore records whether a ratings lookup was satisfied by the durable
// MediaRating table.
func (m *metricsRegistry) recordOMDbStore(hit bool) {
	if hit {
		m.omdbStoreHits.Add(1)
		return
	}
	m.omdbStoreMiss.Add(1)
}

// routeSnapshot is the JSON shape for one route in /api/debug/stats.
type routeSnapshot struct {
	Route             string  `json:"route"`
	Requests          int64   `json:"requests"`
	Errors            int64   `json:"errors"`
	AvgMs             float64 `json:"avg_ms"`
	MaxMs             float64 `json:"max_ms"`
	TMDBPerRequest    float64 `json:"tmdb_calls_per_request"`
	OMDbPerRequest    float64 `json:"omdb_calls_per_request"`
	OMDbLookupsPerReq float64 `json:"omdb_store_lookups_per_request"`
	TMDBTotal         int64   `json:"tmdb_calls_total"`
	OMDbTotal         int64   `json:"omdb_calls_total"`
	OMDbLookupsTotal  int64   `json:"omdb_store_lookups_total"`
}

func (m *metricsRegistry) snapshot() gin.H {
	m.mu.RLock()
	defer m.mu.RUnlock()

	rows := make([]routeSnapshot, 0, len(m.routes))
	for pattern, stat := range m.routes {
		count := stat.count.Load()
		var avgMs float64
		if count > 0 {
			avgMs = float64(stat.totalNs.Load()) / float64(count) / 1e6
		}

		row := routeSnapshot{
			Route:            pattern,
			Requests:         count,
			Errors:           stat.errors.Load(),
			AvgMs:            round2(avgMs),
			MaxMs:            round2(float64(stat.maxNs.Load()) / 1e6),
			TMDBTotal:        stat.tmdbCalls.Load(),
			OMDbTotal:        stat.omdbCalls.Load(),
			OMDbLookupsTotal: stat.omdbLookups.Load(),
		}
		if count > 0 {
			row.TMDBPerRequest = round2(float64(row.TMDBTotal) / float64(count))
			row.OMDbPerRequest = round2(float64(row.OMDbTotal) / float64(count))
			row.OMDbLookupsPerReq = round2(float64(row.OMDbLookupsTotal) / float64(count))
		}
		rows = append(rows, row)
	}

	// Stable ordering so repeated calls are diffable.
	sort.Slice(rows, func(i, j int) bool { return rows[i].Route < rows[j].Route })

	return gin.H{
		"uptime_seconds": round2(time.Since(m.startedAt).Seconds()),
		"totals": gin.H{
			"tmdb_fetches":      m.tmdbFetches.Load(),
			"tmdb_cache_hits":   m.tmdbHits.Load(),
			"tmdb_cache_misses": m.tmdbMisses.Load(),
			"omdb_fetches":      m.omdbFetches.Load(),
			"omdb_store_hits":   m.omdbStoreHits.Load(),
			"omdb_store_misses": m.omdbStoreMiss.Load(),
			"redis_hits":        m.redisHits.Load(),
			"redis_misses":      m.redisMisses.Load(),
			"redis_errors":      m.redisErrors.Load(),
		},
		"routes": rows,
	}
}

func round2(v float64) float64 {
	return float64(int64(v*100+0.5)) / 100
}

// handleDebugStats reports the counters above. It is registered only when the
// server is not in release mode (see main.go) so it cannot leak traffic
// patterns from production.
func handleDebugStats(c *gin.Context) {
	c.JSON(http.StatusOK, metrics.snapshot())
}
