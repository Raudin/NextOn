package main

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync"
	"sync/atomic"
	"testing"
	"time"

	"github.com/gin-gonic/gin"
)

// isolateResponseCache detaches the process-global response cache for one test.
//
// The tier outlives the request that filled it and is keyed by (endpoint, user,
// version), so without this every test would be sharing user 1 at the initial
// version. Warming is switched off for the same reason: it rebuilds against the
// package-level database handle, which a test replaces and closes.
func isolateResponseCache(t *testing.T) {
	t.Helper()

	previousWarm := cacheWarmDisabled.Load()
	cacheWarmDisabled.Store(true)
	responseCache.purge()

	t.Cleanup(func() {
		responseCache.purge()
		cacheWarmDisabled.Store(previousWarm)
	})
}

// inflightCount reports how many coalesced builds are currently registered.
func (rc *responsePayloadCache) inflightCount() int {
	rc.inflightMu.Lock()
	defer rc.inflightMu.Unlock()
	return len(rc.inflight)
}

// newTestGinContext builds the request context cachedJSONResponse writes into.
func newTestGinContext(method, target string) (*gin.Context, *httptest.ResponseRecorder) {
	recorder := httptest.NewRecorder()
	c, _ := gin.CreateTestContext(recorder)
	c.Request = httptest.NewRequest(method, target, nil)
	return c, recorder
}

func TestCachedJSONResponseServesRepeatFromLocalTier(t *testing.T) {
	isolateResponseCache(t)

	builds := 0
	build := func() (any, bool) {
		builds++
		return gin.H{"ok": true}, true
	}

	first, firstRecorder := newTestGinContext(http.MethodGet, "/api/home/schedule")
	cachedJSONResponse(first, "test:home:1:1", time.Minute, build)

	second, secondRecorder := newTestGinContext(http.MethodGet, "/api/home/schedule")
	cachedJSONResponse(second, "test:home:1:1", time.Minute, build)

	if builds != 1 {
		t.Fatalf("build ran %d times, want 1: the in-process tier should serve the repeat", builds)
	}
	if firstRecorder.Code != http.StatusOK || secondRecorder.Code != http.StatusOK {
		t.Fatalf("statuses = %d, %d, want 200, 200", firstRecorder.Code, secondRecorder.Code)
	}
	if firstRecorder.Body.String() != secondRecorder.Body.String() {
		t.Fatalf("bodies differ: %q vs %q", firstRecorder.Body.String(), secondRecorder.Body.String())
	}

	var decoded map[string]any
	if err := json.Unmarshal(secondRecorder.Body.Bytes(), &decoded); err != nil {
		t.Fatalf("cached payload is not valid JSON: %v", err)
	}
	if decoded["ok"] != true {
		t.Fatalf("cached payload = %v, want the value the build produced", decoded)
	}
}

// A leader can finish its build and fail between a waiter's tier miss and its
// join. The waiter must then build for itself: relaying the leader's failure as
// an empty response would hand the client a 200 with no body.
func TestCachedJSONResponseBuildsWhenCoalescedCallFailed(t *testing.T) {
	isolateResponseCache(t)

	const key = "test:home:1:1"

	call, leader := responseCache.startCall(key)
	if !leader {
		t.Fatal("startCall did not register a fresh call")
	}
	call.built = false
	close(call.done)
	t.Cleanup(func() { responseCache.endCall(key, call) })

	builds := 0
	c, recorder := newTestGinContext(http.MethodGet, "/api/home/schedule")
	cachedJSONResponse(c, key, time.Minute, func() (any, bool) {
		builds++
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to fetch watchlist"})
		return nil, false
	})

	if builds != 1 {
		t.Fatalf("build ran %d times, want 1: a failed coalesced build must not be relayed as success", builds)
	}
	if recorder.Code != http.StatusInternalServerError {
		t.Fatalf("status = %d, want 500", recorder.Code)
	}
	if !strings.Contains(recorder.Body.String(), "error") {
		t.Fatalf("body = %q, want an error payload", recorder.Body.String())
	}
}

func TestCachedJSONResponseCoalescesConcurrentBuilds(t *testing.T) {
	isolateResponseCache(t)

	const (
		key     = "test:watchlist:1:1"
		callers = 8
	)

	leaderStarted := make(chan struct{})
	release := make(chan struct{})
	var builds atomic.Int64
	var signalOnce sync.Once

	build := func() (any, bool) {
		builds.Add(1)
		signalOnce.Do(func() { close(leaderStarted) })
		<-release
		return gin.H{"ok": true}, true
	}

	recorders := make([]*httptest.ResponseRecorder, callers)
	var wg sync.WaitGroup
	for i := 0; i < callers; i++ {
		wg.Add(1)
		go func(i int) {
			defer wg.Done()
			c, recorder := newTestGinContext(http.MethodGet, "/api/watchlist")
			recorders[i] = recorder
			cachedJSONResponse(c, key, time.Minute, build)
		}(i)
	}

	<-leaderStarted
	// The others can only reach the wait that way: the tier is empty until the
	// leader publishes, so a short pause lets them join the call.
	time.Sleep(100 * time.Millisecond)
	close(release)
	wg.Wait()

	if got := builds.Load(); got != 1 {
		t.Fatalf("build ran %d times, want 1: concurrent callers must share one build", got)
	}
	for i, recorder := range recorders {
		if recorder.Code != http.StatusOK {
			t.Fatalf("caller %d status = %d, want 200", i, recorder.Code)
		}
		if body := strings.TrimSpace(recorder.Body.String()); body != `{"ok":true}` {
			t.Fatalf("caller %d body = %q, want the leader's payload", i, body)
		}
	}
}

// A panicking build must still release the call, or every later request for
// that key parks on a channel nobody will ever close.
func TestCachedJSONResponseReleasesCallAfterPanic(t *testing.T) {
	isolateResponseCache(t)

	const key = "test:home:1:1"

	func() {
		defer func() {
			if r := recover(); r == nil {
				t.Fatal("the build panic should propagate to the caller")
			}
		}()
		c, _ := newTestGinContext(http.MethodGet, "/api/home/schedule")
		cachedJSONResponse(c, key, time.Minute, func() (any, bool) {
			panic("boom")
		})
	}()

	if got := responseCache.inflightCount(); got != 0 {
		t.Fatalf("inflight registrations = %d after a panicking build, want 0", got)
	}

	c, recorder := newTestGinContext(http.MethodGet, "/api/home/schedule")
	cachedJSONResponse(c, key, time.Minute, func() (any, bool) {
		return gin.H{"ok": true}, true
	})
	if recorder.Code != http.StatusOK {
		t.Fatalf("status after a panicking build = %d, want 200", recorder.Code)
	}
}

// The tier has to expire on its own: a payload that outlives its TTL is a
// payload served past the window etag.go promises clients.
func TestNewResponseCacheExpiresEntries(t *testing.T) {
	cache := newResponseCache(8, 50*time.Millisecond)
	cache.entries.Add("k", []byte("v"))

	if _, ok := cache.entries.Get("k"); !ok {
		t.Fatal("entry missing immediately after Add")
	}

	// expirable sweeps one bucket per ttl/numBuckets tick, so poll instead of
	// sleeping for a fixed duration.
	deadline := time.Now().Add(3 * time.Second)
	for time.Now().Before(deadline) {
		if _, ok := cache.entries.Get("k"); !ok {
			return
		}
		time.Sleep(10 * time.Millisecond)
	}
	t.Fatal("entry never expired")
}
