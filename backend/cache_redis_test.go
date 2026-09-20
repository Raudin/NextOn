package main

import (
	"testing"
	"time"
)

// The single most important property of the Redis layer is that it can never
// fail a request. These tests run with REDIS_URL unset (the default in tests),
// which is exactly the "Redis is not there" case that must stay harmless.

func TestRedisDisabledByDefault(t *testing.T) {
	if redisEnabled() {
		t.Fatal("Redis must be disabled when REDIS_URL is unset")
	}
}

func TestRedisHelpersAreSafeWhenDisabled(t *testing.T) {
	// None of these may panic or block. A miss/false return is the contract.
	if _, ok := redisGet("nexton:test:missing"); ok {
		t.Fatal("redisGet must report a miss when Redis is disabled")
	}

	// Must not panic.
	redisSet("nexton:test:key", []byte("value"), time.Minute)
	redisDelete("nexton:test:key")
	closeRedis()
}

func TestUserCacheVersionDefaultsToOneWhenDisabled(t *testing.T) {
	// The per-user version lives in the database, not Redis, so it is available
	// regardless of whether Redis is configured. A user with no state row yet
	// must read as version 1, matching the first increment.
	initTestDB(t)
	if got := currentUserVersion(999999); got != 1 {
		t.Fatalf("expected version 1 for an unknown user, got %d", got)
	}
}

func TestRedisKeyIsDeterministicAndNamespaced(t *testing.T) {
	a := redisKey("tmdb", "https://api.themoviedb.org/3/tv/1396")
	b := redisKey("tmdb", "https://api.themoviedb.org/3/tv/1396")
	c := redisKey("tmdb", "https://api.themoviedb.org/3/tv/1397")

	if a != b {
		t.Fatal("the same inputs must produce the same key")
	}
	if a == c {
		t.Fatal("different inputs must produce different keys")
	}
	if len(a) == 0 || a[:len(redisKeyPrefix)] != redisKeyPrefix {
		t.Fatalf("keys must be namespaced with %q, got %q", redisKeyPrefix, a)
	}
}

func TestRedisKeySeparatesParts(t *testing.T) {
	// Joining with a separator prevents ("ab","c") colliding with ("a","bc").
	if redisKey("ab", "c") == redisKey("a", "bc") {
		t.Fatal("distinct part boundaries must not collide")
	}
}

func TestNamedKeyIsHumanReadable(t *testing.T) {
	got := redisNamedKey("userver", "42")
	want := redisKeyPrefix + "userver:42"
	if got != want {
		t.Fatalf("expected %q, got %q", want, got)
	}
}

func TestBoolFlag(t *testing.T) {
	if boolFlag(true) == boolFlag(false) {
		t.Fatal("cache-key flags must differ between true and false")
	}
}

func TestUserCacheVersionChangesKey(t *testing.T) {
	// The per-user keys embed the database-backed sync version, so the DB must
	// be available even though Redis is not.
	initTestDB(t)

	key := watchlistCacheKey(7, true, true)
	if key == watchlistCacheKey(7, true, false) {
		t.Fatal("the include=progress variant must not share a key")
	}
	if key == watchlistCacheKey(7, false, true) {
		t.Fatal("the filter_watched variant must not share a key")
	}
	if key == watchlistCacheKey(8, true, true) {
		t.Fatal("different users must not share a key")
	}
	if homeScheduleCacheKey(7) == watchlistCacheKey(7, true, true) {
		t.Fatal("the schedule and the watchlist must not share a key")
	}
}
