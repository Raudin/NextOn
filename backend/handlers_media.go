package main

import (
	"encoding/json"
	"fmt"
	"log"
	"net/http"
	"os"
	"strings"
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

	if apiKey == "dummy" {
		var ok bool
		details, ok = getMockMediaDetails(mediaType, id)
		if !ok {
			details = getFallbackMediaDetails(mediaType, id)
		}
	} else {
		detailsURL := fmt.Sprintf("https://api.themoviedb.org/3/%s/%d", mediaType, id)
		var response tmdbMediaDetailsResponse
		if err := tmdbGetWithParams(detailsURL, apiKey, map[string]string{
			"append_to_response":     "credits,images,videos,external_ids",
			"include_image_language": "en,null",
		}, &response, scope); err != nil {
			log.Printf("Error fetching TMDB media details for %s/%d: %v. Falling back to mock.", mediaType, id, err)
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
			if ratings, found, err := fetchOMDbRatings(getOMDbAPIKey(), title, year, response.ExternalIDs.IMDBID, scope); err == nil {
				if found {
					applyOMDbRatings(&detailsVal.TMDBMedia, ratings)
				}
				// Persist even a negative result so the background worker and
				// future list requests do not re-query this title.
				storeRating(mediaType, id, title, year, ratings, found)
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
			details = &detailsVal
		}
	}

	c.JSON(http.StatusOK, details)
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
	c.JSON(http.StatusOK, episode)
}

func handleDiscover(c *gin.Context) {
	// 1. Read Lock Cache Check
	discoverCache.RLock()
	if discoverCache.data != nil && time.Now().Before(discoverCache.expiresAt) {
		data := discoverCache.data
		discoverCache.RUnlock()
		log.Println("Serving discover response from memory cache")
		c.JSON(http.StatusOK, data)
		return
	}
	discoverCache.RUnlock()

	// 1b. Shared cache. This endpoint is public and identical for every user,
	// so Redis is pure upside: it survives restarts (which otherwise cost three
	// TMDB calls plus OMDb enrichment) and is shared across replicas. A miss or
	// an outage falls through to the in-process path below.
	sharedKey := redisNamedKey("discover", "v1")
	if payload, ok := redisGet(sharedKey); ok {
		var cached DiscoverResponse
		if err := json.Unmarshal(payload, &cached); err == nil {
			discoverCache.Lock()
			discoverCache.data = &cached
			discoverCache.expiresAt = time.Now().Add(discoverCache.duration)
			discoverCache.Unlock()
			c.Data(http.StatusOK, "application/json; charset=utf-8", payload)
			return
		}
	}

	// 2. Cache expired or empty: Acquire Write Lock
	discoverCache.Lock()
	defer discoverCache.Unlock()

	// Double-check condition after acquiring lock (avoid race condition)
	if discoverCache.data != nil && time.Now().Before(discoverCache.expiresAt) {
		c.JSON(http.StatusOK, discoverCache.data)
		return
	}

	log.Println("Cache expired or empty. Fetching fresh data...")
	scope := scopeFrom(c)
	var data *DiscoverResponse
	var err error
	if os.Getenv("TMDB_API_KEY") == "dummy" {
		data = getMockDiscoverData()
	} else {
		data, err = fetchDiscoverData(scope)
		if err != nil {
			log.Printf("Error fetching discover data: %v. Falling back to mock.", err)
			data = getMockDiscoverData()
			err = nil
		}
	}
	enrichMediaRatings(data.Trending, scope)
	enrichMediaRatings(data.Popular, scope)
	enrichMediaRatings(data.PopularSeries, scope)

	if err != nil {
		c.JSON(http.StatusBadGateway, gin.H{"error": "Failed to fetch discover data"})
		return
	}

	// Update cache
	discoverCache.data = data
	discoverCache.expiresAt = time.Now().Add(discoverCache.duration)

	if payload, err := json.Marshal(data); err == nil {
		redisSet(sharedKey, payload, discoverCache.duration)
	}

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
