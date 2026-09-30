package main

import "testing"

func releaseEntry(cert string, releaseType int) tmdbReleaseDateInfo {
	return tmdbReleaseDateInfo{Certification: cert, Type: releaseType}
}

func releaseRegion(country string, dates ...tmdbReleaseDateInfo) tmdbReleaseDatesResult {
	return tmdbReleaseDatesResult{Iso3166_1: country, ReleaseDates: dates}
}

func TestExtractCertificationPrefersUsTheatrical(t *testing.T) {
	// The US entry lists unrated premieres before the actual rating, and a UK
	// rating that is preferable on its own must still lose to the US one.
	response := tmdbMediaDetailsResponse{
		ReleaseDates: tmdbReleaseDatesResponse{Results: []tmdbReleaseDatesResult{
			releaseRegion("GB", releaseEntry("15", 3)),
			releaseRegion("US",
				releaseEntry("", 1),
				releaseEntry("", 1),
				releaseEntry("", 1),
				releaseEntry("PG-13", 3),
				releaseEntry("PG-13", 4),
			),
		}},
	}

	if got := extractCertification("movie", response); got != "PG-13" {
		t.Fatalf("want the US theatrical rating PG-13, got %q", got)
	}
}

func TestExtractCertificationFallsBackThroughReleaseTypes(t *testing.T) {
	// An unrated theatrical entry must not shadow a rated digital one. The
	// empty-string check is what stops "no rating" being reported as a rating,
	// which would put a blank badge on the detail screen.
	response := tmdbMediaDetailsResponse{
		ReleaseDates: tmdbReleaseDatesResponse{Results: []tmdbReleaseDatesResult{
			releaseRegion("US", releaseEntry("", 3), releaseEntry("R", 4)),
		}},
	}

	if got := extractCertification("movie", response); got != "R" {
		t.Fatalf("want R, got %q", got)
	}
}

func TestExtractCertificationFallsBackThroughRegions(t *testing.T) {
	// Region preference beats TMDB's own ordering: Canada is preferred over a
	// region that is not in the list, whichever order TMDB returns them in.
	preferred := tmdbMediaDetailsResponse{
		ReleaseDates: tmdbReleaseDatesResponse{Results: []tmdbReleaseDatesResult{
			releaseRegion("BG", releaseEntry("c", 3)),
			releaseRegion("CA", releaseEntry("14A", 3)),
		}},
	}
	if got := extractCertification("movie", preferred); got != "14A" {
		t.Fatalf("want the preferred region's rating 14A, got %q", got)
	}

	// Nothing from the preferred list at all: the first rated region TMDB
	// returns is still better than no badge.
	unlisted := tmdbMediaDetailsResponse{
		ReleaseDates: tmdbReleaseDatesResponse{Results: []tmdbReleaseDatesResult{
			releaseRegion("MY", releaseEntry("18PL", 3)),
		}},
	}
	if got := extractCertification("movie", unlisted); got != "18PL" {
		t.Fatalf("want the only available rating 18PL, got %q", got)
	}
}

func TestExtractCertificationReturnsEmptyWhenNothingUsable(t *testing.T) {
	// The client hides the badge on an empty string, so "" must be the result
	// rather than a placeholder.
	unrated := tmdbMediaDetailsResponse{
		ReleaseDates: tmdbReleaseDatesResponse{Results: []tmdbReleaseDatesResult{
			releaseRegion("US", releaseEntry("", 3)),
		}},
	}
	if got := extractCertification("movie", unrated); got != "" {
		t.Fatalf("expected no certification, got %q", got)
	}
	if got := extractCertification("movie", tmdbMediaDetailsResponse{}); got != "" {
		t.Fatalf("expected no certification for an empty response, got %q", got)
	}
}

func TestExtractCertificationReadsTvContentRatings(t *testing.T) {
	response := tmdbMediaDetailsResponse{
		ContentRatings: tmdbContentRatingsResponse{Results: []tmdbContentRating{
			{Iso3166_1: "DE", Rating: "16"},
			{Iso3166_1: "US", Rating: "TV-MA"},
		}},
	}
	if got := extractCertification("tv", response); got != "TV-MA" {
		t.Fatalf("want TV-MA, got %q", got)
	}

	regional := tmdbMediaDetailsResponse{
		ContentRatings: tmdbContentRatingsResponse{Results: []tmdbContentRating{
			{Iso3166_1: "KR", Rating: "19"},
		}},
	}
	if got := extractCertification("tv", regional); got != "19" {
		t.Fatalf("want the only available TV rating 19, got %q", got)
	}
}

func TestExtractCertificationIgnoresTheOtherMediaType(t *testing.T) {
	// TMDB ignores an append from the other namespace rather than erroring, so
	// the decoder cannot be relied on to keep the datasets apart. Reading the
	// wrong one would label a show with a film rating.
	movieOnly := tmdbMediaDetailsResponse{
		ReleaseDates: tmdbReleaseDatesResponse{Results: []tmdbReleaseDatesResult{
			releaseRegion("US", releaseEntry("PG-13", 3)),
		}},
	}
	if got := extractCertification("tv", movieOnly); got != "" {
		t.Fatalf("expected TV to ignore release dates, got %q", got)
	}

	tvOnly := tmdbMediaDetailsResponse{
		ContentRatings: tmdbContentRatingsResponse{Results: []tmdbContentRating{
			{Iso3166_1: "US", Rating: "TV-14"},
		}},
	}
	if got := extractCertification("movie", tvOnly); got != "" {
		t.Fatalf("expected movies to ignore content ratings, got %q", got)
	}
}

func relatedItem(id int64, poster, backdrop string) TMDBMedia {
	return TMDBMedia{ID: id, Title: "Item", PosterPath: poster, BackdropPath: backdrop}
}

func TestRelatedMediaDropsSelfAndArtworklessEntries(t *testing.T) {
	items := []TMDBMedia{
		relatedItem(1, "/one.jpg", ""),
		relatedItem(2, "", ""),
		relatedItem(3, "/self.jpg", ""),
		relatedItem(4, "", "/backdrop-only.jpg"),
	}

	got := relatedMedia(items, "movie", 3, 12)

	if len(got) != 2 {
		t.Fatalf("want 2 usable entries, got %d (%+v)", len(got), got)
	}
	if got[0].ID != 1 || got[1].ID != 4 {
		t.Fatalf("want entries 1 and 4 in order, got %d and %d", got[0].ID, got[1].ID)
	}
	// `/similar` omits media_type, so the parent's type is forced on every card.
	for _, item := range got {
		if item.MediaType != "movie" {
			t.Errorf("item %d: want media type movie, got %q", item.ID, item.MediaType)
		}
	}
}

func TestRelatedMediaCapsCountAndReturnsNilWhenEmpty(t *testing.T) {
	items := make([]TMDBMedia, 0, 20)
	for id := int64(1); id <= 20; id++ {
		items = append(items, relatedItem(id, "/poster.jpg", ""))
	}

	if got := relatedMedia(items, "tv", 0, 12); len(got) != 12 {
		t.Fatalf("want the list capped at 12, got %d", len(got))
	}
	// A missing row is a nil slice, not an empty one, so the client hides the
	// section instead of rendering a titled row with nothing under it.
	if got := relatedMedia(nil, "movie", 1, 12); got != nil {
		t.Fatalf("want nil for an empty payload, got %+v", got)
	}
	if got := relatedMedia([]TMDBMedia{relatedItem(1, "/p.jpg", "")}, "movie", 1, 12); got != nil {
		t.Fatalf("want nil when the only entry is the title itself, got %+v", got)
	}
}

func TestTrimCollectionPartsOrdersByReleaseDate(t *testing.T) {
	parts := []TMDBMedia{
		{ID: 3, Title: "Third", PosterPath: "/3.jpg", ReleaseDate: "2013-01-01"},
		{ID: 2, Title: "Second", PosterPath: "/2.jpg", ReleaseDate: "2005-05-01"},
		{ID: 9, Title: "Undated", PosterPath: "/9.jpg"},
		{ID: 4, Title: "NoArt"},
	}

	got := trimCollectionParts(parts, 30)

	want := []int64{2, 3, 9}
	if len(got) != len(want) {
		t.Fatalf("want %d parts, got %d (%+v)", len(want), len(got), got)
	}
	for i, id := range want {
		if got[i].ID != id {
			t.Errorf("part %d: want id %d, got %d", i, id, got[i].ID)
		}
		// TMDB's collection parts are movies, but the type is forced so the
		// client's cards and navigation cannot mislabel one.
		if got[i].MediaType != "movie" {
			t.Errorf("part %d: want media type movie, got %q", i, got[i].MediaType)
		}
	}
}

func TestTrimCollectionPartsCapsAndHandlesEmptyInput(t *testing.T) {
	parts := make([]TMDBMedia, 0, 40)
	for id := int64(1); id <= 40; id++ {
		parts = append(parts, TMDBMedia{ID: id, PosterPath: "/p.jpg", ReleaseDate: "2001-01-01"})
	}

	if got := trimCollectionParts(parts, 30); len(got) != 30 {
		t.Fatalf("want the list capped at 30, got %d", len(got))
	}
	if got := trimCollectionParts(nil, 30); got != nil {
		t.Fatalf("want nil for an empty collection, got %+v", got)
	}
	if got := trimCollectionParts([]TMDBMedia{{ID: 1}}, 30); got != nil {
		t.Fatalf("want nil when every part lacks artwork, got %+v", got)
	}
}
