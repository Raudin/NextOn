package main

import (
	"fmt"
	"net/http"
	"sort"
	"time"

	"github.com/gin-gonic/gin"
)

type ReplayPeriod string

const (
	ReplayPeriodThisWeek  ReplayPeriod = "this_week"
	ReplayPeriodThisMonth ReplayPeriod = "this_month"
	ReplayPeriodThisYear  ReplayPeriod = "this_year"
	ReplayPeriodAllTime   ReplayPeriod = "all_time"
)

type ReplayHeroCard struct {
	ID         string `json:"id"`
	Label      string `json:"label"`
	Value      string `json:"value"`
	Detail     string `json:"detail"`
	ArtworkURL string `json:"artwork_url,omitempty"`
}

type ReplayRow struct {
	Rank       int    `json:"rank"`
	Title      string `json:"title"`
	Subtitle   string `json:"subtitle,omitempty"`
	ArtworkURL string `json:"artwork_url,omitempty"`
	Count      int    `json:"count"`
}

type HabitsSummary struct {
	DistinctMovies  int     `json:"distinct_movies"`
	DistinctShows   int     `json:"distinct_shows"`
	TotalEpisodes   int     `json:"total_episodes"`
	PeakHour        *int    `json:"peak_hour,omitempty"`
	BusiestDay      *string `json:"busiest_day,omitempty"`
	BusiestDayCount int     `json:"busiest_day_count"`
}

type ReplaySummary struct {
	Period      ReplayPeriod     `json:"period"`
	PeriodLabel string           `json:"period_label"`
	MemberSince string           `json:"member_since"`
	Cards       []ReplayHeroCard `json:"cards"`
	TopShows    []ReplayRow      `json:"top_shows"`
	TopGenres   []ReplayRow      `json:"top_genres"`
	TopActors   []ReplayRow      `json:"top_actors"`
	TopNetworks []ReplayRow      `json:"top_networks"`
	Habits      HabitsSummary    `json:"habits"`
	IsEmpty     bool             `json:"is_empty"`
}

func getPeriodDateRange(period ReplayPeriod, now time.Time) (time.Time, string) {
	switch period {
	case ReplayPeriodThisWeek:
		weekday := int(now.Weekday())
		if weekday == 0 {
			weekday = 7
		}
		startOfWeek := time.Date(now.Year(), now.Month(), now.Day(), 0, 0, 0, 0, now.Location()).AddDate(0, 0, -(weekday - 1))
		return startOfWeek, "This Week"
	case ReplayPeriodThisMonth:
		startOfMonth := time.Date(now.Year(), now.Month(), 1, 0, 0, 0, 0, now.Location())
		return startOfMonth, now.Format("January 2006")
	case ReplayPeriodThisYear:
		startOfYear := time.Date(now.Year(), 1, 1, 0, 0, 0, 0, now.Location())
		return startOfYear, fmt.Sprintf("%d", now.Year())
	default:
		return time.Time{}, "All Time"
	}
}

func handleGetReplay(c *gin.Context) {
	userID, ok := c.Get("user_id")
	if !ok {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "Unauthorized"})
		return
	}
	userUID := userID.(uint)

	periodParam := c.DefaultQuery("period", string(ReplayPeriodThisYear))
	period := ReplayPeriod(periodParam)
	if period != ReplayPeriodThisWeek && period != ReplayPeriodThisMonth && period != ReplayPeriodThisYear && period != ReplayPeriodAllTime {
		period = ReplayPeriodThisYear
	}

	var user User
	if err := db.First(&user, userUID).Error; err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "User not found"})
		return
	}

	now := time.Now()
	startDate, periodLabel := getPeriodDateRange(period, now)

	query := db.Where("user_id = ?", userUID)
	if !startDate.IsZero() {
		query = query.Where("watched_at >= ?", startDate)
	}

	var watchedItems []WatchedItem
	if err := query.Order("watched_at asc").Find(&watchedItems).Error; err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to load watched history"})
		return
	}

	memberSince := user.CreatedAt.Format("2006")
	if memberSince == "" || memberSince == "0001" {
		memberSince = now.Format("2006")
	}

	if len(watchedItems) == 0 {
		c.JSON(http.StatusOK, ReplaySummary{
			Period:      period,
			PeriodLabel: periodLabel,
			MemberSince: memberSince,
			Cards:       []ReplayHeroCard{},
			TopShows:    []ReplayRow{},
			TopGenres:   []ReplayRow{},
			TopActors:   []ReplayRow{},
			TopNetworks: []ReplayRow{},
			Habits: HabitsSummary{
				DistinctMovies:  0,
				DistinctShows:   0,
				TotalEpisodes:   0,
				PeakHour:        nil,
				BusiestDay:      nil,
				BusiestDayCount: 0,
			},
			IsEmpty: true,
		})
		return
	}

	var totalMoviesWatched int
	var totalEpisodesWatched int
	distinctMovieIDs := make(map[int64]struct{})
	distinctShowIDs := make(map[int64]struct{})
	hourCounts := make(map[int]int)
	dayCounts := make(map[string]int)
	showEpisodeCounts := make(map[int64]int)

	distinctMedia := make(map[string]struct{})
	var mediaToFetch []struct {
		MediaType string
		MediaID   int64
	}

	for _, item := range watchedItems {
		mKey := fmt.Sprintf("%s:%d", item.MediaType, item.MediaID)
		if _, exists := distinctMedia[mKey]; !exists {
			distinctMedia[mKey] = struct{}{}
			mediaToFetch = append(mediaToFetch, struct {
				MediaType string
				MediaID   int64
			}{
				MediaType: item.MediaType,
				MediaID:   item.MediaID,
			})
		}

		if item.MediaType == "movie" {
			totalMoviesWatched++
			distinctMovieIDs[item.MediaID] = struct{}{}
		} else if item.MediaType == "tv" {
			totalEpisodesWatched++
			distinctShowIDs[item.MediaID] = struct{}{}
			showEpisodeCounts[item.MediaID]++
		}

		if !item.WatchedAt.IsZero() {
			hour := item.WatchedAt.Hour()
			hourCounts[hour]++
			dayName := item.WatchedAt.Weekday().String()
			dayCounts[dayName]++
		}
	}

	scope := scopeFrom(c)
	detailsMap := batchFetchMediaDetails(mediaToFetch, scope)

	type kv struct {
		Key   int64
		Value int
	}
	var sortedShows []kv
	for k, v := range showEpisodeCounts {
		sortedShows = append(sortedShows, kv{k, v})
	}
	sort.Slice(sortedShows, func(i, j int) bool {
		return sortedShows[i].Value > sortedShows[j].Value
	})

	var topShows []ReplayRow
	for i, item := range sortedShows {
		if i >= 5 {
			break
		}
		title := fmt.Sprintf("TV Show %d", item.Key)
		posterPath := ""
		if d, ok := detailsMap[fmt.Sprintf("tv:%d", item.Key)]; ok && d != nil {
			if d.Name != "" {
				title = d.Name
			} else if d.Title != "" {
				title = d.Title
			}
			posterPath = d.PosterPath
		}
		subtitle := fmt.Sprintf("%d episodes", item.Value)
		if item.Value == 1 {
			subtitle = "1 episode"
		}
		topShows = append(topShows, ReplayRow{
			Rank:       i + 1,
			Title:      title,
			Subtitle:   subtitle,
			ArtworkURL: posterPath,
			Count:      item.Value,
		})
	}

	genreCounts := make(map[string]int)
	actorCounts := make(map[string]struct {
		Count       int
		ProfilePath string
	})
	networkCounts := make(map[string]int)

	for _, item := range watchedItems {
		mKey := fmt.Sprintf("%s:%d", item.MediaType, item.MediaID)
		details, ok := detailsMap[mKey]
		if !ok || details == nil {
			continue
		}

		for _, g := range details.Genres {
			if g.Name != "" {
				genreCounts[g.Name]++
			}
		}

		for _, cast := range details.Cast {
			if cast.Name != "" {
				ac := actorCounts[cast.Name]
				ac.Count++
				if cast.ProfilePath != "" {
					ac.ProfilePath = cast.ProfilePath
				}
				actorCounts[cast.Name] = ac
			}
		}

		if details.Network != "" {
			networkCounts[details.Network]++
		}
	}

	var topGenres []ReplayRow
	type strKv struct {
		Key   string
		Value int
	}
	var sortedGenres []strKv
	for k, v := range genreCounts {
		sortedGenres = append(sortedGenres, strKv{k, v})
	}
	sort.Slice(sortedGenres, func(i, j int) bool {
		return sortedGenres[i].Value > sortedGenres[j].Value
	})
	for i, item := range sortedGenres {
		if i >= 5 {
			break
		}
		topGenres = append(topGenres, ReplayRow{
			Rank:     i + 1,
			Title:    item.Key,
			Subtitle: fmt.Sprintf("%d titles", item.Value),
			Count:    item.Value,
		})
	}

	var topActors []ReplayRow
	type actorEntry struct {
		Name        string
		Count       int
		ProfilePath string
	}
	var sortedActors []actorEntry
	for k, v := range actorCounts {
		sortedActors = append(sortedActors, actorEntry{
			Name:        k,
			Count:       v.Count,
			ProfilePath: v.ProfilePath,
		})
	}
	sort.Slice(sortedActors, func(i, j int) bool {
		return sortedActors[i].Count > sortedActors[j].Count
	})
	for i, item := range sortedActors {
		if i >= 5 {
			break
		}
		topActors = append(topActors, ReplayRow{
			Rank:       i + 1,
			Title:      item.Name,
			Subtitle:   fmt.Sprintf("%d watched roles", item.Count),
			ArtworkURL: item.ProfilePath,
			Count:      item.Count,
		})
	}

	var topNetworks []ReplayRow
	var sortedNetworks []strKv
	for k, v := range networkCounts {
		sortedNetworks = append(sortedNetworks, strKv{k, v})
	}
	sort.Slice(sortedNetworks, func(i, j int) bool {
		return sortedNetworks[i].Value > sortedNetworks[j].Value
	})
	for i, item := range sortedNetworks {
		if i >= 5 {
			break
		}
		topNetworks = append(topNetworks, ReplayRow{
			Rank:     i + 1,
			Title:    item.Key,
			Subtitle: fmt.Sprintf("%d series", item.Value),
			Count:    item.Value,
		})
	}

	var peakHour *int
	maxHourCount := -1
	for h, c := range hourCounts {
		if c > maxHourCount {
			maxHourCount = c
			hVal := h
			peakHour = &hVal
		}
	}

	var busiestDay *string
	maxDayCount := 0
	for d, c := range dayCounts {
		if c > maxDayCount {
			maxDayCount = c
			dVal := d
			busiestDay = &dVal
		}
	}

	habits := HabitsSummary{
		DistinctMovies:  len(distinctMovieIDs),
		DistinctShows:   len(distinctShowIDs),
		TotalEpisodes:   totalEpisodesWatched,
		PeakHour:        peakHour,
		BusiestDay:      busiestDay,
		BusiestDayCount: maxDayCount,
	}

	totalMinutes := (int64(totalMoviesWatched) * 120) + (int64(totalEpisodesWatched) * 45)
	timeHours := totalMinutes / 60
	timeMins := totalMinutes % 60
	var watchTimeFormatted string
	if timeHours > 24 {
		days := timeHours / 24
		remHours := timeHours % 24
		watchTimeFormatted = fmt.Sprintf("%dd %dh", days, remHours)
	} else if timeHours > 0 {
		watchTimeFormatted = fmt.Sprintf("%dh %dm", timeHours, timeMins)
	} else {
		watchTimeFormatted = fmt.Sprintf("%dm", timeMins)
	}

	var watchedDates []string
	for _, item := range watchedItems {
		if !item.WatchedAt.IsZero() {
			watchedDates = append(watchedDates, item.WatchedAt.Format("2006-01-02"))
		}
	}
	streakDays := calculateStreakFromDates(watchedDates)

	leadArtwork := ""
	if len(topShows) > 0 && topShows[0].ArtworkURL != "" {
		leadArtwork = topShows[0].ArtworkURL
	}

	cards := []ReplayHeroCard{
		{
			ID:         "watch_time",
			Label:      "WATCH TIME",
			Value:      watchTimeFormatted,
			Detail:     fmt.Sprintf("%d movies & %d episodes", totalMoviesWatched, totalEpisodesWatched),
			ArtworkURL: leadArtwork,
		},
	}

	if len(topShows) > 0 {
		cards = append(cards, ReplayHeroCard{
			ID:         "top_show",
			Label:      "TOP SHOW",
			Value:      topShows[0].Title,
			Detail:     topShows[0].Subtitle,
			ArtworkURL: topShows[0].ArtworkURL,
		})
	}

	if len(topGenres) > 0 {
		cards = append(cards, ReplayHeroCard{
			ID:         "top_genre",
			Label:      "TOP GENRE",
			Value:      topGenres[0].Title,
			Detail:     topGenres[0].Subtitle,
			ArtworkURL: leadArtwork,
		})
	}

	cards = append(cards, ReplayHeroCard{
		ID:         "streak",
		Label:      "WATCH STREAK",
		Value:      fmt.Sprintf("%d Days", streakDays),
		Detail:     "Consistent daily viewing",
		ArtworkURL: leadArtwork,
	})

	c.JSON(http.StatusOK, ReplaySummary{
		Period:      period,
		PeriodLabel: periodLabel,
		MemberSince: memberSince,
		Cards:       cards,
		TopShows:    topShows,
		TopGenres:   topGenres,
		TopActors:   topActors,
		TopNetworks: topNetworks,
		Habits:      habits,
		IsEmpty:     false,
	})
}
