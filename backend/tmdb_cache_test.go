package main

import (
	"fmt"
	"sync"
	"sync/atomic"
	"testing"
	"time"

	"github.com/hashicorp/golang-lru/v2/expirable"
)

// newTestCache builds a small expirable cache with the production TTL, so the
// tests exercise the same type the handler path uses.
func newTestCache(size int) *expirable.LRU[string, []byte] {
	return expirable.NewLRU[string, []byte](size, nil, tmdbCacheTTL)
}

// The TMDB response cache is the difference between one outbound call and one
// per request, and its two subtleties — search keys must not evict detail
// entries, and concurrent callers must share a single fetch — are invisible
// from the handlers.

func TestTMDBResponseCacheServesRepeatHits(t *testing.T) {
	c := &tmdbResponseCache{
		detail:   newTestCache(8),
		search:   newTestCache(4),
		inflight: make(map[string]*inflightCall),
	}

	var fetches int32
	fetch := func() ([]byte, error) {
		atomic.AddInt32(&fetches, 1)
		return []byte(`{"ok":true}`), nil
	}

	key := "https://api.themoviedb.org/3/movie/1"

	data, fetched, err := c.getOrFetch(key, fetch)
	if err != nil {
		t.Fatalf("first fetch failed: %v", err)
	}
	if !fetched {
		t.Fatal("the first call must have performed the fetch")
	}
	if string(data) != `{"ok":true}` {
		t.Fatalf("unexpected body: %s", data)
	}

	_, fetched, err = c.getOrFetch(key, fetch)
	if err != nil {
		t.Fatalf("second fetch failed: %v", err)
	}
	if fetched {
		t.Fatal("a cache hit must not report an outbound fetch")
	}
	if got := atomic.LoadInt32(&fetches); got != 1 {
		t.Fatalf("expected exactly 1 outbound fetch, got %d", got)
	}
}

func TestTMDBResponseCacheRoutesSearchSeparately(t *testing.T) {
	c := &tmdbResponseCache{
		detail:   newTestCache(2),
		search:   newTestCache(2),
		inflight: make(map[string]*inflightCall),
	}

	// Fill the detail cache to its cap.
	for i := 0; i < 2; i++ {
		c.set(fmt.Sprintf("https://api.themoviedb.org/3/movie/%d", i), []byte("detail"))
	}

	// A burst of distinct search queries — one per keystroke — must not evict
	// the detail entries, which is what a shared cache would do.
	for i := 0; i < 20; i++ {
		c.set(fmt.Sprintf("https://api.themoviedb.org/3/search/multi?query=q%d", i), []byte("search"))
	}

	if _, ok := c.get("https://api.themoviedb.org/3/movie/0"); !ok {
		t.Fatal("search traffic evicted a detail entry; the two caches must be separate")
	}

	if _, ok := c.get("https://api.themoviedb.org/3/movie/1"); !ok {
		t.Fatal("search traffic evicted a detail entry; the two caches must be separate")
	}
}

func TestTMDBResponseCacheEvictsLeastRecentlyUsed(t *testing.T) {
	c := &tmdbResponseCache{
		detail:   newTestCache(2),
		search:   newTestCache(2),
		inflight: make(map[string]*inflightCall),
	}

	c.set("a", []byte("1"))
	c.set("b", []byte("2"))

	// Touch "a" so "b" becomes the least recently used.
	if _, ok := c.get("a"); !ok {
		t.Fatal("expected a to be present")
	}

	c.set("c", []byte("3"))

	if _, ok := c.get("b"); ok {
		t.Fatal("the least recently used entry must be evicted, not the whole cache")
	}
	if _, ok := c.get("a"); !ok {
		t.Fatal("a recently read entry must survive an insert")
	}
	if _, ok := c.get("c"); !ok {
		t.Fatal("the newly inserted entry must be present")
	}
}

func TestTMDBResponseCacheCoalescesConcurrentFetches(t *testing.T) {
	c := &tmdbResponseCache{
		detail:   newTestCache(8),
		search:   newTestCache(4),
		inflight: make(map[string]*inflightCall),
	}

	var fetches int32
	release := make(chan struct{})

	fetch := func() ([]byte, error) {
		atomic.AddInt32(&fetches, 1)
		// Hold the fetch open so every other caller is guaranteed to arrive
		// while it is in flight.
		<-release
		return []byte("shared"), nil
	}

	const callers = 8
	var wg sync.WaitGroup
	results := make([][]byte, callers)
	errs := make([]error, callers)

	for i := 0; i < callers; i++ {
		wg.Add(1)
		go func(idx int) {
			defer wg.Done()
			results[idx], _, errs[idx] = c.getOrFetch("same-key", fetch)
		}(i)
	}

	// Give the goroutines a chance to all register on the in-flight call.
	time.Sleep(50 * time.Millisecond)
	close(release)
	wg.Wait()

	if got := atomic.LoadInt32(&fetches); got != 1 {
		t.Fatalf("concurrent callers must share one fetch, got %d", got)
	}
	for i := range results {
		if errs[i] != nil {
			t.Fatalf("caller %d failed: %v", i, errs[i])
		}
		if string(results[i]) != "shared" {
			t.Fatalf("caller %d got %q", i, results[i])
		}
	}
}

// A panic inside fetch must not leave the other waiters blocked forever.
func TestTMDBResponseCacheReleasesWaitersOnPanic(t *testing.T) {
	c := &tmdbResponseCache{
		detail:   newTestCache(8),
		search:   newTestCache(4),
		inflight: make(map[string]*inflightCall),
	}

	started := make(chan struct{})
	panicFetch := func() ([]byte, error) {
		close(started)
		panic("simulated upstream panic")
	}

	// The panicking caller runs on its own goroutine; recover there so the test
	// can observe the waiters being released.
	panicked := make(chan struct{})
	go func() {
		defer func() {
			_ = recover()
			close(panicked)
		}()
		_, _, _ = c.getOrFetch("panic-key", panicFetch)
	}()

	<-started

	waiterDone := make(chan struct{})
	go func() {
		defer close(waiterDone)
		_, _, _ = c.getOrFetch("panic-key", func() ([]byte, error) {
			t.Error("the waiter must not perform its own fetch")
			return nil, nil
		})
	}()

	select {
	case <-waiterDone:
	case <-time.After(2 * time.Second):
		t.Fatal("a waiter blocked forever after a panic in the shared fetch")
	}
}
