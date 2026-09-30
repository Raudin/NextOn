package main

import (
	"crypto/subtle"
	"errors"
	"log"
	"net/http"
	"os"
	"runtime"
	"strconv"
	"strings"
	"time"

	"github.com/prometheus/client_golang/prometheus"
	"github.com/prometheus/client_golang/prometheus/collectors"
	"github.com/prometheus/client_golang/prometheus/promhttp"
)

// Prometheus exposition.
//
// metrics.go already maintains everything worth knowing about this process —
// per-route latency and errors, outbound TMDB/OMDb call counts, Redis hit and
// error rates — but it can only report them as JSON on a debug endpoint that
// release mode deliberately does not register. That leaves the numbers
// unobservable exactly where they matter. This file is the scrapeable view of
// the same data.
//
// Four rules decide everything below:
//
//   - The registry is private. Never the process-wide default registry, so the
//     exposed surface is exactly the set registered here and a dependency
//     cannot add series behind our back.
//
//   - The process-wide numbers are NOT re-counted. Counters that already exist
//     in metricsRegistry are read on each scrape through CounterFunc, so
//     Prometheus and /api/debug/stats are two views of one set of atomics and
//     cannot disagree. Only per-request observations (latency, size, status)
//     are recorded separately, because a histogram cannot be reconstructed
//     from a total.
//
//   - Label values are bounded by construction. `route` is always a gin route
//     pattern (c.FullPath()) or the literal "unmatched", never a raw URL. The
//     existing debug endpoint makes the same choice for the same reason:
//     Prometheus charges for series, and "unmatched" is where arbitrary paths
//     would otherwise accumulate one series each.
//
//   - The exposition has its OWN listener (METRICS_ADDR), not a route on the
//     API router. The API answers on a public domain, and a misconfigured
//     domain is not a good reason for traffic patterns and cache hit rates to
//     become world-readable. Unset METRICS_ADDR means the listener is never
//     started, which is the convention REDIS_URL already established.

// metricsPath is the path the exposition is served on, and the one route
// MetricsMiddleware refuses to instrument (a scrape is not traffic).
const metricsPath = "/metrics"

// httpLatencyBuckets reach further than the client library's defaults. Latency
// here is dominated by outbound TMDB calls, so the interesting range is
// hundreds of milliseconds to seconds; the defaults put almost every request in
// the first three buckets and hide the difference between a cache hit and a
// fetch.
var httpLatencyBuckets = []float64{0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10}

// httpResponseSizeBuckets cover the payload sizes this API actually serves:
// small status responses up to the multi-hundred-kilobyte list payloads.
var httpResponseSizeBuckets = []float64{256, 1e3, 5e3, 2e4, 1e5, 5e5, 1e6}

var (
	// promRegistry is the private registry behind metricsHandler.
	promRegistry = prometheus.NewRegistry()

	httpRequestsTotal = prometheus.NewCounterVec(prometheus.CounterOpts{
		Name: "nexton_http_requests_total",
		Help: "Completed HTTP requests by route pattern, method and status code. 304s count here, so the revalidation win is visible in the status label.",
	}, []string{"route", "method", "status"})

	httpRequestDuration = prometheus.NewHistogramVec(prometheus.HistogramOpts{
		Name:    "nexton_http_request_duration_seconds",
		Help:    "Time from the start of the middleware chain to the response writer's last write.",
		Buckets: httpLatencyBuckets,
	}, []string{"route", "method"})

	httpResponseSize = prometheus.NewHistogramVec(prometheus.HistogramOpts{
		Name:    "nexton_http_response_size_bytes",
		Help:    "Response body size by route pattern. The derived list payloads are why an image and payload budget exists in this project.",
		Buckets: httpResponseSizeBuckets,
	}, []string{"route"})

	// httpRequestsInFlight is decremented with defer rather than after
	// c.Next() so a handler panic — recovered by gin's Recovery middleware,
	// which sits outside this middleware — cannot leave the gauge stuck above
	// zero forever.
	httpRequestsInFlight = prometheus.NewGauge(prometheus.GaugeOpts{
		Name: "nexton_http_requests_in_flight",
		Help: "HTTP requests currently being served. A sustained climb points at outbound calls, not at inbound traffic.",
	})

	// nextonBuildInfo carries the toolchain and the deploy's version label, so
	// a graph can be pinned to a specific rollout.
	nextonBuildInfo = prometheus.NewGauge(prometheus.GaugeOpts{
		Name: "nexton_build_info",
		Help: "Always 1. The labels carry what this binary was built from.",
		ConstLabels: prometheus.Labels{
			"version":    buildVersion(),
			"go_version": runtime.Version(),
		},
	})
)

// buildVersion reports the version label for nexton_build_info.
//
// Read from the environment rather than from .env on purpose: the value has to
// describe the running image, and godotenv.Load() is not reached until main(),
// long after package initialisation. Unset is a legitimate answer ("dev").
func buildVersion() string {
	if version := strings.TrimSpace(os.Getenv("APP_VERSION")); version != "" {
		return version
	}
	return "dev"
}

// init registers the exposition.
//
// Registration happens at package initialisation so tests can scrape without
// starting a listener, and it is MustRegister because a duplicate name is a
// programming error that should fail loudly at startup instead of silently
// dropping a series.
func init() {
	promRegistry.MustRegister(
		// Runtime and resource usage. For a service whose whole design is
		// "do not fan out TMDB calls", goroutine count and heap are the two
		// numbers that move first when that design is violated.
		collectors.NewGoCollector(),
		collectors.NewProcessCollector(collectors.ProcessCollectorOpts{}),

		httpRequestsTotal,
		httpRequestDuration,
		httpResponseSize,
		httpRequestsInFlight,
		nextonBuildInfo,

		newRouteCallCollector(),
	)

	for _, counter := range processCounters() {
		promRegistry.MustRegister(counter)
	}

	nextonBuildInfo.Set(1)
}

// processCounters projects the atomics in metricsRegistry onto the registry.
//
// CounterFunc is used deliberately instead of incrementing a second counter at
// every call site: there is exactly one increment per event, and the Prometheus
// value is equal to what /api/debug/stats reports by construction. Reading at
// scrape time is also why a scrape never perturbs the counters it reports.
func processCounters() []prometheus.Collector {
	return []prometheus.Collector{
		prometheus.NewCounterFunc(prometheus.CounterOpts{
			Name: "nexton_tmdb_fetches_total",
			Help: "Outbound TMDB requests, excluding cache hits. The number the caching work exists to keep down.",
		}, func() float64 { return float64(metrics.tmdbFetches.Load()) }),

		prometheus.NewCounterFunc(prometheus.CounterOpts{
			Name: "nexton_tmdb_cache_hits_total",
			Help: "TMDB lookups answered from an in-process or Redis cache without an outbound request.",
		}, func() float64 { return float64(metrics.tmdbHits.Load()) }),

		prometheus.NewCounterFunc(prometheus.CounterOpts{
			Name: "nexton_tmdb_cache_misses_total",
			Help: "TMDB lookups that were not cached and had to be fetched.",
		}, func() float64 { return float64(metrics.tmdbMisses.Load()) }),

		prometheus.NewCounterFunc(prometheus.CounterOpts{
			Name: "nexton_omdb_fetches_total",
			Help: "Outbound OMDb requests. On the request path this should stay near zero; ratings are read from the durable store and refreshed in the background.",
		}, func() float64 { return float64(metrics.omdbFetches.Load()) }),

		prometheus.NewCounterFunc(prometheus.CounterOpts{
			Name: "nexton_omdb_store_hits_total",
			Help: "Ratings reads satisfied by the durable MediaRating table.",
		}, func() float64 { return float64(metrics.omdbStoreHits.Load()) }),

		prometheus.NewCounterFunc(prometheus.CounterOpts{
			Name: "nexton_omdb_store_misses_total",
			Help: "Ratings reads with no stored row yet. Normal after a cold start, a problem once the store is warm.",
		}, func() float64 { return float64(metrics.omdbStoreMiss.Load()) }),

		prometheus.NewCounterFunc(prometheus.CounterOpts{
			Name: "nexton_redis_cache_hits_total",
			Help: "Second-level cache reads that returned a value.",
		}, func() float64 { return float64(metrics.redisHits.Load()) }),

		prometheus.NewCounterFunc(prometheus.CounterOpts{
			Name: "nexton_redis_cache_misses_total",
			Help: "Second-level cache reads that returned nothing, including the graceful-miss path taken when Redis is unreachable.",
		}, func() float64 { return float64(metrics.redisMisses.Load()) }),

		// Worth an alert: this counter only moves when Redis fails, and every
		// such failure means requests are served without their cache. It is
		// also the signal that catches a bad REDIS_URL, which is otherwise
		// invisible because the fallback is silent by design.
		prometheus.NewCounterFunc(prometheus.CounterOpts{
			Name: "nexton_redis_errors_total",
			Help: "Redis operations that errored or timed out. Non-zero means requests are being served without the second-level cache.",
		}, func() float64 { return float64(metrics.redisErrors.Load()) }),

		prometheus.NewGaugeFunc(prometheus.GaugeOpts{
			Name: "nexton_uptime_seconds",
			Help: "Seconds since the process counters were initialised. A reset means a deploy or a crash loop.",
		}, func() float64 { return time.Since(metrics.startedAt).Seconds() }),
	}
}

// routeCallCollector mirrors metricsRegistry's per-route outbound-call counters.
//
// This is the one metric that cannot be replaced by a sum over the route table:
// "how many TMDB calls does a single /api/home/schedule request cost" is the
// question the callScope indirection in metrics.go was built to answer, and
// only a per-route series can answer it after the fact. Dividing
// rate(nexton_route_tmdb_calls_total) by rate(nexton_http_requests_total) gives
// the fan-out per request directly.
//
// A real Collector rather than one CounterFunc per route, because the route set
// is discovered at runtime and registering a collector mid-scrape is not safe.
type routeCallCollector struct {
	tmdbCalls   *prometheus.Desc
	omdbCalls   *prometheus.Desc
	omdbLookups *prometheus.Desc
}

func newRouteCallCollector() *routeCallCollector {
	return &routeCallCollector{
		tmdbCalls: prometheus.NewDesc(
			"nexton_route_tmdb_calls_total",
			"Outbound TMDB requests attributed to one route pattern by callScope.",
			[]string{"route"}, nil),
		omdbCalls: prometheus.NewDesc(
			"nexton_route_omdb_calls_total",
			"Outbound OMDb requests attributed to one route pattern by callScope.",
			[]string{"route"}, nil),
		omdbLookups: prometheus.NewDesc(
			"nexton_route_omdb_store_lookups_total",
			"Durable-store ratings lookups attributed to one route pattern by callScope.",
			[]string{"route"}, nil),
	}
}

func (c *routeCallCollector) Describe(ch chan<- *prometheus.Desc) {
	ch <- c.tmdbCalls
	ch <- c.omdbCalls
	ch <- c.omdbLookups
}

// Collect takes the read lock the route table is already guarded by, so a
// scrape cannot race a first-time route insertion.
func (c *routeCallCollector) Collect(ch chan<- prometheus.Metric) {
	metrics.mu.RLock()
	defer metrics.mu.RUnlock()

	for pattern, stat := range metrics.routes {
		ch <- prometheus.MustNewConstMetric(c.tmdbCalls, prometheus.CounterValue, float64(stat.tmdbCalls.Load()), pattern)
		ch <- prometheus.MustNewConstMetric(c.omdbCalls, prometheus.CounterValue, float64(stat.omdbCalls.Load()), pattern)
		ch <- prometheus.MustNewConstMetric(c.omdbLookups, prometheus.CounterValue, float64(stat.omdbLookups.Load()), pattern)
	}
}

// observeHTTPRequest records one completed request.
//
// Called from MetricsMiddleware, which already has the route pattern, the status
// and the elapsed time in hand, so this adds one label lookup and no allocation
// on the happy path.
func observeHTTPRequest(route, method string, status int, elapsed time.Duration, responseBytes int) {
	httpRequestsTotal.WithLabelValues(route, method, strconv.Itoa(status)).Inc()
	httpRequestDuration.WithLabelValues(route, method).Observe(elapsed.Seconds())

	// gin reports -1 when the handler never wrote a body (an aborted request,
	// for instance). Recording that as a negative observation would be a lie
	// about a zero-byte response.
	if responseBytes < 0 {
		responseBytes = 0
	}
	httpResponseSize.WithLabelValues(route).Observe(float64(responseBytes))
}

// metricsHandler returns the exposition handler.
//
// METRICS_TOKEN is read per request rather than captured at startup, for two
// reasons: it keeps working when the value arrives from .env, which is loaded
// in main() and therefore after package initialisation, and rotating it needs
// only an environment change rather than a code change.
func metricsHandler() http.Handler {
	exposition := promhttp.HandlerFor(promRegistry, promhttp.HandlerOpts{
		// A single failing collector should not blank the whole scrape; the
		// other series are still the useful signal.
		ErrorHandling: promhttp.ContinueOnError,
	})

	token := strings.TrimSpace(os.Getenv("METRICS_TOKEN"))
	if token == "" {
		return exposition
	}

	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if subtle.ConstantTimeCompare([]byte(bearerToken(r)), []byte(token)) != 1 {
			w.Header().Set("WWW-Authenticate", `Bearer realm="metrics"`)
			http.Error(w, "unauthorized", http.StatusUnauthorized)
			return
		}
		exposition.ServeHTTP(w, r)
	})
}

// bearerToken extracts the credential from an "Authorization: Bearer x" header,
// returning "" for anything else. ConstantTimeCompare already answers 0 on a
// length mismatch, so there is no separate length check to get wrong.
func bearerToken(r *http.Request) string {
	const prefix = "Bearer "
	header := r.Header.Get("Authorization")
	if !strings.HasPrefix(header, prefix) {
		return ""
	}
	return strings.TrimPrefix(header, prefix)
}

// startMetricsServer serves the exposition on its own listener.
//
// Deliberately not a route on the gin router: the API is reachable through a
// public domain, and this endpoint describes traffic patterns, cache hit rates
// and route names. Keeping it on a separate address means routing that reaches
// the API cannot reach this, so an in-network scrape needs no credentials while
// METRICS_TOKEN remains available as a second lock.
//
// A failure here must never affect the API, so the listener runs in its own
// goroutine and reports errors by log line only. It returns whether a listener
// was started so that the disabled branch is assertable in a test rather than
// only observable in the startup log.
func startMetricsServer() bool {
	addr := strings.TrimSpace(os.Getenv("METRICS_ADDR"))
	if addr == "" {
		log.Println("Metrics: METRICS_ADDR not set; Prometheus exposition disabled")
		return false
	}

	mux := http.NewServeMux()
	mux.Handle(metricsPath, metricsHandler())

	server := &http.Server{
		Addr:    addr,
		Handler: mux,
		// Bounded so a half-open connection cannot hold a slot indefinitely.
		ReadHeaderTimeout: 5 * time.Second,
	}

	go func() {
		if err := server.ListenAndServe(); err != nil && !errors.Is(err, http.ErrServerClosed) {
			log.Printf("Metrics: exposition server stopped: %v", err)
		}
	}()

	tokenNote := ""
	if os.Getenv("METRICS_TOKEN") != "" {
		tokenNote = " (bearer token required)"
	}
	log.Printf("Metrics: serving Prometheus exposition on %s%s%s", addr, metricsPath, tokenNote)
	return true
}
