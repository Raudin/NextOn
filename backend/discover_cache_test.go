package main

import (
	"sync"
	"testing"
	"time"
)

// The Discover rebuild barrier. The handler it replaces held a write lock
// across three network calls, serialising the app's first screen behind one
// fetch; this asserts the replacement still collapses a cold-cache stampede
// into a single rebuild and never leaves a waiter blocked.

func TestDiscoverCacheStoresAndServesPayload(t *testing.T) {
	c := &discoverPayloadCache{
		duration: time.Minute,
		inflight: &discoverInflight{},
	}

	if _, ok := c.freshPayload(); ok {
		t.Fatal("an empty cache must not report a hit")
	}

	c.store([]byte(`{"trending":[]}`))

	payload, ok := c.freshPayload()
	if !ok {
		t.Fatal("a stored payload must be served")
	}
	if string(payload) != `{"trending":[]}` {
		t.Fatalf("unexpected payload: %s", payload)
	}
}

func TestDiscoverCacheExpires(t *testing.T) {
	c := &discoverPayloadCache{
		duration: time.Minute,
		inflight: &discoverInflight{},
	}

	c.store([]byte("payload"))
	// Force expiry rather than sleeping.
	c.mu.Lock()
	c.expiresAt = time.Now().Add(-time.Second)
	c.mu.Unlock()

	if _, ok := c.freshPayload(); ok {
		t.Fatal("an expired payload must not be served")
	}
}

func TestDiscoverRebuildCoalescesConcurrentCallers(t *testing.T) {
	c := &discoverPayloadCache{
		duration: time.Minute,
		inflight: &discoverInflight{},
	}

	// First caller becomes the leader.
	leaderCall, isLeader := c.beginRebuild()
	if !isLeader {
		t.Fatal("the first caller must become the leader")
	}

	// Everyone else is told to wait on the leader.
	const followers = 8
	var wg sync.WaitGroup
	results := make([][]byte, followers)

	for i := 0; i < followers; i++ {
		wg.Add(1)
		go func(idx int) {
			defer wg.Done()
			call, leader := c.beginRebuild()
			if leader {
				t.Errorf("follower %d must not become a second leader", idx)
				return
			}
			<-call.done
			results[idx] = call.payload
		}(i)
	}

	// Give the followers time to park on the barrier.
	time.Sleep(50 * time.Millisecond)

	// The leader publishes; every waiter must observe the payload.
	c.finishRebuild(leaderCall, []byte(`{"ok":true}`))
	wg.Wait()

	for i, result := range results {
		if string(result) != `{"ok":true}` {
			t.Fatalf("follower %d got %q, want the leader's payload", i, result)
		}
	}

	// The barrier is released, so the next caller can rebuild again.
	if _, leader := c.beginRebuild(); !leader {
		t.Fatal("the barrier must be reusable after a rebuild completes")
	}
}

// A failed rebuild must release the waiters with no payload, so they can try for
// themselves rather than blocking forever or serving nothing.
func TestDiscoverRebuildReleasesWaitersOnFailure(t *testing.T) {
	c := &discoverPayloadCache{
		duration: time.Minute,
		inflight: &discoverInflight{},
	}

	leaderCall, isLeader := c.beginRebuild()
	if !isLeader {
		t.Fatal("expected to become the leader")
	}

	waiterDone := make(chan []byte, 1)
	go func() {
		call, leader := c.beginRebuild()
		if leader {
			t.Error("the waiter must not become a leader while one is active")
			waiterDone <- nil
			return
		}
		<-call.done
		waiterDone <- call.payload
	}()

	time.Sleep(50 * time.Millisecond)

	// Publish nothing: the rebuild failed.
	c.finishRebuild(leaderCall, nil)

	select {
	case payload := <-waiterDone:
		if len(payload) != 0 {
			t.Fatalf("expected no payload from a failed rebuild, got %q", payload)
		}
	case <-time.After(2 * time.Second):
		t.Fatal("a waiter blocked forever when the rebuild produced nothing")
	}

	// A failed rebuild must not poison the barrier.
	if _, leader := c.beginRebuild(); !leader {
		t.Fatal("the barrier must be reusable after a failed rebuild")
	}
}

// A successful rebuild must be visible to the cache itself, not just to the
// waiters on the current barrier.
func TestDiscoverRebuildPublishesToCache(t *testing.T) {
	c := &discoverPayloadCache{
		duration: time.Minute,
		inflight: &discoverInflight{},
	}

	call, _ := c.beginRebuild()
	c.finishRebuild(call, []byte("fresh"))

	if payload, ok := c.freshPayload(); !ok || string(payload) != "fresh" {
		t.Fatalf("a completed rebuild must populate the cache, got %q (ok=%v)", payload, ok)
	}
}
