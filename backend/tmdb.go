package main

import (
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"strings"
	"sync"
	"time"
)

var discoverCache *Cache

func initCache() {
	discoverCache = &Cache{
		duration: 10 * time.Minute,
	}
}

// Shared TMDB HTTP client. Reusing a single client (with its default pooled
// transport) avoids opening a fresh connection + TLS handshake per request.
var tmdbHTTPClient = &http.Client{
	Timeout: 8 * time.Second,
}

// tmdbCacheTTL is how long TMDB responses are kept in memory. Air/release
// dates are immutable and media metadata rarely changes, so a 30 minute window
// is safe while still bounding staleness for "upcoming" schedule data.
const tmdbCacheTTL = 30 * time.Minute

// tmdbCacheEntry stores a raw TMDB response body and its expiry time.
type tmdbCacheEntry struct {
	data      []byte
	expiresAt time.Time
}

// inflightCall coalesces concurrent requests for the same URL so only one
// network fetch happens; all other callers wait for its result.
type inflightCall struct {
	done chan struct{}
	data []byte
	err  error
}

// tmdbResponseCache is a bounded, in-memory TTL cache of TMDB GET responses
// keyed by the full request URL.
type tmdbResponseCache struct {
	mu         sync.Mutex
	entries    map[string]*tmdbCacheEntry
	inflight   map[string]*inflightCall
	maxBytes   int64
	totalBytes int64
}

var tmdbCache = &tmdbResponseCache{
	entries:    make(map[string]*tmdbCacheEntry),
	inflight:   make(map[string]*inflightCall),
	maxBytes:   128 << 20, // ~128 MB ceiling for cached TMDB response bodies
	totalBytes: 0,
}

func (c *tmdbResponseCache) get(key string) ([]byte, bool) {
	c.mu.Lock()
	defer c.mu.Unlock()

	e, ok := c.entries[key]
	if !ok {
		return nil, false
	}
	if time.Now().After(e.expiresAt) {
		c.totalBytes -= int64(len(e.data))
		delete(c.entries, key)
		return nil, false
	}
	return e.data, true
}

func (c *tmdbResponseCache) set(key string, data []byte) {
	if int64(len(data)) > c.maxBytes {
		return
	}

	c.mu.Lock()
	defer c.mu.Unlock()

	now := time.Now()

	// Opportunistically evict expired entries.
	for k, e := range c.entries {
		if now.After(e.expiresAt) {
			c.totalBytes -= int64(len(e.data))
			delete(c.entries, k)
		}
	}

	// Keep the cache bounded: reset it if the new entry would overflow the cap.
	if c.totalBytes+int64(len(data)) > c.maxBytes {
		c.entries = make(map[string]*tmdbCacheEntry)
		c.totalBytes = 0
	}

	if old, ok := c.entries[key]; ok {
		c.totalBytes -= int64(len(old.data))
	}
	c.entries[key] = &tmdbCacheEntry{
		data:      data,
		expiresAt: now.Add(tmdbCacheTTL),
	}
	c.totalBytes += int64(len(data))
}

// getOrFetch returns the cached body for key or performs a single network
// fetch when missing/expired. Concurrent callers for the same key share the
// same in-flight fetch instead of each hitting TMDB.
func (c *tmdbResponseCache) getOrFetch(key string, fetch func() ([]byte, error)) ([]byte, error) {
	if data, ok := c.get(key); ok {
		return data, nil
	}

	c.mu.Lock()
	if call, ok := c.inflight[key]; ok {
		c.mu.Unlock()
		<-call.done
		return call.data, call.err
	}
	call := &inflightCall{done: make(chan struct{})}
	c.inflight[key] = call
	c.mu.Unlock()

	call.data, call.err = fetch()
	close(call.done)

	c.mu.Lock()
	delete(c.inflight, key)
	c.mu.Unlock()

	if call.err == nil {
		c.set(key, call.data)
	}
	return call.data, call.err
}

func tmdbGet(baseURL, apiKey string, target interface{}) error {
	return tmdbGetWithParams(baseURL, apiKey, nil, target)
}

func tmdbGetWithParams(baseURL, apiKey string, params map[string]string, target interface{}) error {
	req, err := http.NewRequest("GET", baseURL, nil)
	if err != nil {
		return err
	}

	q := req.URL.Query()
	for key, value := range params {
		q.Set(key, value)
	}

	// Check if apiKey is a long v4 JWT token or standard v3 hex key
	if len(apiKey) > 50 {
		req.Header.Set("Authorization", "Bearer "+apiKey)
		req.Header.Set("accept", "application/json")
	} else {
		q.Set("api_key", apiKey)
	}
	req.URL.RawQuery = q.Encode()

	// Cache key is the fully-qualified URL. For v3 keys the api_key is already
	// part of the query string; for v4 keys the bearer token is constant for the
	// process lifetime, so the URL alone is a safe key.
	cacheKey := req.URL.String()

	data, err := tmdbCache.getOrFetch(cacheKey, func() ([]byte, error) {
		resp, err := tmdbHTTPClient.Do(req)
		if err != nil {
			return nil, err
		}
		defer resp.Body.Close()

		if resp.StatusCode != http.StatusOK {
			return nil, fmt.Errorf("TMDB API returned status code %d", resp.StatusCode)
		}

		return io.ReadAll(resp.Body)
	})
	if err != nil {
		return err
	}

	return json.Unmarshal(data, target)
}

func parseID(value string) (int64, error) {
	var id int64
	_, err := fmt.Sscan(value, &id)
	return id, err
}

func displayTitle(item TMDBMedia) string {
	if item.Title != "" {
		return strings.ToLower(item.Title)
	}
	return strings.ToLower(item.Name)
}

func filterMockMedia(_ string) []TMDBMedia {
	return []TMDBMedia{}
}

func topCast(cast []CastMember, limit int) []CastMember {
	if len(cast) < limit {
		limit = len(cast)
	}
	safe := make([]CastMember, 0, limit)
	for _, member := range cast {
		if member.Name == "" {
			continue
		}
		safe = append(safe, CastMember{
			ID:          member.ID,
			Name:        member.Name,
			ProfilePath: member.ProfilePath,
		})
		if len(safe) == limit {
			break
		}
	}
	return safe
}
