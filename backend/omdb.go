package main

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"net/url"
	"os"
	"strconv"
	"strings"
	"time"
)

// This file is deliberately limited to talking to OMDb. Deciding *whether* to
// call it, and remembering the answer, belongs to ratings.go — the in-process
// response cache that used to live here was unbounded, had no TTL, and blocked
// list requests, so it has been removed entirely in favour of the MediaRating
// table.

type omdbRating struct {
	Source string `json:"Source"`
	Value  string `json:"Value"`
}

type omdbResponse struct {
	Response string       `json:"Response"`
	Ratings  []omdbRating `json:"Ratings"`
	IMDB     string       `json:"imdbRating"`
	Meta     string       `json:"Metascore"`
}

var omdbHTTPClient = &http.Client{Timeout: 8 * time.Second}

func parseOMDbNumber(value string) (float64, bool) {
	value = strings.TrimSpace(strings.TrimSuffix(value, "%"))
	n, err := strconv.ParseFloat(value, 64)
	return n, err == nil
}

func omdbURL(apiKey, title, year, imdbID string) string {
	params := url.Values{"apikey": {apiKey}, "plot": {"short"}}
	if imdbID != "" {
		params.Set("i", imdbID)
	} else {
		params.Set("t", title)
		if year != "" {
			params.Set("y", year)
		}
	}
	return "https://www.omdbapi.com/?" + params.Encode()
}

// fetchOMDbRatings performs a single OMDb lookup.
//
// The boolean reports whether OMDb actually had a record. Callers must persist
// that negative result, otherwise unknown titles are re-queried forever.
//
// This always performs the HTTP request — it has no cache. Callers are
// responsible for checking the MediaRating table first.
func fetchOMDbRatings(apiKey, title, year, imdbID string, scopes ...*callScope) (TMDBMedia, bool, error) {
	var result TMDBMedia
	if apiKey == "" || apiKey == "dummy" || (title == "" && imdbID == "") {
		return result, false, nil
	}

	requestURL := omdbURL(apiKey, title, year, imdbID)
	firstScope(scopes).addOMDb()
	metrics.recordOMDbFetch()

	// Smooth bursts; a refusal is non-fatal by design (see tokenBucket.take).
	omdbLimiter.take(context.Background(), outboundWaitMax)

	resp, err := omdbHTTPClient.Get(requestURL)
	if err != nil {
		return result, false, err
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		return result, false, fmt.Errorf("OMDb API returned status code %d", resp.StatusCode)
	}

	var data omdbResponse
	if err := json.NewDecoder(resp.Body).Decode(&data); err != nil {
		return result, false, err
	}
	if strings.EqualFold(data.Response, "False") {
		// OMDb knows nothing about this title. Not an error, but not a hit
		// either — the caller records it as a negative cache entry.
		return result, false, nil
	}

	if value, ok := parseOMDbNumber(data.IMDB); ok {
		result.IMDBRating = &value
	}
	if value, ok := parseOMDbNumber(data.Meta); ok {
		meta := int(value)
		result.Metascore = &meta
	}
	for _, rating := range data.Ratings {
		if strings.EqualFold(rating.Source, "Rotten Tomatoes") {
			if value, ok := parseOMDbNumber(rating.Value); ok {
				rt := int(value)
				result.RottenTomatoes = &rt
			}
		}
	}

	return result, true, nil
}

func applyOMDbRatings(item *TMDBMedia, ratings TMDBMedia) {
	item.IMDBRating = ratings.IMDBRating
	item.Metascore = ratings.Metascore
	item.RottenTomatoes = ratings.RottenTomatoes
}

func getOMDbAPIKey() string {
	return strings.TrimSpace(os.Getenv("OMDB_API_KEY"))
}

// omdbEnabled reports whether rating lookups are possible at all, so callers
// can skip the whole code path (and the DB read) when they are not.
func omdbEnabled() bool {
	apiKey := getOMDbAPIKey()
	return apiKey != "" && apiKey != "dummy"
}
