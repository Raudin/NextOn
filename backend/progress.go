package main

import (
	"fmt"
	"os"
	"strings"
)

// This file owns the "how far through is this show" calculation.
//
// It previously lived in three places that disagreed with each other: the
// watchlist screen computed progress from the season list, the backend's
// "fully watched" filter used TMDB's `number_of_episodes` (which includes
// specials), and the Home screen recomputed a third variation while resolving
// the next episode. The client also had to issue two requests per show to get
// the inputs. Consolidating here means the filter, the progress bar and the
// schedule all agree, and the client needs no per-show requests at all.

// ShowProgressLite is the per-show progress a list row needs to render a
// progress bar and a status pill.
type ShowProgressLite struct {
	WatchedEpisodes int64   `json:"watched_episodes"`
	TotalEpisodes   int64   `json:"total_episodes"`
	Progress        float64 `json:"progress"`
	// Released is false while a show has not started airing yet.
	Released bool `json:"released"`
	// CaughtUp means everything aired so far has been watched but the show is
	// still returning. Those stay on the watchlist; shows that are fully
	// watched *and* finished airing are dropped by the filter instead.
	CaughtUp bool `json:"caught_up"`
}

// showProgressResult pairs the client-facing progress with the internal
// "finished and fully watched" verdict used by the watchlist filter.
type showProgressResult struct {
	Lite              ShowProgressLite
	FullyWatchedEnded bool
}

// TvProgressLite is the media-detail screen's progress: how much of the show
// has been watched plus the first episode that has not.
//
// CaughtUp here means "nothing that has already aired is left unwatched", which
// is deliberately different from ShowProgressLite.CaughtUp (fully watched among
// *announced* episodes). A user who is up to date mid-season still has
// announced-but-unaired episodes outstanding, yet they are caught up in every
// sense that matters to the detail screen's "Next: 3 days" pill, and that pill
// is exactly what this payload exists to drive.
type TvProgressLite struct {
	WatchedEpisodes int64   `json:"watched_episodes"`
	TotalEpisodes   int64   `json:"total_episodes"`
	Progress        float64 `json:"progress"`
	// Released is false while a show has not started airing yet.
	Released bool `json:"released"`
	// CaughtUp is true when the first unwatched episode has not aired yet.
	CaughtUp bool `json:"caught_up"`
	// NextEpisode is the first unwatched episode, in season/episode order,
	// whenever one was found -- even when it has already aired, so a client can
	// offer "continue watching" without another round trip.
	NextEpisode *Episode `json:"next_episode,omitempty"`
}

// buildTvProgress resolves the next unwatched episode for one show and turns it
// into the detail screen's progress payload.
//
// It reuses resolveNextEpisode, so seasons the user has finished cost no season
// fetch at all: a caught-up viewer triggers at most the one season that still
// has an unwatched episode.
//
// It reports ok=false when the season lookup fails, so the status endpoint can
// still answer with the user's watched rows rather than failing a request whose
// primary job is reporting local state.
func buildTvProgress(seriesID int64, watched []WatchedItem, summary tmdbTVSummary, fetch seasonFetcher) (TvProgressLite, bool) {
	next, err := resolveNextEpisode(seriesID, summary.Seasons, summary.Status, watched, fetch)
	if err != nil {
		return TvProgressLite{}, false
	}

	total := totalEpisodes(summary.Seasons)
	if total == 0 {
		// Season data can be missing for brand-new or obscure titles; fall back
		// to TMDB's own aggregate rather than reporting a 0-episode show.
		total = summary.NumberOfEpisodes
	}

	// Count only rows the endpoint actually reports as watched episodes: a
	// season/episode-less row would otherwise inflate the count the bar draws.
	var watchedCount int64
	for _, w := range watched {
		if w.SeasonNumber != nil && w.EpisodeNumber != nil && *w.EpisodeNumber >= 1 {
			watchedCount++
		}
	}

	var ratio float64
	if total > 0 {
		ratio = float64(watchedCount) / float64(total)
	}

	// A show that has not started airing is never "caught up": its first
	// episode is unwatched and in the future, which would otherwise satisfy the
	// next-episode test and put a countdown on a title nobody has been able to
	// watch yet.
	released := !isNotYetReleased(summary.Status, summary.FirstAirDate)

	out := TvProgressLite{
		WatchedEpisodes: watchedCount,
		TotalEpisodes:   total,
		Progress:        ratio,
		Released:        released,
		CaughtUp:        released && next.found && isAfterToday(next.episode.AirDate),
	}
	if next.found {
		episode := next.episode
		out.NextEpisode = &episode
	}

	return out, true
}

// fetchTVSummary reads the trimmed TMDB series record. A single call provides
// the season list, the aggregate episode count, the airing status and the
// first air date — everything this file and the Home schedule need.
func fetchTVSummary(seriesID int64, scope *callScope) (tmdbTVSummary, bool) {
	apiKey := os.Getenv("TMDB_API_KEY")
	if apiKey == "dummy" {
		details, ok := getMockMediaDetails("tv", seriesID)
		if !ok {
			details = getFallbackMediaDetails("tv", seriesID)
		}
		return tmdbTVSummary{
			NumberOfEpisodes: int64(len(details.Seasons)),
			Status:           details.Status,
			FirstAirDate:     details.FirstAirDate,
			Seasons:          details.Seasons,
		}, true
	}

	url := fmt.Sprintf("https://api.themoviedb.org/3/tv/%d", seriesID)
	var summary tmdbTVSummary
	if err := tmdbGet(url, apiKey, &summary, scope); err != nil {
		return tmdbTVSummary{}, false
	}
	return summary, true
}

// totalEpisodes sums regular-season episode counts. Season 0 (specials) is
// excluded because the app never lets a user mark a special as watched, so
// counting them would make 100% unreachable.
func totalEpisodes(seasons []Season) int64 {
	var total int64
	for _, season := range seasons {
		if season.SeasonNumber >= 1 {
			total += season.EpisodeCount
		}
	}
	return total
}

// isNotYetReleased reports whether a show has not started airing. TMDB's
// free-text status catches shows whose first_air_date is stale or missing.
func isNotYetReleased(status, firstAirDate string) bool {
	if isAfterToday(firstAirDate) {
		return true
	}
	normalized := strings.ToLower(status)
	return strings.Contains(normalized, "planned") ||
		strings.Contains(normalized, "in production") ||
		strings.Contains(normalized, "rumored")
}

// hasFinishedAiring reports whether a show has stopped producing episodes.
func hasFinishedAiring(status string) bool {
	normalized := strings.ToLower(status)
	return strings.Contains(normalized, "ended") ||
		strings.Contains(normalized, "cancel")
}

// computeShowProgress derives progress from one TMDB summary and the caller's
// already-loaded watched rows for this series.
//
// `watched` must be pre-filtered to this media id: the caller loads the user's
// history once and slices it per show, instead of the previous behaviour where
// every show triggered its own full-history query.
func computeShowProgress(item TMDBMedia, watched []WatchedItem, scope *callScope) (showProgressResult, bool) {
	summary, ok := fetchTVSummary(item.ID, scope)
	if !ok {
		return showProgressResult{}, false
	}
	return classifyShowProgress(item, summary, watched), true
}

// classifyShowProgress is the pure half of computeShowProgress, split out so
// the progress and "finished" rules can be tested without a network stub.
func classifyShowProgress(item TMDBMedia, summary tmdbTVSummary, watched []WatchedItem) showProgressResult {
	total := totalEpisodes(summary.Seasons)
	if total == 0 {
		// Season data can be missing for brand-new or obscure titles; fall back
		// to TMDB's own aggregate rather than reporting a 0-episode show.
		total = summary.NumberOfEpisodes
	}

	var watchedCount int64
	for _, w := range watched {
		if w.MediaType == "tv" && w.MediaID == item.ID {
			watchedCount++
		}
	}

	firstAirDate := summary.FirstAirDate
	if firstAirDate == "" {
		firstAirDate = item.FirstAirDate
	}

	notYetReleased := isNotYetReleased(summary.Status, firstAirDate)
	fullyWatched := total > 0 && watchedCount >= total
	finished := hasFinishedAiring(summary.Status)

	var ratio float64
	if total > 0 {
		ratio = float64(watchedCount) / float64(total)
	}

	return showProgressResult{
		Lite: ShowProgressLite{
			WatchedEpisodes: watchedCount,
			TotalEpisodes:   total,
			Progress:        ratio,
			Released:        !notYetReleased,
			CaughtUp:        !notYetReleased && fullyWatched && !finished,
		},
		// A finished show with nothing left to watch no longer belongs on a
		// "what to watch" list; a still-returning one does.
		FullyWatchedEnded: fullyWatched && finished,
	}
}
