package main

import (
	"errors"
	"testing"
	"time"
)

func season(seasonNumber, episodeCount int64) Season {
	return Season{SeasonNumber: seasonNumber, EpisodeCount: episodeCount}
}

func episode(seasonNumber, episodeNumber int64, airDate string) Episode {
	return Episode{
		ID:            seasonNumber*1000 + episodeNumber,
		Name:          "Episode",
		SeasonNumber:  seasonNumber,
		EpisodeNumber: episodeNumber,
		AirDate:       airDate,
	}
}

func watchedTV(mediaID, seasonNumber, episodeNumber int64) WatchedItem {
	s := seasonNumber
	e := episodeNumber
	return WatchedItem{
		MediaID:       mediaID,
		MediaType:     "tv",
		SeasonNumber:  &s,
		EpisodeNumber: &e,
	}
}

// stubFetcher serves seasons from a map and records which seasons were asked
// for, so tests can assert that fully-watched seasons cost no network call.
func stubFetcher(seasons map[int64][]Episode, calls *[]int64) seasonFetcher {
	return func(_ int64, seasonNum int64) (*SeasonDetails, error) {
		if calls != nil {
			*calls = append(*calls, seasonNum)
		}
		episodes, ok := seasons[seasonNum]
		if !ok {
			return nil, errors.New("season not stubbed")
		}
		return &SeasonDetails{SeasonNumber: seasonNum, Episodes: episodes}, nil
	}
}

func TestResolveNextEpisodeFindsFirstUnwatched(t *testing.T) {
	seasons := []Season{season(1, 3), season(2, 2)}
	episodes := map[int64][]Episode{
		1: {episode(1, 1, "2020-01-01"), episode(1, 2, "2020-01-08"), episode(1, 3, "2020-01-15")},
		2: {episode(2, 1, "2021-01-01"), episode(2, 2, "2021-01-08")},
	}
	watched := []WatchedItem{
		watchedTV(9, 1, 1),
		watchedTV(9, 1, 2),
	}

	result, err := resolveNextEpisode(9, seasons, "Returning Series", watched, stubFetcher(episodes, nil))
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if !result.found {
		t.Fatal("expected an unwatched episode to be found")
	}
	if result.episode.SeasonNumber != 1 || result.episode.EpisodeNumber != 3 {
		t.Fatalf("expected S1E3, got S%dE%d", result.episode.SeasonNumber, result.episode.EpisodeNumber)
	}
}

func TestResolveNextEpisodeSkipsFullyWatchedSeasonsWithoutFetching(t *testing.T) {
	seasons := []Season{season(1, 2), season(2, 3)}
	episodes := map[int64][]Episode{
		2: {episode(2, 1, "2022-01-01"), episode(2, 2, "2022-01-08"), episode(2, 3, "2022-01-15")},
	}
	// Season 1 is complete, so it must never be fetched.
	watched := []WatchedItem{watchedTV(7, 1, 1), watchedTV(7, 1, 2)}

	var calls []int64
	result, err := resolveNextEpisode(7, seasons, "Returning Series", watched, stubFetcher(episodes, &calls))
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if !result.found || result.episode.SeasonNumber != 2 || result.episode.EpisodeNumber != 1 {
		t.Fatalf("expected S2E1, got found=%v S%dE%d", result.found, result.episode.SeasonNumber, result.episode.EpisodeNumber)
	}
	if len(calls) != 1 || calls[0] != 2 {
		t.Fatalf("expected only season 2 to be fetched, got %v", calls)
	}
}

// A season TMDB reports as 0 episodes (announced but unaired) must not be
// treated as fully watched, or the show would vanish from the schedule.
func TestResolveNextEpisodeDoesNotSkipZeroEpisodeSeason(t *testing.T) {
	seasons := []Season{season(1, 2), season(2, 0)}
	episodes := map[int64][]Episode{
		1: {episode(1, 1, "2020-01-01"), episode(1, 2, "2020-01-08")},
		2: {episode(2, 1, "2024-06-01")},
	}
	watched := []WatchedItem{watchedTV(3, 1, 1), watchedTV(3, 1, 2)}

	result, err := resolveNextEpisode(3, seasons, "Returning Series", watched, stubFetcher(episodes, nil))
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if !result.found || result.episode.SeasonNumber != 2 || result.episode.EpisodeNumber != 1 {
		t.Fatalf("expected S2E1 from the zero-count season, got found=%v S%dE%d", result.found, result.episode.SeasonNumber, result.episode.EpisodeNumber)
	}
}

func TestResolveNextEpisodeIgnoresSpecialsAndEpisodeZero(t *testing.T) {
	seasons := []Season{season(0, 5), season(1, 2)}
	episodes := map[int64][]Episode{
		1: {episode(1, 0, "2020-01-01"), episode(1, 1, "2020-01-08"), episode(1, 2, "2020-01-15")},
	}

	result, err := resolveNextEpisode(5, seasons, "Returning Series", nil, stubFetcher(episodes, nil))
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if !result.found || result.episode.EpisodeNumber != 1 {
		t.Fatalf("expected the first real episode (E1), got found=%v E%d", result.found, result.episode.EpisodeNumber)
	}
	for _, s := range result.seasons {
		if s.SeasonNumber == 0 {
			t.Fatal("specials (season 0) must be excluded from the season list")
		}
	}
}

func TestResolveNextEpisodeReportsFullyWatchedShow(t *testing.T) {
	seasons := []Season{season(1, 1)}
	episodes := map[int64][]Episode{}
	watched := []WatchedItem{watchedTV(11, 1, 1)}

	result, err := resolveNextEpisode(11, seasons, "Ended", watched, stubFetcher(episodes, nil))
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if result.found {
		t.Fatalf("expected no next episode, got S%dE%d", result.episode.SeasonNumber, result.episode.EpisodeNumber)
	}
}

func TestResolveNextEpisodeReportsSeasonFinaleCount(t *testing.T) {
	seasons := []Season{season(1, 2)}
	episodes := map[int64][]Episode{
		1: {episode(1, 1, "2020-01-01"), episode(1, 2, "2020-01-08")},
	}
	watched := []WatchedItem{watchedTV(13, 1, 1)}

	result, err := resolveNextEpisode(13, seasons, "Returning Series", watched, stubFetcher(episodes, nil))
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if result.seasonEpisodes != 2 {
		t.Fatalf("expected the season's episode count (2) for the finale badge, got %d", result.seasonEpisodes)
	}
}

func TestTotalEpisodesExcludesSpecials(t *testing.T) {
	got := totalEpisodes([]Season{season(0, 12), season(1, 8), season(2, 4)})
	if got != 12 {
		t.Fatalf("expected 12 regular episodes, got %d", got)
	}
}

func TestClassifyShowProgressCaughtUpWhenReturning(t *testing.T) {
	item := TMDBMedia{ID: 42, Name: "Returning Show", MediaType: "tv"}
	summary := tmdbTVSummary{
		Status:       "Returning Series",
		FirstAirDate: "2015-01-01",
		Seasons:      []Season{season(1, 2)},
	}
	watched := []WatchedItem{watchedTV(42, 1, 1), watchedTV(42, 1, 2)}

	result := classifyShowProgress(item, summary, watched)

	if result.FullyWatchedEnded {
		t.Fatal("a returning show must stay on the watchlist")
	}
	if !result.Lite.CaughtUp {
		t.Fatal("expected caughtUp for a fully watched but returning show")
	}
	if !result.Lite.Released {
		t.Fatal("expected released for a show that started airing")
	}
	if result.Lite.Progress != 1 {
		t.Fatalf("expected progress 1, got %v", result.Lite.Progress)
	}
}

func TestClassifyShowProgressDropsFinishedAndFullyWatched(t *testing.T) {
	item := TMDBMedia{ID: 43, Name: "Ended Show", MediaType: "tv"}
	summary := tmdbTVSummary{
		Status:       "Ended",
		FirstAirDate: "2010-01-01",
		Seasons:      []Season{season(1, 2)},
	}
	watched := []WatchedItem{watchedTV(43, 1, 1), watchedTV(43, 1, 2)}

	result := classifyShowProgress(item, summary, watched)

	if !result.FullyWatchedEnded {
		t.Fatal("expected a fully watched, ended show to be filtered out")
	}
	if result.Lite.CaughtUp {
		t.Fatal("an ended show is not 'caught up', it is finished")
	}
}

func TestClassifyShowProgressCanceledCountsAsFinished(t *testing.T) {
	item := TMDBMedia{ID: 44, MediaType: "tv"}
	summary := tmdbTVSummary{Status: "Canceled", Seasons: []Season{season(1, 1)}}
	watched := []WatchedItem{watchedTV(44, 1, 1)}

	if !classifyShowProgress(item, summary, watched).FullyWatchedEnded {
		t.Fatal("a canceled, fully watched show should be filtered out")
	}
}

func TestClassifyShowProgressNotReleased(t *testing.T) {
	item := TMDBMedia{ID: 45, MediaType: "tv"}
	future := time.Now().AddDate(0, 0, 30).Format("2006-01-02")
	summary := tmdbTVSummary{
		Status:       "Returning Series",
		FirstAirDate: future,
		Seasons:      []Season{season(1, 10)},
	}

	result := classifyShowProgress(item, summary, nil)
	if result.Lite.Released {
		t.Fatal("a show premiering in the future must not count as released")
	}
	if result.Lite.CaughtUp {
		t.Fatal("an unreleased show cannot be caught up")
	}
}

func TestClassifyShowProgressInProductionIsNotReleased(t *testing.T) {
	item := TMDBMedia{ID: 46, MediaType: "tv"}
	summary := tmdbTVSummary{
		Status:       "In Production",
		FirstAirDate: "2019-01-01",
		Seasons:      []Season{season(1, 4)},
	}

	if classifyShowProgress(item, summary, nil).Lite.Released {
		t.Fatal("a show still in production must not count as released")
	}
}

func TestClassifyShowProgressFallsBackToAggregateEpisodeCount(t *testing.T) {
	item := TMDBMedia{ID: 47, MediaType: "tv"}
	summary := tmdbTVSummary{
		Status:           "Returning Series",
		NumberOfEpisodes: 7,
		// No season breakdown available.
	}
	watched := []WatchedItem{watchedTV(47, 1, 1), watchedTV(47, 1, 2)}

	result := classifyShowProgress(item, summary, watched)
	if result.Lite.TotalEpisodes != 7 {
		t.Fatalf("expected the aggregate fallback (7), got %d", result.Lite.TotalEpisodes)
	}
	if result.FullyWatchedEnded {
		t.Fatal("2 of 7 watched is not fully watched")
	}
}

func TestBuildTvProgressCaughtUpMidSeason(t *testing.T) {
	// Episodes 1 and 2 have aired and are watched; episode 3 is still to come.
	// This is the case the detail screen's "Next: 3 days" pill exists for, and
	// it is *not* "fully watched" by the announced-episode definition.
	seasons := []Season{season(1, 3)}
	episodes := map[int64][]Episode{
		1: {
			episode(1, 1, "2024-01-01"),
			episode(1, 2, "2024-01-08"),
			episode(1, 3, time.Now().AddDate(0, 0, 3).Format("2006-01-02")),
		},
	}
	watched := []WatchedItem{watchedTV(55, 1, 1), watchedTV(55, 1, 2)}
	summary := tmdbTVSummary{Status: "Returning Series", FirstAirDate: "2024-01-01", Seasons: seasons}

	got, ok := buildTvProgress(55, watched, summary, stubFetcher(episodes, nil))
	if !ok {
		t.Fatal("expected progress to be built")
	}
	if !got.CaughtUp {
		t.Fatal("expected caught up when the only unwatched episode is still to air")
	}
	if got.NextEpisode == nil || got.NextEpisode.EpisodeNumber != 3 {
		t.Fatalf("expected the next episode to be episode 3, got %+v", got.NextEpisode)
	}
	if got.WatchedEpisodes != 2 || got.TotalEpisodes != 3 {
		t.Fatalf("expected 2/3, got %d/%d", got.WatchedEpisodes, got.TotalEpisodes)
	}
	if !got.Released {
		t.Fatal("expected a show that has started airing to be released")
	}
}

func TestBuildTvProgressBehindScheduleIsNotCaughtUp(t *testing.T) {
	// Episode 2 already aired and was not watched: the user is behind, so no
	// countdown, even though a later episode also exists.
	seasons := []Season{season(1, 3)}
	episodes := map[int64][]Episode{
		1: {
			episode(1, 1, "2024-01-01"),
			episode(1, 2, "2024-01-08"),
			episode(1, 3, time.Now().AddDate(0, 0, 3).Format("2006-01-02")),
		},
	}
	watched := []WatchedItem{watchedTV(56, 1, 1)}
	summary := tmdbTVSummary{Status: "Returning Series", FirstAirDate: "2024-01-01", Seasons: seasons}

	got, ok := buildTvProgress(56, watched, summary, stubFetcher(episodes, nil))
	if !ok {
		t.Fatal("expected progress to be built")
	}
	if got.CaughtUp {
		t.Fatal("an already-aired unwatched episode means the user is behind")
	}
	if got.NextEpisode == nil || got.NextEpisode.EpisodeNumber != 2 {
		t.Fatalf("expected episode 2 as the next episode, got %+v", got.NextEpisode)
	}
}

func TestBuildTvProgressFullyWatchedHasNoNextEpisode(t *testing.T) {
	seasons := []Season{season(1, 2)}
	episodes := map[int64][]Episode{
		1: {episode(1, 1, "2024-01-01"), episode(1, 2, "2024-01-08")},
	}
	watched := []WatchedItem{watchedTV(57, 1, 1), watchedTV(57, 1, 2)}
	summary := tmdbTVSummary{Status: "Ended", FirstAirDate: "2024-01-01", Seasons: seasons}

	got, ok := buildTvProgress(57, watched, summary, stubFetcher(episodes, nil))
	if !ok {
		t.Fatal("expected progress to be built")
	}
	if got.CaughtUp {
		t.Fatal("nothing left to watch is not 'caught up', it is finished")
	}
	if got.NextEpisode != nil {
		t.Fatalf("expected no next episode, got %+v", got.NextEpisode)
	}
	if got.Progress != 1 {
		t.Fatalf("expected progress 1, got %v", got.Progress)
	}
}

func TestBuildTvProgressSkipsFinishedSeasonsWithNoFetch(t *testing.T) {
	seasons := []Season{season(1, 2), season(2, 2)}
	episodes := map[int64][]Episode{
		2: {
			episode(2, 1, "2024-02-01"),
			episode(2, 2, time.Now().AddDate(0, 0, 7).Format("2006-01-02")),
		},
	}
	watched := []WatchedItem{
		watchedTV(58, 1, 1), watchedTV(58, 1, 2), watchedTV(58, 2, 1),
	}
	// Season 1 is not stubbed at all: asking for it would fail the test.
	var calls []int64
	summary := tmdbTVSummary{Status: "Returning Series", FirstAirDate: "2024-01-01", Seasons: seasons}

	got, ok := buildTvProgress(58, watched, summary, stubFetcher(episodes, &calls))
	if !ok {
		t.Fatal("expected progress to be built")
	}
	if len(calls) != 1 || calls[0] != 2 {
		t.Fatalf("expected only season 2 to be fetched, got %v", calls)
	}
	if !got.CaughtUp {
		t.Fatal("expected caught up between seasons")
	}
}

func TestBuildTvProgressUnreleasedShow(t *testing.T) {
	// A planned show with a first episode in the future: not released, and its
	// premiere is not a "next episode" the user is waiting on.
	seasons := []Season{season(1, 1)}
	episodes := map[int64][]Episode{
		1: {episode(1, 1, time.Now().AddDate(0, 0, 30).Format("2006-01-02"))},
	}
	summary := tmdbTVSummary{
		Status:       "In Production",
		FirstAirDate: "2024-01-01",
		Seasons:      seasons,
	}

	got, ok := buildTvProgress(59, nil, summary, stubFetcher(episodes, nil))
	if !ok {
		t.Fatal("expected progress to be built")
	}
	if got.Released {
		t.Fatal("a show still in production must not count as released")
	}
	if got.CaughtUp {
		t.Fatal("an unreleased show cannot be caught up")
	}
}

func TestBuildTvProgressFallsBackToAggregateEpisodeCount(t *testing.T) {
	summary := tmdbTVSummary{Status: "Returning Series", NumberOfEpisodes: 7}

	got, ok := buildTvProgress(60, []WatchedItem{watchedTV(60, 1, 1)}, summary, stubFetcher(nil, nil))
	if !ok {
		t.Fatal("expected progress to be built")
	}
	if got.TotalEpisodes != 7 {
		t.Fatalf("expected the aggregate fallback (7), got %d", got.TotalEpisodes)
	}
}

func TestBuildTvProgressIgnoresRowsWithoutSeasonOrEpisode(t *testing.T) {
	seasons := []Season{season(1, 2)}
	episodes := map[int64][]Episode{
		1: {
			episode(1, 1, "2024-01-01"),
			episode(1, 2, time.Now().AddDate(0, 0, 5).Format("2006-01-02")),
		},
	}
	// A row for the same id with no season/episode must not inflate the count
	// the progress bar draws.
	watched := []WatchedItem{
		watchedTV(61, 1, 1),
		{MediaID: 61, MediaType: "tv"},
	}
	summary := tmdbTVSummary{Status: "Returning Series", FirstAirDate: "2024-01-01", Seasons: seasons}

	got, ok := buildTvProgress(61, watched, summary, stubFetcher(episodes, nil))
	if !ok {
		t.Fatal("expected progress to be built")
	}
	if got.WatchedEpisodes != 1 {
		t.Fatalf("expected 1 watched episode, got %d", got.WatchedEpisodes)
	}
}

func TestBuildTvProgressReportsFailureOnSeasonError(t *testing.T) {
	seasons := []Season{season(1, 2)}
	// No seasons stubbed: the fetcher errors, which must be reported as "no
	// progress" rather than as an empty payload.
	summary := tmdbTVSummary{Status: "Returning Series", FirstAirDate: "2024-01-01", Seasons: seasons}

	if _, ok := buildTvProgress(62, nil, summary, stubFetcher(nil, nil)); ok {
		t.Fatal("expected a season lookup failure to be reported")
	}
}

func TestIsAfterToday(t *testing.T) {
	today := time.Now()
	tomorrow := today.AddDate(0, 0, 1).Format("2006-01-02")
	yesterday := today.AddDate(0, 0, -1).Format("2006-01-02")
	todayStr := today.Format("2006-01-02")

	cases := []struct {
		name  string
		value string
		want  bool
	}{
		{"tomorrow", tomorrow, true},
		{"yesterday", yesterday, false},
		{"today counts as available", todayStr, false},
		{"empty", "", false},
		{"unparseable", "not-a-date", false},
		{"partial", "2024-13", false},
	}

	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			if got := isAfterToday(tc.value); got != tc.want {
				t.Fatalf("isAfterToday(%q) = %v, want %v", tc.value, got, tc.want)
			}
		})
	}
}

func TestIsMovieFullyWatched(t *testing.T) {
	movie := TMDBMedia{ID: 100, MediaType: "movie"}
	watched := []WatchedItem{{MediaID: 100, MediaType: "movie"}}

	if !isMovieFullyWatched(movie, watched) {
		t.Fatal("expected the movie to be reported as watched")
	}
	if isMovieFullyWatched(TMDBMedia{ID: 101, MediaType: "movie"}, watched) {
		t.Fatal("a different movie must not be reported as watched")
	}
	if isMovieFullyWatched(movie, nil) {
		t.Fatal("an empty history must not report anything as watched")
	}
}
