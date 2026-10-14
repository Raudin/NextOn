package main

import (
	"encoding/json"
	"fmt"
	"log"
	"net/http"
	"os"
	"strings"
	"sync"
	"time"

	"github.com/gin-gonic/gin"
)

func handleSearch(c *gin.Context) {
	query := strings.TrimSpace(c.Query("q"))
	if query == "" {
		c.JSON(http.StatusOK, []TMDBMedia{})
		return
	}

	apiKey := os.Getenv("TMDB_API_KEY")
	scope := scopeFrom(c)

	searchURL := "https://api.themoviedb.org/3/search/multi"
	var response TMDBResponse
	if err := tmdbGetWithParams(searchURL, apiKey, map[string]string{
		"query":         query,
		"include_adult": "false",
	}, &response, scope); err != nil {
		log.Printf("Error searching TMDB: %v", err)
		c.JSON(http.StatusBadGateway, gin.H{"error": "Failed to search media"})
		return
	}

	results := make([]TMDBMedia, 0, len(response.Results))
	for _, item := range response.Results {
		if item.MediaType != "movie" && item.MediaType != "tv" {
			continue
		}
		results = append(results, item)
	}
	enrichMediaRatings(results, scope)

	c.JSON(http.StatusOK, results)
}

func handleMediaDetails(c *gin.Context) {
	mediaType := c.Param("type")
	if mediaType != "movie" && mediaType != "tv" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Media type must be movie or tv"})
		return
	}
	fetchAndSendMediaDetails(c, mediaType)
}

func handleMovieDetails(c *gin.Context) {
	fetchAndSendMediaDetails(c, "movie")
}

func handleTvDetails(c *gin.Context) {
	fetchAndSendMediaDetails(c, "tv")
}

func fetchAndSendMediaDetails(c *gin.Context, mediaType string) {
	id, err := parseID(c.Param("id"))
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Invalid media id"})
		return
	}

	apiKey := os.Getenv("TMDB_API_KEY")
	scope := scopeFrom(c)
	var details *MediaDetails

	// servedFallback marks a response built from placeholder data. Such a
	// response must not be stored by any shared cache: these routes carry a
	// public caching policy, so without this a CDN could keep serving fake
	// titles as if they were TMDB's for the whole max-age window, long after
	// TMDB recovered.
	servedFallback := false

	if apiKey == "dummy" {
		var ok bool
		details, ok = getMockMediaDetails(mediaType, id)
		if !ok {
			details = getFallbackMediaDetails(mediaType, id)
		}
	} else {
		detailsURL := fmt.Sprintf("https://api.themoviedb.org/3/%s/%d", mediaType, id)
		// `append_to_response` only appends resources from the same namespace,
		// and the certification resource differs by media type: movies carry
		// theirs on `release_dates`, TV on `content_ratings`. Appending the
		// wrong one is silently ignored by TMDB rather than an error, so this
		// split is a correctness choice, not error avoidance.
		appendTo := "credits,images,videos,external_ids,recommendations,release_dates"
		if mediaType == "tv" {
			appendTo = "credits,images,videos,external_ids,recommendations,content_ratings"
		}
		var response tmdbMediaDetailsResponse
		if err := tmdbGetWithParams(detailsURL, apiKey, map[string]string{
			"append_to_response":     appendTo,
			"include_image_language": "en,null",
		}, &response, scope); err != nil {
			log.Printf("Error fetching TMDB media details for %s/%d: %v. Falling back to mock.", mediaType, id, err)
			servedFallback = true
			var ok bool
			details, ok = getMockMediaDetails(mediaType, id)
			if !ok {
				details = getFallbackMediaDetails(mediaType, id)
			}
		} else {
			detailsVal := response.MediaDetails
			detailsVal.ID = id
			detailsVal.MediaType = mediaType
			title := detailsVal.Title
			if title == "" {
				title = detailsVal.Name
			}
			date := detailsVal.ReleaseDate
			if date == "" {
				date = detailsVal.FirstAirDate
			}
			year := ""
			if len(date) >= 4 {
				year = date[:4]
			}
			// Ratings come from the durable store first.
			//
			// This used to call OMDb synchronously on every details view,
			// before the stored row was even consulted. That put a third-party
			// round trip (up to the client's 10s timeout) directly in front of
			// the detail screen and spent the free daily quota re-asking about
			// titles already answered. The request path now only reads —
			// exactly like the list endpoints — and anything missing or stale
			// is filled in by the background rating workers.
			if row, ok := loadRatings(mediaType, []int64{id})[id]; ok {
				metrics.recordOMDbStore(true)
				applyStoredRating(&detailsVal.TMDBMedia, row)
				if time.Since(row.FetchedAt) >= ratingTTL {
					title, year := ratingTitleAndYear(detailsVal.TMDBMedia)
					enqueueRatingRefresh(ratingJob{
						mediaType: mediaType,
						mediaID:   id,
						title:     title,
						year:      year,
						imdbID:    response.ExternalIDs.IMDBID,
					})
				}
			} else {
				metrics.recordOMDbStore(false)
				enqueueRatingRefresh(ratingJob{
					mediaType: mediaType,
					mediaID:   id,
					title:     title,
					year:      year,
					imdbID:    response.ExternalIDs.IMDBID,
				})
			}
			detailsVal.Cast = topCast(response.Credits.Cast, 12)
			// Pick up to 3 English logos
			logos := response.Images.Logos
			if len(logos) > 3 {
				logos = logos[:3]
			}
			detailsVal.Logos = logos
			detailsVal.Posters = topPosters(response.Images.Posters, 3)
			// Pick YouTube trailers only
			var trailers []Video
			for _, v := range response.Videos.Results {
				if v.Site == "YouTube" && (v.Type == "Trailer" || v.Type == "Teaser") {
					trailers = append(trailers, v)
					if len(trailers) >= 3 {
						break
					}
				}
			}
			detailsVal.Trailers = trailers
			if len(response.Networks) > 0 {
				detailsVal.Network = response.Networks[0].Name
			}
			detailsVal.Certification = extractCertification(mediaType, response)
			// A movie with no franchise comes back with an all-zero object
			// rather than null, so the id is what decides.
			if collection := response.BelongsToCollection; collection != nil && collection.ID != 0 {
				detailsVal.Collection = collection
			}
			detailsVal.Recommendations = relatedForDetails(mediaType, id, response, scope)
			details = &detailsVal
		}
	}

	if servedFallback {
		markResponseUncacheable(c)
	}
	c.JSON(http.StatusOK, details)
}

// markResponseUncacheable overrides the route's public caching policy for a
// response built from placeholder data. Setting the header here wins because
// the response has not been written yet, and the policy middleware only set it
// earlier in the chain.
func markResponseUncacheable(c *gin.Context) {
	c.Header("Cache-Control", "no-store")
}

const (
	// relatedMediaLimit caps the "related" row on the detail screen. The row
	// scrolls horizontally and recycles, so more than a dozen entries are never
	// seen, and every extra one inflates a payload the client caches.
	relatedMediaLimit = 12

	// collectionPartsLimit caps a franchise row. Saga collections can run to
	// dozens of films; this bounds the payload while still covering every
	// realistic franchise within a screen or two of scrolling.
	collectionPartsLimit = 30
)

// relatedForDetails builds the detail screen's related row.
//
// `recommendations` is already appended to the details request, so the common
// path costs no extra TMDB call. `similar` is fetched only when that list trims
// away to nothing — an obscure title, or one TMDB has no recommendations for —
// which keeps the fallback rather than showing an empty row.
//
// Ratings are enriched afterwards so the row's cards draw the same IMDb /
// Metascore / Rotten Tomatoes badges as the Discover carousels.
func relatedForDetails(mediaType string, id int64, response tmdbMediaDetailsResponse, scope *callScope) []TMDBMedia {
	items := relatedMedia(response.Recommendations.Results, mediaType, id, relatedMediaLimit)
	if len(items) == 0 {
		similarURL := fmt.Sprintf("https://api.themoviedb.org/3/%s/%d/similar", mediaType, id)
		var similar tmdbRecommendationsResponse
		if err := tmdbGet(similarURL, os.Getenv("TMDB_API_KEY"), &similar, scope); err == nil {
			items = relatedMedia(similar.Results, mediaType, id, relatedMediaLimit)
		}
	}
	enrichMediaRatings(items, scope)
	return items
}

// handleCollectionDetails serves a franchise's films for the detail screen's
// collection row.
//
// Separate from the details payload on purpose: building it costs a second TMDB
// call, and the row sits below the fold, so the client asks for it only when a
// movie reports a collection. The call itself is shared-cached in the TMDB
// response cache, so a popular franchise is fetched once per 30 minutes.
func handleCollectionDetails(c *gin.Context) {
	collectionID, err := parseID(c.Param("id"))
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Invalid collection id"})
		return
	}

	apiKey := os.Getenv("TMDB_API_KEY")
	scope := scopeFrom(c)
	var collection *CollectionDetails
	servedFallback := false

	if apiKey == "dummy" {
		var ok bool
		collection, ok = getMockCollectionDetails(collectionID)
		if !ok {
			c.JSON(http.StatusNotFound, gin.H{"error": "Collection not found in mock"})
			return
		}
	} else {
		collectionURL := fmt.Sprintf("https://api.themoviedb.org/3/collection/%d", collectionID)
		var wire tmdbCollectionResponse
		if err := tmdbGet(collectionURL, apiKey, &wire, scope); err != nil {
			log.Printf("Error fetching TMDB collection %d: %v. Falling back to mock.", collectionID, err)
			servedFallback = true
			var ok bool
			collection, ok = getMockCollectionDetails(collectionID)
			if !ok {
				c.JSON(http.StatusBadGateway, gin.H{"error": "Failed to fetch collection details"})
				return
			}
		} else {
			details := &CollectionDetails{
				ID:           wire.ID,
				Name:         wire.Name,
				Overview:     wire.Overview,
				PosterPath:   wire.PosterPath,
				BackdropPath: wire.BackdropPath,
				Parts:        trimCollectionParts(wire.Parts, collectionPartsLimit),
			}
			enrichMediaRatings(details.Parts, scope)
			collection = details
		}
	}

	if servedFallback {
		markResponseUncacheable(c)
	}
	c.JSON(http.StatusOK, collection)
}

func handleSeasonDetails(c *gin.Context) {
	seriesID, err := parseID(c.Param("id"))
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Invalid series id"})
		return
	}
	seasonNum, err := parseID(c.Param("season"))
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Invalid season number"})
		return
	}

	apiKey := os.Getenv("TMDB_API_KEY")
	scope := scopeFrom(c)
	var season *SeasonDetails
	servedFallback := false

	if apiKey == "dummy" {
		var ok bool
		season, ok = getMockSeasonDetails(seriesID, seasonNum)
		if !ok {
			c.JSON(http.StatusNotFound, gin.H{"error": "Season not found in mock"})
			return
		}
	} else {
		seasonURL := fmt.Sprintf("https://api.themoviedb.org/3/tv/%d/season/%d", seriesID, seasonNum)
		var s SeasonDetails
		if err := tmdbGet(seasonURL, apiKey, &s, scope); err != nil {
			log.Printf("Error fetching TMDB season details: %v. Falling back to mock.", err)
			servedFallback = true
			var ok bool
			season, ok = getMockSeasonDetails(seriesID, seasonNum)
			if !ok {
				c.JSON(http.StatusBadGateway, gin.H{"error": "Failed to fetch season details"})
				return
			}
		} else {
			season = &s
		}
	}
	if servedFallback {
		markResponseUncacheable(c)
	}
	c.JSON(http.StatusOK, season)
}

func handleEpisodeDetails(c *gin.Context) {
	seriesID, err := parseID(c.Param("id"))
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Invalid series id"})
		return
	}
	seasonNum, err := parseID(c.Param("season"))
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Invalid season number"})
		return
	}
	episodeNum, err := parseID(c.Param("episode"))
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Invalid episode number"})
		return
	}

	apiKey := os.Getenv("TMDB_API_KEY")
	scope := scopeFrom(c)
	var episode *Episode
	servedFallback := false

	if apiKey == "dummy" {
		var ok bool
		episode, ok = getMockEpisodeDetails(seriesID, seasonNum, episodeNum)
		if !ok {
			c.JSON(http.StatusNotFound, gin.H{"error": "Episode not found in mock"})
			return
		}
	} else {
		episodeURL := fmt.Sprintf("https://api.themoviedb.org/3/tv/%d/season/%d/episode/%d", seriesID, seasonNum, episodeNum)
		var ep Episode
		if err := tmdbGet(episodeURL, apiKey, &ep, scope); err != nil {
			log.Printf("Error fetching TMDB episode details: %v. Falling back to mock.", err)
			servedFallback = true
			var ok bool
			episode, ok = getMockEpisodeDetails(seriesID, seasonNum, episodeNum)
			if !ok {
				c.JSON(http.StatusBadGateway, gin.H{"error": "Failed to fetch episode details"})
				return
			}
		} else {
			episode = &ep
		}
	}
	if servedFallback {
		markResponseUncacheable(c)
	}
	c.JSON(http.StatusOK, episode)
}

// discoverPayloadCache holds the marshalled discover response plus the instant
// it expires.
//
// Storing the encoded bytes, rather than only the struct, removes the double
// marshal the handler used to perform on every request: once to build the
// response body and again to write the Redis copy. Serving the stored bytes is
// also what makes the cache hit a single write with no encoding at all.
type discoverPayloadCache struct {
	mu        sync.RWMutex
	payload   []byte
	expiresAt time.Time
	duration  time.Duration
	// inflight coalesces concurrent rebuilds so a cold cache at peak does not
	// become N simultaneous three-call TMDB fan-outs.
	inflight *discoverInflight
}

type discoverInflight struct {
	done    chan struct{}
	payload []byte
}

var discoverCache = &discoverPayloadCache{
	duration: 10 * time.Minute,
	inflight: &discoverInflight{},
}

// freshPayload returns the cached bytes when they are still valid.
func (c *discoverPayloadCache) freshPayload() ([]byte, bool) {
	c.mu.RLock()
	defer c.mu.RUnlock()

	if len(c.payload) == 0 || !time.Now().Before(c.expiresAt) {
		return nil, false
	}
	return c.payload, true
}

func (c *discoverPayloadCache) store(payload []byte) {
	c.mu.Lock()
	defer c.mu.Unlock()

	c.payload = payload
	c.expiresAt = time.Now().Add(c.duration)
}

// beginRebuild registers this caller as the one performing the rebuild, or
// reports that another already is.
func (c *discoverPayloadCache) beginRebuild() (*discoverInflight, bool) {
	c.mu.Lock()
	defer c.mu.Unlock()

	if c.inflight.done != nil {
		return c.inflight, false
	}
	c.inflight = &discoverInflight{done: make(chan struct{})}
	return c.inflight, true
}

// finishRebuild publishes the result and releases the waiters.
//
// The payload is stored before the channel closes, so a waiter that wakes up is
// guaranteed to observe it.
func (c *discoverPayloadCache) finishRebuild(call *discoverInflight, payload []byte) {
	if payload != nil {
		c.store(payload)
	}

	c.mu.Lock()
	call.payload = payload
	if c.inflight == call {
		c.inflight = &discoverInflight{}
	}
	c.mu.Unlock()

	close(call.done)
}

// handleDiscover serves the public Discover carousels.
//
// The previous version held the write lock across all three TMDB calls. Every
// other request for this endpoint — and it is the app's first screen — blocked
// on that mutex for the whole fetch, so a single cold cache serialised the
// entire endpoint behind one multi-second network round trip. The lock now
// covers only the cache read and the cache write; the fetching is coalesced
// separately by an in-flight barrier.
func handleDiscover(c *gin.Context) {
	// 1. In-process cache. This is the path essentially every request takes.
	if payload, ok := discoverCache.freshPayload(); ok {
		c.Data(http.StatusOK, "application/json; charset=utf-8", payload)
		return
	}

	// 2. Shared cache. This endpoint is public and identical for every user, so
	// Redis is pure upside: it survives restarts (which otherwise cost three
	// TMDB calls plus rating enrichment) and is shared across replicas.
	sharedKey := redisNamedKey("discover", "v1")
	if payload, ok := redisGet(sharedKey); ok {
		discoverCache.store(payload)
		c.Data(http.StatusOK, "application/json; charset=utf-8", payload)
		return
	}

	// 3. Coalesce the rebuild. Followers wait for the leader's payload rather
	// than each starting their own three-call fan-out.
	call, leader := discoverCache.beginRebuild()
	if !leader {
		<-call.done
		if len(call.payload) > 0 {
			c.Data(http.StatusOK, "application/json; charset=utf-8", call.payload)
			return
		}
		// The leader failed. Fall through and build it here rather than
		// returning an error: one failed rebuild should not fail every waiter.
		call, leader = discoverCache.beginRebuild()
		if !leader {
			// Another waiter also fell through and won the race; wait for it.
			<-call.done
			if len(call.payload) > 0 {
				c.Data(http.StatusOK, "application/json; charset=utf-8", call.payload)
				return
			}
		}
	}

	if leader {
		// finishRebuild must run on every path, or the waiters block forever.
		var payload []byte
		defer func() { discoverCache.finishRebuild(call, payload) }()

		scope := scopeFrom(c)
		var data *DiscoverResponse
		servedFallback := false

		if os.Getenv("TMDB_API_KEY") == "dummy" {
			data = getMockDiscoverData()
		} else {
			var err error
			data, err = fetchDiscoverData(scope)
			if err != nil {
				log.Printf("Error fetching discover data: %v. Falling back to mock.", err)
				data = getMockDiscoverData()
				servedFallback = true
			}
		}
		enrichMediaRatings(data.Trending, scope)
		enrichMediaRatings(data.Popular, scope)
		enrichMediaRatings(data.PopularSeries, scope)

		encoded, err := json.Marshal(data)
		if err != nil {
			// Nothing cacheable; the defer publishes nil and callers fall back
			// to building it themselves.
			log.Printf("Discover: failed to encode payload: %v", err)
			c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to encode discover data"})
			return
		}
		payload = encoded

		// Placeholder content must not reach a shared cache: with the public
		// policy this route carries, a CDN would store the fake payload and
		// keep serving it to every visitor for the whole max-age window.
		if servedFallback {
			c.Header("Cache-Control", "no-store")
			c.Data(http.StatusOK, "application/json; charset=utf-8", payload)
			return
		}

		redisSet(sharedKey, payload, discoverCache.duration)
		c.Data(http.StatusOK, "application/json; charset=utf-8", payload)
		return
	}

	// Not the leader, and the leader produced nothing: build and serve this
	// request's own copy without publishing it.
	scope := scopeFrom(c)
	data := getMockDiscoverData()
	if os.Getenv("TMDB_API_KEY") != "dummy" {
		if fetched, err := fetchDiscoverData(scope); err == nil {
			data = fetched
		} else {
			c.Header("Cache-Control", "no-store")
		}
	}
	enrichMediaRatings(data.Trending, scope)
	enrichMediaRatings(data.Popular, scope)
	enrichMediaRatings(data.PopularSeries, scope)
	c.JSON(http.StatusOK, data)
}

func fetchDiscoverData(scopes ...*callScope) (*DiscoverResponse, error) {
	apiKey := os.Getenv("TMDB_API_KEY")
	scope := firstScope(scopes)

	// Fetch Trending
	var trending TMDBResponse
	trendingURL := "https://api.themoviedb.org/3/trending/all/day"
	if err := tmdbGet(trendingURL, apiKey, &trending, scope); err != nil {
		return nil, fmt.Errorf("failed to fetch trending: %w", err)
	}

	// Fetch Popular Movies
	var popular TMDBResponse
	popularURL := "https://api.themoviedb.org/3/movie/popular"
	if err := tmdbGet(popularURL, apiKey, &popular, scope); err != nil {
		return nil, fmt.Errorf("failed to fetch popular: %w", err)
	}

	// Fetch Popular TV Series
	var popularSeries TMDBResponse
	popularSeriesURL := "https://api.themoviedb.org/3/tv/popular"
	if err := tmdbGet(popularSeriesURL, apiKey, &popularSeries, scope); err != nil {
		return nil, fmt.Errorf("failed to fetch popular series: %w", err)
	}

	// Unify popular list media type to "movie"
	for i := range popular.Results {
		if popular.Results[i].MediaType == "" {
			popular.Results[i].MediaType = "movie"
		}
	}

	// Unify popular series list media type to "tv"
	for i := range popularSeries.Results {
		if popularSeries.Results[i].MediaType == "" {
			popularSeries.Results[i].MediaType = "tv"
		}
	}

	return &DiscoverResponse{
		Trending:      trending.Results,
		Popular:       popular.Results,
		PopularSeries: popularSeries.Results,
	}, nil
}
