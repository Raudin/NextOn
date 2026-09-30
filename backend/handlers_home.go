package main

import (
	"fmt"
	"log"
	"net/http"
	"os"
	"sort"
	"sync"
	"time"

	"github.com/gin-gonic/gin"
)

// The Home schedule used to be assembled entirely on the client: fetch the
// watchlist, then for every entry call the watched-status and media-details
// endpoints, and for TV shows walk season by season fetching full season
// payloads until the next unwatched episode was found. A 40-title watchlist
// therefore cost the client ~120+ round trips, each of which the backend then
// translated into TMDB (and OMDb) lookups.
//
// This endpoint resolves the whole schedule server-side in one response. The
// work is identical, but it is done once per user instead of once per screen,
// it runs against the shared TMDB cache rather than the client's per-device
// cache, and it collapses to a single request that the client can revalidate
// with an ETag.

// SeasonLite is the per-season shape the schedule needs. Season overviews are
// deliberately excluded: they are the largest field in TMDB's season objects
// and the Home screen renders none of them. Four schedule lists of full
// MediaDetails objects was the bulk of the client's key-value cache.
type SeasonLite struct {
	SeasonNumber int64 `json:"season_number"`
	EpisodeCount int64 `json:"episode_count"`
}

// MediaDetailsLite is the trimmed details shape for list rendering. It keeps
// exactly the fields the Home cards use (movie runtime, tagline, show status,
// per-season episode counts) and drops overview, cast, images and videos.
type MediaDetailsLite struct {
	ID             int64        `json:"id"`
	Runtime        int64        `json:"runtime,omitempty"`
	EpisodeRunTime []int64      `json:"episode_run_time,omitempty"`
	Tagline        string       `json:"tagline,omitempty"`
	Status         string       `json:"status,omitempty"`
	ReleaseDate    string       `json:"release_date,omitempty"`
	FirstAirDate   string       `json:"first_air_date,omitempty"`
	Seasons        []SeasonLite `json:"seasons,omitempty"`
}

// HomeShowItem is one TV entry in the schedule. Badge state (new season /
// season finale) is computed here so the client stops deriving it during
// render, where it had to re-scan the season list for every visible row.
type HomeShowItem struct {
	Show           TMDBMedia        `json:"show"`
	Details        MediaDetailsLite `json:"details"`
	Episode        Episode          `json:"episode"`
	FormattedDate  string           `json:"formatted_date"`
	IsNewSeason    bool             `json:"is_new_season"`
	IsSeasonFinale bool             `json:"is_season_finale"`
	// EpisodesRemaining is the backlog the viewer can start on right now:
	// the next unwatched episode plus any later ones that have already aired.
	// The client draws it as a count badge over the poster, so it must be
	// resolved here — the schedule payload carries the next episode and the
	// per-season totals, but no watched counts, so a client-side derivation
	// would count announced-but-unaired episodes too.
	EpisodesRemaining int64 `json:"episodes_remaining"`
}

// HomeMovieItem is one movie entry in the schedule.
type HomeMovieItem struct {
	Movie         TMDBMedia        `json:"movie"`
	Details       MediaDetailsLite `json:"details"`
	FormattedDate string           `json:"formatted_date"`
}

// HomeScheduleResponse is the full payload. Ready lists are ordered
// alphabetically and upcoming lists by air/release date, matching the ordering
// the client previously produced from the alphabetically-sorted watchlist.
type HomeScheduleResponse struct {
	GeneratedAt    time.Time       `json:"generated_at"`
	ShowsReady     []HomeShowItem  `json:"shows_ready"`
	ShowsUpcoming  []HomeShowItem  `json:"shows_upcoming"`
	MoviesReady    []HomeMovieItem `json:"movies_ready"`
	MoviesUpcoming []HomeMovieItem `json:"movies_upcoming"`
}

// nextEpisodeResult carries everything the schedule needs about one TV show.
type nextEpisodeResult struct {
	episode        Episode
	seasons        []SeasonLite
	seasonEpisodes int64
	// remaining counts the episodes already available from `episode` onwards.
	remaining int64
	status    string
	found     bool
}

// fetchSeasonDetail returns one season's episodes, going through the mock
// dataset when the server is running without a real TMDB key. Several handlers
// open-code this dummy/real branch; centralising it keeps the mock path from
// drifting away from the real one.
func fetchSeasonDetail(seriesID, seasonNum int64, scope *callScope) (*SeasonDetails, error) {
	apiKey := os.Getenv("TMDB_API_KEY")
	if apiKey == "dummy" {
		season, ok := getMockSeasonDetails(seriesID, seasonNum)
		if !ok {
			return nil, fmt.Errorf("season %d of series %d not found in mock", seasonNum, seriesID)
		}
		return season, nil
	}

	seasonURL := fmt.Sprintf("https://api.themoviedb.org/3/tv/%d/season/%d", seriesID, seasonNum)
	var season SeasonDetails
	if err := tmdbGet(seasonURL, apiKey, &season, scope); err != nil {
		return nil, err
	}
	return &season, nil
}

// seasonFetcher loads one season's episodes. Injected so the next-episode
// search can be unit tested without touching TMDB or the mock dataset.
type seasonFetcher func(seriesID, seasonNum int64) (*SeasonDetails, error)

// resolveNextEpisode finds the first unwatched episode of a series in season
// order.
//
// Seasons whose watched count already equals their episode count are skipped
// without a network call, which is the common case for a long-running show the
// user is up to date on. Season counts are only trusted when positive: TMDB
// reports `episode_count: 0` for some unaired seasons, and treating that as
// "fully watched" would silently drop the show off the schedule.
func resolveNextEpisode(seriesID int64, seasons []Season, status string, watched []WatchedItem, fetch seasonFetcher) (nextEpisodeResult, error) {
	watchedSet := make(map[[2]int64]bool, len(watched))
	for _, w := range watched {
		if w.SeasonNumber != nil && w.EpisodeNumber != nil {
			watchedSet[[2]int64{*w.SeasonNumber, *w.EpisodeNumber}] = true
		}
	}

	regular := make([]Season, 0, len(seasons))
	for _, s := range seasons {
		if s.SeasonNumber >= 1 {
			regular = append(regular, s)
		}
	}
	sort.Slice(regular, func(i, j int) bool {
		return regular[i].SeasonNumber < regular[j].SeasonNumber
	})

	lite := make([]SeasonLite, 0, len(regular))
	for _, s := range regular {
		lite = append(lite, SeasonLite{
			SeasonNumber: s.SeasonNumber,
			EpisodeCount: s.EpisodeCount,
		})
	}

	result := nextEpisodeResult{seasons: lite, status: status}

	for _, s := range regular {
		var watchedInSeason int64
		for ep := int64(1); ep <= s.EpisodeCount; ep++ {
			if watchedSet[[2]int64{s.SeasonNumber, ep}] {
				watchedInSeason++
			}
		}
		if s.EpisodeCount > 0 && watchedInSeason >= s.EpisodeCount {
			continue
		}

		season, err := fetch(seriesID, s.SeasonNumber)
		if err != nil {
			return result, err
		}

		episodes := make([]Episode, len(season.Episodes))
		copy(episodes, season.Episodes)
		sort.Slice(episodes, func(i, j int) bool {
			return episodes[i].EpisodeNumber < episodes[j].EpisodeNumber
		})

		for i, ep := range episodes {
			// Episode 0 is TMDB's slot for specials/previews and is never
			// trackable through this app.
			if ep.EpisodeNumber < 1 {
				continue
			}
			if watchedSet[[2]int64{ep.SeasonNumber, ep.EpisodeNumber}] {
				continue
			}
			result.episode = ep
			result.seasonEpisodes = s.EpisodeCount
			// Everything before this episode in the season is watched, so the
			// slice from here on is exactly the backlog a viewer can start on.
			result.remaining = countAiredFrom(episodes[i:])
			result.found = true
			return result, nil
		}
	}

	return result, nil
}

// countAiredFrom counts how many of these episodes a viewer could watch right
// now, i.e. the ones that have already aired.
//
// Called with the slice starting at the first unwatched episode, so the result
// is the show's backlog: 1 for a viewer who is up to date, more when several
// episodes have piled up since they last watched.
//
// Episodes still in the future are not "remaining" — the schedule reports those
// with a countdown instead — and a blank air date is treated the same way,
// because TMDB fills it in only once an episode is actually scheduled.
func countAiredFrom(episodes []Episode) int64 {
	var count int64
	for _, ep := range episodes {
		if ep.AirDate == "" || isAfterToday(ep.AirDate) {
			continue
		}
		count++
	}
	return count
}

// resolveShow looks up one watchlist show and reports its next unwatched
// episode. The single /tv/{id} call provides both the season list needed to
// locate that episode and the status used by the "caught up" classification.
func resolveShow(item TMDBMedia, watched []WatchedItem, scope *callScope) (HomeShowItem, bool) {
	apiKey := os.Getenv("TMDB_API_KEY")

	var seasons []Season
	var status string
	var firstAirDate string

	if apiKey == "dummy" {
		details, ok := getMockMediaDetails("tv", item.ID)
		if !ok {
			details = getFallbackMediaDetails("tv", item.ID)
		}
		seasons = details.Seasons
		status = details.Status
		firstAirDate = details.FirstAirDate
	} else {
		url := fmt.Sprintf("https://api.themoviedb.org/3/tv/%d", item.ID)
		var summary tmdbTVSummary
		if err := tmdbGet(url, apiKey, &summary, scope); err != nil {
			log.Printf("Home schedule: skipping tv/%d, TMDB lookup failed: %v", item.ID, err)
			return HomeShowItem{}, false
		}
		seasons = summary.Seasons
		status = summary.Status
		firstAirDate = summary.FirstAirDate
	}

	next, err := resolveNextEpisode(item.ID, seasons, status, watched, func(sid, sn int64) (*SeasonDetails, error) {
		return fetchSeasonDetail(sid, sn, scope)
	})
	if err != nil {
		log.Printf("Home schedule: skipping tv/%d, season lookup failed: %v", item.ID, err)
		return HomeShowItem{}, false
	}
	if !next.found {
		// Fully watched. The client previously dropped these too: a show with
		// nothing left to watch has no place on a "what's next" screen.
		return HomeShowItem{}, false
	}

	return HomeShowItem{
		Show:              item,
		Episode:           next.episode,
		FormattedDate:     next.episode.AirDate,
		IsNewSeason:       next.episode.EpisodeNumber == 1,
		EpisodesRemaining: next.remaining,
		IsSeasonFinale: next.seasonEpisodes > 0 &&
			next.episode.EpisodeNumber == next.seasonEpisodes,
		Details: MediaDetailsLite{
			ID:           item.ID,
			Status:       status,
			FirstAirDate: firstAirDate,
			Seasons:      next.seasons,
		},
	}, true
}

// resolveMovie loads the fields the Movie cards need. Only runtime and tagline
// are missing from the watchlist row, so the details call is unavoidable but
// is shared across users through the TMDB response cache.
func resolveMovie(item TMDBMedia, scope *callScope) MediaDetailsLite {
	apiKey := os.Getenv("TMDB_API_KEY")

	if apiKey == "dummy" {
		details, ok := getMockMediaDetails("movie", item.ID)
		if !ok {
			details = getFallbackMediaDetails("movie", item.ID)
		}
		return MediaDetailsLite{
			ID:          item.ID,
			Runtime:     details.Runtime,
			Tagline:     details.Tagline,
			Status:      details.Status,
			ReleaseDate: details.ReleaseDate,
		}
	}

	url := fmt.Sprintf("https://api.themoviedb.org/3/movie/%d", item.ID)
	var response tmdbMediaDetailsResponse
	if err := tmdbGet(url, apiKey, &response, scope); err != nil {
		log.Printf("Home schedule: movie/%d details unavailable: %v", item.ID, err)
		return MediaDetailsLite{ID: item.ID, ReleaseDate: item.ReleaseDate}
	}

	return MediaDetailsLite{
		ID:          item.ID,
		Runtime:     response.Runtime,
		Tagline:     response.Tagline,
		Status:      response.Status,
		ReleaseDate: response.ReleaseDate,
	}
}

// dateOnly parses a TMDB "YYYY-MM-DD" string, reporting whether it parsed.
//
// Parsed in the server's local location, not UTC: `time.Parse` yields UTC
// midnight, and for any timezone ahead of UTC that lands *after* local
// midnight today, which would classify an episode airing today as unreleased
// and hide it from the Ready to Watch list.
func dateOnly(value string) (time.Time, bool) {
	if len(value) < 10 {
		return time.Time{}, false
	}
	parsed, err := time.ParseInLocation("2006-01-02", value[:10], time.Local)
	if err != nil {
		return time.Time{}, false
	}
	return parsed, true
}

// isAfterToday reports whether a TMDB date is in the future. Compared against
// local midnight so that something airing today counts as available.
func isAfterToday(value string) bool {
	parsed, ok := dateOnly(value)
	if !ok {
		return false
	}
	now := time.Now()
	today := time.Date(now.Year(), now.Month(), now.Day(), 0, 0, 0, 0, time.Local)
	return parsed.After(today)
}

func handleHomeSchedule(c *gin.Context) {
	userID, ok := c.Get("user_id")
	if !ok {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "Unauthorized"})
		return
	}
	userUID := userID.(uint)

	cachedJSONResponse(c, homeScheduleCacheKey(userUID), homeScheduleCacheTTL, func() (any, bool) {
		return buildHomeSchedule(c, userUID)
	})
}

// buildHomeSchedule does the actual work. It reports ok=false only after writing
// an error response itself.
func buildHomeSchedule(c *gin.Context, userUID uint) (*HomeScheduleResponse, bool) {
	scope := scopeFrom(c)

	var dbItems []WatchlistItem
	if err := db.Where("user_id = ?", userUID).Find(&dbItems).Error; err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to fetch watchlist"})
		return nil, false
	}

	// One pass over the history, grouped by title. Previously each show
	// triggered its own full-history read on the server and a separate
	// watched-status request from the client.
	watchedByMedia := make(map[int64][]WatchedItem)
	watchedMovies := make(map[int64]bool)
	for _, w := range getUserWatched(userUID) {
		if w.MediaType == "movie" {
			watchedMovies[w.MediaID] = true
			continue
		}
		watchedByMedia[w.MediaID] = append(watchedByMedia[w.MediaID], w)
	}

	items := make([]TMDBMedia, 0, len(dbItems))
	for _, dbItem := range dbItems {
		items = append(items, TMDBMedia{
			ID:           dbItem.MediaID,
			Title:        dbItem.Title,
			Name:         dbItem.Name,
			PosterPath:   dbItem.PosterPath,
			BackdropPath: dbItem.BackdropPath,
			VoteAverage:  dbItem.VoteAverage,
			MediaType:    dbItem.MediaType,
			ReleaseDate:  dbItem.ReleaseDate,
			FirstAirDate: dbItem.FirstAirDate,
			CreatedAt:    dbItem.CreatedAt,
		})
	}

	resolvedShows := make([]*HomeShowItem, len(items))
	resolvedMovies := make([]*HomeMovieItem, len(items))

	// Bounded fan-out. Each slot writes only its own index, so no lock is
	// needed beyond the WaitGroup.
	var wg sync.WaitGroup
	sem := make(chan struct{}, tmdbDetailConcurrency)
	for i := range items {
		item := items[i]
		wg.Add(1)
		go func(idx int, it TMDBMedia) {
			defer wg.Done()
			sem <- struct{}{}
			defer func() { <-sem }()

			if watchlistMediaType(it) == "tv" {
				if show, ok := resolveShow(it, watchedByMedia[it.ID], scope); ok {
					resolvedShows[idx] = &show
				}
				return
			}

			if watchedMovies[it.ID] {
				return
			}
			resolvedMovies[idx] = &HomeMovieItem{
				Movie:         it,
				Details:       resolveMovie(it, scope),
				FormattedDate: it.ReleaseDate,
			}
		}(i, item)
	}
	wg.Wait()

	response := HomeScheduleResponse{
		GeneratedAt:    time.Now().UTC(),
		ShowsReady:     []HomeShowItem{},
		ShowsUpcoming:  []HomeShowItem{},
		MoviesReady:    []HomeMovieItem{},
		MoviesUpcoming: []HomeMovieItem{},
	}

	for _, show := range resolvedShows {
		if show == nil {
			continue
		}
		if isAfterToday(show.FormattedDate) {
			response.ShowsUpcoming = append(response.ShowsUpcoming, *show)
		} else {
			response.ShowsReady = append(response.ShowsReady, *show)
		}
	}

	for _, movie := range resolvedMovies {
		if movie == nil {
			continue
		}
		if isAfterToday(movie.FormattedDate) {
			response.MoviesUpcoming = append(response.MoviesUpcoming, *movie)
		} else {
			response.MoviesReady = append(response.MoviesReady, *movie)
		}
	}

	// Ready lists keep the alphabetical order the watchlist endpoint produces;
	// upcoming lists are chronological, which is what the grouped schedule UI
	// assumes.
	sort.SliceStable(response.ShowsReady, func(i, j int) bool {
		return displayTitle(response.ShowsReady[i].Show) < displayTitle(response.ShowsReady[j].Show)
	})
	sort.SliceStable(response.MoviesReady, func(i, j int) bool {
		return displayTitle(response.MoviesReady[i].Movie) < displayTitle(response.MoviesReady[j].Movie)
	})
	sort.SliceStable(response.ShowsUpcoming, func(i, j int) bool {
		return response.ShowsUpcoming[i].FormattedDate < response.ShowsUpcoming[j].FormattedDate
	})
	sort.SliceStable(response.MoviesUpcoming, func(i, j int) bool {
		return response.MoviesUpcoming[i].FormattedDate < response.MoviesUpcoming[j].FormattedDate
	})

	return &response, true
}
