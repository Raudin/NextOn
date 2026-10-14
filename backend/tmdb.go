package main

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net"
	"net/http"
	"sort"
	"strings"
	"sync"
	"time"

	"github.com/hashicorp/golang-lru/v2/expirable"
)

// tmdbTransport is a shared, explicitly tuned transport.
//
// The default transport keeps only two idle connections per host. Concurrency
// here is tmdbDetailConcurrency (10) plus whatever the background rating
// workers add, so under any real load the surplus connections were closed and
// re-opened constantly — paying a fresh TLS handshake on each one. Raising the
// per-host idle pool to match the concurrency cap means a connection is
// normally reused instead.
//
// ForceAttemptHTTP2 is set explicitly rather than left to the default, because
// a custom Transport with a non-nil DialContext disables HTTP/2 unless it is
// asked for.
var tmdbTransport = &http.Transport{
	Proxy: http.ProxyFromEnvironment,
	DialContext: (&net.Dialer{
		Timeout:   5 * time.Second,
		KeepAlive: 30 * time.Second,
	}).DialContext,
	ForceAttemptHTTP2:     true,
	MaxIdleConns:          64,
	MaxIdleConnsPerHost:   32,
	MaxConnsPerHost:       0,
	IdleConnTimeout:       90 * time.Second,
	TLSHandshakeTimeout:   5 * time.Second,
	ExpectContinueTimeout: 1 * time.Second,
}

// Shared TMDB HTTP client. Reusing a single client (and its pooled transport)
// avoids opening a fresh connection + TLS handshake per request.
var tmdbHTTPClient = &http.Client{
	Transport: tmdbTransport,
	Timeout:   8 * time.Second,
}

// tmdbCacheTTL is how long TMDB responses are kept in memory. Air/release
// dates are immutable and media metadata rarely changes, so a 30 minute window
// is safe while still bounding staleness for "upcoming" schedule data.
const tmdbCacheTTL = 30 * time.Minute

// Cache capacities, in entries. Bounded by count rather than by bytes: the
// previous implementation had to sum the size of every stored body to enforce a
// byte ceiling and, when it overflowed, threw the entire cache away — so one
// oversized response cost every other entry and the next requests all missed.
// An LRU evicts the least recently useful entry instead.
const (
	// tmdbCacheEntries covers media details, seasons, episodes, collections and
	// similar/recommendation lists.
	tmdbCacheEntries = 4096

	// tmdbSearchEntries is deliberately its own small cache. Search keys are
	// unique per keystroke, so letting them share the main cache let a burst of
	// typing evict the titles the app actually re-requests.
	tmdbSearchEntries = 256
)

// inflightCall coalesces concurrent requests for the same URL so only one
// network fetch happens; all other callers wait for its result.
type inflightCall struct {
	done chan struct{}
	data []byte
	err  error
}

// tmdbResponseCache is a bounded, TTL'd in-memory cache of TMDB GET responses
// keyed by the full request URL.
//
// The TTL is enforced by the expirable LRU itself, so an expired entry can
// never be returned and no sweep is needed. Search responses are routed to a
// separate, smaller cache; see tmdbSearchEntries.
type tmdbResponseCache struct {
	detail *expirable.LRU[string, []byte]
	search *expirable.LRU[string, []byte]

	// inflight guards coalescing only. It is the single mutex, so a cache read
	// no longer takes a lock that a concurrent fetch is holding.
	inflightMu sync.Mutex
	inflight   map[string]*inflightCall
}

var tmdbCache = &tmdbResponseCache{
	detail:   expirable.NewLRU[string, []byte](tmdbCacheEntries, nil, tmdbCacheTTL),
	search:   expirable.NewLRU[string, []byte](tmdbSearchEntries, nil, tmdbCacheTTL),
	inflight: make(map[string]*inflightCall),
}

// cacheFor routes a key to the cache that should hold it. Search responses are
// high-cardinality and low-reuse, so they get their own small cache rather than
// evicting detail responses other requests will want again.
func (c *tmdbResponseCache) cacheFor(key string) *expirable.LRU[string, []byte] {
	if strings.Contains(key, "/search/") {
		return c.search
	}
	return c.detail
}

func (c *tmdbResponseCache) get(key string) ([]byte, bool) {
	return c.cacheFor(key).Get(key)
}

func (c *tmdbResponseCache) set(key string, data []byte) {
	c.cacheFor(key).Add(key, data)
}

// getOrFetch returns the cached body for key or performs a single network
// fetch when missing/expired. Concurrent callers for the same key share the
// same in-flight fetch instead of each hitting TMDB.
//
// The second return value reports whether *this* call actually performed the
// outbound request. Callers that need to attribute fan-out to a request must
// only count a real fetch: a cache hit and a coalesced wait are both free, and
// counting them would overstate the backend's outbound load.
func (c *tmdbResponseCache) getOrFetch(key string, fetch func() ([]byte, error)) ([]byte, bool, error) {
	if data, ok := c.get(key); ok {
		metrics.recordTMDB(true)
		return data, false, nil
	}

	// Second tier. Redis survives deploys and is shared between replicas, so a
	// cold in-process cache after a restart does not mean re-fetching every
	// title from TMDB. A miss and an outage are the same thing here.
	sharedKey := redisKey("tmdb", key)
	if data, ok := redisGet(sharedKey); ok {
		metrics.recordTMDB(true)
		c.set(key, data)
		return data, false, nil
	}

	c.inflightMu.Lock()
	if call, ok := c.inflight[key]; ok {
		c.inflightMu.Unlock()
		<-call.done
		// Another caller already performed this fetch; we just read its result.
		metrics.recordTMDB(true)
		return call.data, false, call.err
	}
	call := &inflightCall{done: make(chan struct{})}
	c.inflight[key] = call
	c.inflightMu.Unlock()

	// Deferred, not sequential: this is a coalescing barrier, so every waiter
	// is parked on this channel. If fetch() panicked, the close was skipped and
	// those waiters blocked forever — a panic in one request turned into a
	// permanent hang for every other request for the same key. The deferred
	// close releases them as the panic unwinds, and gin's Recovery middleware
	// then fails only the request that panicked.
	defer close(call.done)
	call.data, call.err = fetch()

	c.inflightMu.Lock()
	delete(c.inflight, key)
	c.inflightMu.Unlock()

	if call.err == nil {
		c.set(key, call.data)
		redisSet(sharedKey, call.data, tmdbCacheTTL)
	}
	metrics.recordTMDB(false)
	return call.data, true, call.err
}

// firstScope picks the request scope out of an optional variadic argument.
// TMDB helpers accept `scopes ...*callScope` so existing call sites keep
// compiling unchanged while request-path callers can record fan-out.
func firstScope(scopes []*callScope) *callScope {
	for _, s := range scopes {
		if s != nil {
			return s
		}
	}
	return nil
}

func tmdbGet(baseURL, apiKey string, target interface{}, scopes ...*callScope) error {
	return tmdbGetWithParams(baseURL, apiKey, nil, target, scopes...)
}

func tmdbGetWithParams(baseURL, apiKey string, params map[string]string, target interface{}, scopes ...*callScope) error {
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

	data, fetched, err := tmdbCache.getOrFetch(cacheKey, func() ([]byte, error) {
		// Smooth bursts before opening the connection. A refusal here is
		// non-fatal by design: see tokenBucket.take.
		tmdbLimiter.take(context.Background(), outboundWaitMax)

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
	if fetched {
		firstScope(scopes).addTMDB()
	}
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

// topCast trims a credits list to the members the detail screen draws. The
// character name travels with the person so the client can label each cell with
// the role as well as the actor.
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
			Character:   member.Character,
		})
		if len(safe) == limit {
			break
		}
	}
	return safe
}

// topPosters returns up to limit poster variants for the detail hero, ranked by
// community score and limited to English/neutral artwork.
//
// TMDB already returns `images.posters` ordered by score, but the ranking is
// explicit here so that dropping the non-English entries cannot silently
// reshuffle the result.
func topPosters(posters []Image, limit int) []Image {
	candidates := make([]Image, 0, len(posters))
	for _, poster := range posters {
		if poster.FilePath == "" {
			continue
		}
		// The details request asks for `include_image_language=en,null`, so a
		// different code is artwork TMDB could not filter out.
		if poster.Iso6391 != "" && poster.Iso6391 != "en" {
			continue
		}
		candidates = append(candidates, poster)
	}
	if len(candidates) == 0 {
		return nil
	}

	sort.SliceStable(candidates, func(i, j int) bool {
		return candidates[i].VoteAverage > candidates[j].VoteAverage
	})

	if len(candidates) > limit {
		candidates = candidates[:limit]
	}
	return candidates
}

// Certification regions, in preference order.
//
// The rest of the app renders English-language metadata — the details request
// even pins `include_image_language=en,null` — so the US rating is the one this
// audience expects. The remaining entries exist because plenty of titles,
// especially non-US productions, carry no US certification at all, and a UK or
// Canadian rating is far more useful to show than none.
var certificationRegionOrder = []string{"US", "GB", "CA", "AU"}

// Movie release types in preference order: a theatrical rating is the
// consumer-facing one, and TMDB often carries several entries per country
// (premiere, limited, theatrical, digital, physical, TV).
var certificationReleaseTypeOrder = []int{3, 2, 4}

// extractCertification resolves a title's age rating.
//
// TMDB has no per-title certification endpoint — `/certification/movie/list`
// only enumerates the possible values. Movies carry their rating on
// `/movie/{id}/release_dates` and TV on `/tv/{id}/content_ratings`, both of
// which are appended to the details request, so this costs no extra call.
func extractCertification(mediaType string, response tmdbMediaDetailsResponse) string {
	if mediaType == "tv" {
		return pickContentRating(response.ContentRatings.Results)
	}
	return pickReleaseCertification(response.ReleaseDates.Results)
}

// pickContentRating picks one country's TV rating, falling back to the first
// usable one so a regional production still gets a badge.
func pickContentRating(ratings []tmdbContentRating) string {
	for _, region := range certificationRegionOrder {
		for _, entry := range ratings {
			if entry.Iso3166_1 == region && entry.Rating != "" {
				return entry.Rating
			}
		}
	}
	for _, entry := range ratings {
		if entry.Rating != "" {
			return entry.Rating
		}
	}
	return ""
}

func pickReleaseCertification(regions []tmdbReleaseDatesResult) string {
	for _, region := range certificationRegionOrder {
		if rating := certificationForRegion(regions, region); rating != "" {
			return rating
		}
	}
	for _, entry := range regions {
		if rating := bestCertificationInRegion(entry.ReleaseDates); rating != "" {
			return rating
		}
	}
	return ""
}

func certificationForRegion(regions []tmdbReleaseDatesResult, country string) string {
	for _, entry := range regions {
		if entry.Iso3166_1 == country {
			return bestCertificationInRegion(entry.ReleaseDates)
		}
	}
	return ""
}

// bestCertificationInRegion prefers a theatrical rating, then limited
// theatrical, then digital, then anything non-empty. The order matters because
// unrated entries are common: premieres and festival releases usually carry an
// empty certification, and the US entry for a film can list a dozen of them.
func bestCertificationInRegion(dates []tmdbReleaseDateInfo) string {
	for _, wantType := range certificationReleaseTypeOrder {
		for _, date := range dates {
			if date.Type == wantType && date.Certification != "" {
				return date.Certification
			}
		}
	}
	for _, date := range dates {
		if date.Certification != "" {
			return date.Certification
		}
	}
	return ""
}

// relatedMedia prepares a TMDB list — recommendations, similar titles or a
// franchise's films — for the client's list cards.
//
// Three transformations the client would otherwise have to repeat: the title
// being viewed is dropped (TMDB's similar lists often include sequels of it),
// entries with no artwork are dropped because every card draws a poster, and
// the media type is forced from the parent when TMDB omits it, which
// `/similar` and `/collection` responses both do.
func relatedMedia(items []TMDBMedia, mediaType string, excludeID int64, limit int) []TMDBMedia {
	out := make([]TMDBMedia, 0, limit)
	for _, item := range items {
		if item.ID == 0 || item.ID == excludeID {
			continue
		}
		if item.PosterPath == "" && item.BackdropPath == "" {
			continue
		}
		item.MediaType = mediaType
		out = append(out, item)
		if len(out) == limit {
			break
		}
	}
	if len(out) == 0 {
		return nil
	}
	return out
}

// trimCollectionParts normalises a franchise's films for the collection row:
// oldest first (TMDB's order is not guaranteed), undated entries last, and
// artwork-less entries dropped. A nil result means the caller should treat the
// collection as empty rather than rendering a row with no cards in it.
func trimCollectionParts(parts []TMDBMedia, limit int) []TMDBMedia {
	sorted := make([]TMDBMedia, 0, len(parts))
	for _, part := range parts {
		if part.ID == 0 || (part.PosterPath == "" && part.BackdropPath == "") {
			continue
		}
		part.MediaType = "movie"
		sorted = append(sorted, part)
	}

	dateKey := func(item TMDBMedia) string {
		if item.ReleaseDate == "" {
			return "9999-99-99"
		}
		return item.ReleaseDate
	}
	sort.SliceStable(sorted, func(i, j int) bool {
		return dateKey(sorted[i]) < dateKey(sorted[j])
	})

	if len(sorted) > limit {
		sorted = sorted[:limit]
	}
	if len(sorted) == 0 {
		return nil
	}
	return sorted
}
