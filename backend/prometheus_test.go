package main

import (
	"io"
	"net/http"
	"net/http/httptest"
	"strconv"
	"strings"
	"testing"

	"github.com/gin-gonic/gin"
)

// Tests for the Prometheus exposition in prometheus.go.
//
// Every assertion here scrapes through the real handler rather than inspecting
// the registry directly: what breaks in production is the exposition endpoint,
// not the collector struct, and going through the handler also proves the
// registry is wired the way the scraper expects.

// scrapeExposition serves one scrape through the real handler.
func scrapeExposition(t *testing.T) string {
	t.Helper()

	recorder := httptest.NewRecorder()
	metricsHandler().ServeHTTP(recorder, httptest.NewRequest(http.MethodGet, metricsPath, nil))

	if recorder.Code != http.StatusOK {
		t.Fatalf("expected the exposition to return 200, got %d", recorder.Code)
	}
	if contentType := recorder.Header().Get("Content-Type"); !strings.Contains(contentType, "text/plain") {
		t.Fatalf("expected a text exposition, got Content-Type %q", contentType)
	}

	body, err := io.ReadAll(recorder.Body)
	if err != nil {
		t.Fatalf("failed to read the exposition body: %v", err)
	}
	return string(body)
}

// seriesValue returns the value of the exposition line matching a full series
// prefix (including its trailing space), or -1 when no such line exists.
func seriesValue(t *testing.T, body, prefix string) float64 {
	t.Helper()

	for _, line := range strings.Split(body, "\n") {
		if !strings.HasPrefix(line, prefix) {
			continue
		}
		raw := strings.TrimSpace(strings.TrimPrefix(line, prefix))
		value, err := strconv.ParseFloat(raw, 64)
		if err != nil {
			t.Fatalf("failed to parse value %q of series %q: %v", raw, prefix, err)
		}
		return value
	}
	return -1
}

func TestExpositionRendersRuntimeAndProcessMetrics(t *testing.T) {
	body := scrapeExposition(t)

	// The Go and process collectors must be present before a single request:
	// they are the baseline that says "this binary is alive".
	for _, series := range []string{
		"go_goroutines",
		"go_memstats_heap_inuse_bytes",
		"process_resident_memory_bytes",
		"nexton_uptime_seconds",
		"nexton_build_info",
		"nexton_tmdb_fetches_total",
		"nexton_redis_errors_total",
		"nexton_http_requests_in_flight",
	} {
		if !strings.Contains(body, series) {
			t.Errorf("expected the exposition to contain %q", series)
		}
	}
}

// TestMetricsMiddlewareRecordsRouteOutcome goes through newRouter so the real
// middleware order is exercised, then asserts on the scraped text. A route
// pattern, not a URL, has to be what lands in the label: that is the only thing
// keeping the series count bounded.
func TestMetricsMiddlewareRecordsRouteOutcome(t *testing.T) {
	router, _, token := initRouterTest(t)

	recorder := httptest.NewRecorder()
	router.ServeHTTP(recorder, authedRequest(t, http.MethodGet, "/api/sync/state", token))
	if recorder.Code != http.StatusOK {
		t.Fatalf("expected the seeded request to succeed, got %d", recorder.Code)
	}

	body := scrapeExposition(t)

	// Label names are sorted by the client library, so the render order is
	// method, route, status.
	requests := seriesValue(t, body, `nexton_http_requests_total{method="GET",route="/api/sync/state",status="200"} `)
	if requests < 1 {
		t.Fatalf("expected the route counter to have recorded the request, got %v", requests)
	}

	if count := seriesValue(t, body, `nexton_http_request_duration_seconds_count{method="GET",route="/api/sync/state"} `); count < 1 {
		t.Fatalf("expected the latency histogram to have recorded the request, got %v", count)
	}

	if !strings.Contains(body, `nexton_http_response_size_bytes_count{route="/api/sync/state"} `) {
		t.Errorf("expected a response size observation for the route:\n%s", body)
	}
}

// TestProcessCountersMirrorDebugStats is the guarantee that makes the two
// observability surfaces trustworthy: the Prometheus value is read from the
// same atomic that /api/debug/stats reports, so the two cannot drift apart.
func TestProcessCountersMirrorDebugStats(t *testing.T) {
	previous := metrics.tmdbFetches.Load()
	t.Cleanup(func() { metrics.tmdbFetches.Store(previous) })

	metrics.tmdbFetches.Add(7)

	body := scrapeExposition(t)
	scraped := seriesValue(t, body, "nexton_tmdb_fetches_total ")
	if scraped != float64(previous+7) {
		t.Fatalf("expected nexton_tmdb_fetches_total to be %d, got %v", previous+7, scraped)
	}

	totals, ok := metrics.snapshot()["totals"].(gin.H)
	if !ok {
		t.Fatal("expected the debug snapshot to expose a totals object")
	}
	if totals["tmdb_fetches"] != previous+7 {
		t.Fatalf("expected the debug snapshot to report %d, got %v", previous+7, totals["tmdb_fetches"])
	}
}

// TestRouteCallCollectorReportsFanOut covers the per-route outbound-call series
// that makes "how many TMDB calls did this screen cost" answerable after the
// fact, which is the question callScope was introduced to answer.
func TestRouteCallCollectorReportsFanOut(t *testing.T) {
	stat := metrics.route("/test/fan-out")
	previous := stat.tmdbCalls.Load()
	t.Cleanup(func() { stat.tmdbCalls.Store(previous) })

	stat.tmdbCalls.Add(4)

	body := scrapeExposition(t)
	if got := seriesValue(t, body, `nexton_route_tmdb_calls_total{route="/test/fan-out"} `); got != float64(previous+4) {
		t.Fatalf("expected the per-route fan-out counter to be %d, got %v", previous+4, got)
	}
}

// TestUnknownPathsCollapseToUnmatched guards the cardinality decision. These
// requests reach a router with no matching route, so the 404s must land once
// under "unmatched" rather than once per URL.
func TestUnknownPathsCollapseToUnmatched(t *testing.T) {
	router, _, _ := initRouterTest(t)

	paths := []string{"/nope", "/also-nope"}
	for _, path := range paths {
		recorder := httptest.NewRecorder()
		router.ServeHTTP(recorder, httptest.NewRequest(http.MethodGet, path, nil))
		if recorder.Code != http.StatusNotFound {
			t.Fatalf("expected %s to return 404, got %d", path, recorder.Code)
		}
	}

	body := scrapeExposition(t)
	if !strings.Contains(body, `route="unmatched"`) {
		t.Fatalf("expected unmatched requests to be grouped under \"unmatched\":\n%s", body)
	}
	for _, path := range paths {
		if strings.Contains(body, `route="`+path+`"`) {
			t.Errorf("expected the raw URL %s not to become a label value", path)
		}
	}
}

// TestMetricsServerDisabledWithoutAddr covers the convention that everything
// optional in this service follows: unset means off, and off must be reported
// rather than silently attempted. The enabled path is exercised by the other
// tests through metricsHandler; this asserts the branch a live run cannot.
func TestMetricsServerDisabledWithoutAddr(t *testing.T) {
	t.Setenv("METRICS_ADDR", "")

	if startMetricsServer() {
		t.Fatal("expected the exposition server to stay disabled when METRICS_ADDR is unset")
	}
}

// TestMetricsTokenProtectsExposition covers the optional second lock. It is
// unset by default, which is what the in-network scrape relies on, so the unset
// case is asserted first.
func TestMetricsTokenProtectsExposition(t *testing.T) {
	t.Setenv("METRICS_TOKEN", "")
	open := httptest.NewRecorder()
	metricsHandler().ServeHTTP(open, httptest.NewRequest(http.MethodGet, metricsPath, nil))
	if open.Code != http.StatusOK {
		t.Fatalf("expected an unauthenticated scrape to succeed when no token is set, got %d", open.Code)
	}

	t.Setenv("METRICS_TOKEN", "s3cret")
	handler := metricsHandler()

	unauthorized := httptest.NewRecorder()
	handler.ServeHTTP(unauthorized, httptest.NewRequest(http.MethodGet, metricsPath, nil))
	if unauthorized.Code != http.StatusUnauthorized {
		t.Fatalf("expected 401 without a token, got %d", unauthorized.Code)
	}

	wrong := httptest.NewRecorder()
	wrongRequest := httptest.NewRequest(http.MethodGet, metricsPath, nil)
	wrongRequest.Header.Set("Authorization", "Bearer wrong")
	handler.ServeHTTP(wrong, wrongRequest)
	if wrong.Code != http.StatusUnauthorized {
		t.Fatalf("expected 401 with a wrong token, got %d", wrong.Code)
	}

	authorized := httptest.NewRecorder()
	authorizedRequest := httptest.NewRequest(http.MethodGet, metricsPath, nil)
	authorizedRequest.Header.Set("Authorization", "Bearer s3cret")
	handler.ServeHTTP(authorized, authorizedRequest)
	if authorized.Code != http.StatusOK {
		t.Fatalf("expected 200 with the configured token, got %d", authorized.Code)
	}
}
