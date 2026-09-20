package main

import "testing"

func poster(path, lang string, votes float64) Image {
	return Image{FilePath: path, Iso6391: lang, VoteAverage: votes}
}

func TestTopPostersRanksByVoteAndCapsCount(t *testing.T) {
	posters := []Image{
		poster("/a.jpg", "en", 5.4),
		poster("/b.jpg", "en", 7.9),
		poster("/c.jpg", "", 6.1),
		poster("/d.jpg", "en", 8.2),
	}

	got := topPosters(posters, 3)

	if len(got) != 3 {
		t.Fatalf("expected 3 posters, got %d", len(got))
	}
	// Language-neutral art ("" ) competes with English art on equal terms.
	for i, path := range []string{"/d.jpg", "/b.jpg", "/c.jpg"} {
		if got[i].FilePath != path {
			t.Errorf("poster %d: want %s, got %s", i, path, got[i].FilePath)
		}
	}
}

func TestTopPostersDropsOtherLanguagesAndEmptyPaths(t *testing.T) {
	// A better-rated French poster must still lose: the details request asks
	// TMDB for `include_image_language=en,null`, so anything else is artwork
	// that could not be localised for the hero.
	posters := []Image{
		poster("/fr.jpg", "fr", 9.9),
		poster("", "en", 9.5),
		poster("/keep.jpg", "en", 4.0),
	}

	got := topPosters(posters, 3)

	if len(got) != 1 || got[0].FilePath != "/keep.jpg" {
		t.Fatalf("expected only /keep.jpg, got %+v", got)
	}
}

func TestTopPostersReturnsNilWhenNothingUsable(t *testing.T) {
	// The client treats a missing list as "no alternate available" and falls
	// back to `poster_path`, so an empty result must be nil rather than an
	// empty-but-present slice.
	if got := topPosters(nil, 3); got != nil {
		t.Errorf("expected nil for an empty payload, got %+v", got)
	}
	if got := topPosters([]Image{poster("/fr.jpg", "fr", 9.9)}, 3); got != nil {
		t.Errorf("expected nil when every entry is filtered out, got %+v", got)
	}
}
