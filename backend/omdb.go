package main

import (
	"encoding/json"
	"fmt"
	"net/http"
	"net/url"
	"os"
	"strconv"
	"strings"
	"sync"
	"time"
)

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

var omdbCache = struct {
	sync.Mutex
	items map[string]TMDBMedia
}{items: make(map[string]TMDBMedia)}

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

func fetchOMDbRatings(apiKey, title, year, imdbID string) (TMDBMedia, error) {
	var result TMDBMedia
	if apiKey == "" || apiKey == "dummy" || (title == "" && imdbID == "") {
		return result, nil
	}
	key := omdbURL(apiKey, title, year, imdbID)
	omdbCache.Lock()
	if cached, ok := omdbCache.items[key]; ok {
		omdbCache.Unlock()
		return cached, nil
	}
	omdbCache.Unlock()

	resp, err := omdbHTTPClient.Get(key)
	if err != nil {
		return result, err
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		return result, fmt.Errorf("OMDb API returned status code %d", resp.StatusCode)
	}
	var data omdbResponse
	if err := json.NewDecoder(resp.Body).Decode(&data); err != nil {
		return result, err
	}
	if strings.EqualFold(data.Response, "False") {
		return result, nil
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
	omdbCache.Lock()
	omdbCache.items[key] = result
	omdbCache.Unlock()
	return result, nil
}

func applyOMDbRatings(item *TMDBMedia, ratings TMDBMedia) {
	item.IMDBRating = ratings.IMDBRating
	item.Metascore = ratings.Metascore
	item.RottenTomatoes = ratings.RottenTomatoes
}

func enrichMediaRatings(items []TMDBMedia) {
	apiKey := strings.TrimSpace(getOMDbAPIKey())
	if apiKey == "" || apiKey == "dummy" {
		return
	}
	var wg sync.WaitGroup
	sem := make(chan struct{}, 8)
	for i := range items {
		if items[i].Title == "" && items[i].Name == "" {
			continue
		}
		item := &items[i]
		wg.Add(1)
		go func() {
			defer wg.Done()
			sem <- struct{}{}
			defer func() { <-sem }()
			title := item.Title
			if title == "" {
				title = item.Name
			}
			date := item.ReleaseDate
			if date == "" {
				date = item.FirstAirDate
			}
			year := ""
			if len(date) >= 4 {
				year = date[:4]
			}
			if ratings, err := fetchOMDbRatings(apiKey, title, year, ""); err == nil {
				applyOMDbRatings(item, ratings)
			}
		}()
	}
	wg.Wait()
}

func getOMDbAPIKey() string {
	return strings.TrimSpace(os.Getenv("OMDB_API_KEY"))
}
