package main

import (
	"encoding/json"
	"log"
	"net/http"
	"strconv"
	"time"

	"github.com/gin-gonic/gin"
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

// cachedJSONResponse serves a JSON payload from Redis when possible, otherwise
// builds it, stores it, and serves it.
//
// Invariants:
//   - Redis being unavailable means "always miss", never an error.
//   - A payload that fails to build is not cached and the error is surfaced by
//     the caller's build function writing its own response.
//   - Only successful (200) payloads are cached.
func cachedJSONResponse(c *gin.Context, key string, ttl time.Duration, build func() (any, bool)) {
	if payload, ok := redisGet(key); ok {
		c.Data(http.StatusOK, "application/json; charset=utf-8", payload)
		return
	}

	result, ok := build()
	if !ok {
		// build() already wrote an error response.
		return
	}

	payload, err := json.Marshal(result)
	if err != nil {
		log.Printf("Cache: failed to marshal payload for %s: %v", key, err)
		c.JSON(http.StatusOK, result)
		return
	}

	redisSet(key, payload, ttl)
	c.Data(http.StatusOK, "application/json; charset=utf-8", payload)
}

// homeScheduleCacheKey scopes the cached schedule to a user and their current
// sync version, so any mutation retires the entry without a scan.
func homeScheduleCacheKey(userID uint) string {
	return redisNamedKey(
		"home",
		strconv.FormatUint(uint64(userID), 10),
		strconv.FormatUint(currentUserVersion(userID), 10),
	)
}

// watchlistCacheKey scopes the cached watchlist the same way, and includes the
// query variants so `filter_watched` and `include=progress` cannot collide.
func watchlistCacheKey(userID uint, filterWatched, includeProgress bool) string {
	return redisNamedKey(
		"watchlist",
		strconv.FormatUint(uint64(userID), 10),
		strconv.FormatUint(currentUserVersion(userID), 10),
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
