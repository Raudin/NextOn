package main

import (
	"fmt"
	"os"
	"sync"
)

// fetchMediaDetailsFast retrieves media details from TMDB or local mock data.
func fetchMediaDetailsFast(mediaType string, mediaID int64, scope *callScope) (*MediaDetails, bool) {
	apiKey := os.Getenv("TMDB_API_KEY")
	if apiKey == "dummy" || apiKey == "" {
		if details, ok := getMockMediaDetails(mediaType, mediaID); ok {
			return details, true
		}
		return getFallbackMediaDetails(mediaType, mediaID), true
	}

	detailsURL := fmt.Sprintf("https://api.themoviedb.org/3/%s/%d", mediaType, mediaID)
	appendTo := "credits"
	var response tmdbMediaDetailsResponse
	if err := tmdbGetWithParams(detailsURL, apiKey, map[string]string{
		"append_to_response": appendTo,
	}, &response, scope); err != nil {
		if details, ok := getMockMediaDetails(mediaType, mediaID); ok {
			return details, true
		}
		return getFallbackMediaDetails(mediaType, mediaID), true
	}

	detailsVal := response.MediaDetails
	detailsVal.ID = mediaID
	detailsVal.MediaType = mediaType
	detailsVal.Cast = topCast(response.Credits.Cast, 10)
	if len(response.Networks) > 0 {
		detailsVal.Network = response.Networks[0].Name
	}
	return &detailsVal, true
}

// batchFetchMediaDetails fetches media details for a list of (mediaType, mediaID) pairs concurrently.
func batchFetchMediaDetails(items []struct {
	MediaType string
	MediaID   int64
}, scope *callScope) map[string]*MediaDetails {
	out := make(map[string]*MediaDetails)
	var mu sync.Mutex
	var wg sync.WaitGroup
	sem := make(chan struct{}, tmdbDetailConcurrency)

	for _, item := range items {
		key := fmt.Sprintf("%s:%d", item.MediaType, item.MediaID)
		mType := item.MediaType
		mID := item.MediaID

		wg.Add(1)
		go func() {
			defer wg.Done()
			sem <- struct{}{}
			defer func() { <-sem }()

			details, ok := fetchMediaDetailsFast(mType, mID, scope)
			if ok && details != nil {
				mu.Lock()
				out[key] = details
				mu.Unlock()
			}
		}()
	}

	wg.Wait()
	return out
}
