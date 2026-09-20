package main

import (
	"context"
	"testing"
	"time"
)

func TestTokenBucketAllowsBurstThenRefuses(t *testing.T) {
	// 1 token/sec with a burst of 3: three immediate takes, then a refusal
	// because the wait for the fourth exceeds maxWait.
	bucket := newTokenBucket(1, 3)
	ctx := context.Background()

	for i := 0; i < 3; i++ {
		if !bucket.take(ctx, 10*time.Millisecond) {
			t.Fatalf("take %d should have succeeded from the initial burst", i+1)
		}
	}

	if bucket.take(ctx, 10*time.Millisecond) {
		t.Fatal("the fourth take should have been refused with a 10ms budget")
	}
}

func TestTokenBucketRefills(t *testing.T) {
	// 100 tokens/sec: the bucket refills fast enough to satisfy a wait.
	bucket := newTokenBucket(100, 1)
	ctx := context.Background()

	if !bucket.take(ctx, 50*time.Millisecond) {
		t.Fatal("the initial token should be available")
	}
	if !bucket.take(ctx, 500*time.Millisecond) {
		t.Fatal("expected a token to refill within the wait budget")
	}
}

func TestTokenBucketRespectsCancelledContext(t *testing.T) {
	bucket := newTokenBucket(0.001, 1)
	ctx := context.Background()

	if !bucket.take(ctx, time.Second) {
		t.Fatal("the initial token should be available")
	}

	cancelled, cancel := context.WithCancel(context.Background())
	cancel()

	started := time.Now()
	if bucket.take(cancelled, 30*time.Second) {
		t.Fatal("a cancelled context must not yield a token")
	}
	if elapsed := time.Since(started); elapsed > 500*time.Millisecond {
		t.Fatalf("cancellation should return promptly, took %v", elapsed)
	}
}

func TestEpisodeKeyIsStableAndUnambiguous(t *testing.T) {
	// The key format must not collide across media ids: "1:23:4" and "12:3:4"
	// have to stay distinct because both are plausible real values.
	a := episodeKey(1, 23, 4)
	b := episodeKey(12, 3, 4)
	if a == b {
		t.Fatalf("episode keys collided: %q", a)
	}
	if a != "1:23:4" {
		t.Fatalf("unexpected key format: %q", a)
	}
}

func TestIsUnreleasedFromLookupUsesResolvedDates(t *testing.T) {
	future := time.Now().AddDate(0, 0, 7).Format("2006-01-02")
	past := time.Now().AddDate(0, 0, -7).Format("2006-01-02")

	season := int64(2)
	episodeAirDates := map[string]string{
		episodeKey(50, 2, 5): future,
		episodeKey(50, 2, 6): past,
	}
	movieReleaseDates := map[int64]string{
		70: future,
		71: past,
	}

	cases := []struct {
		name string
		item WatchedItem
		want bool
	}{
		{
			name: "future episode is unreleased",
			item: WatchedItem{MediaID: 50, MediaType: "tv", SeasonNumber: &season, EpisodeNumber: ptrInt64(5)},
			want: true,
		},
		{
			name: "past episode is released",
			item: WatchedItem{MediaID: 50, MediaType: "tv", SeasonNumber: &season, EpisodeNumber: ptrInt64(6)},
			want: false,
		},
		{
			name: "unknown episode is treated as released",
			item: WatchedItem{MediaID: 50, MediaType: "tv", SeasonNumber: &season, EpisodeNumber: ptrInt64(99)},
			want: false,
		},
		{
			name: "future movie is unreleased",
			item: WatchedItem{MediaID: 70, MediaType: "movie"},
			want: true,
		},
		{
			name: "released movie is watchable",
			item: WatchedItem{MediaID: 71, MediaType: "movie"},
			want: false,
		},
		{
			name: "tv without season data is not blocked",
			item: WatchedItem{MediaID: 50, MediaType: "tv"},
			want: false,
		},
	}

	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			item := tc.item
			if got := isUnreleasedFromLookup(&item, episodeAirDates, movieReleaseDates); got != tc.want {
				t.Fatalf("got %v, want %v", got, tc.want)
			}
		})
	}
}

func ptrInt64(v int64) *int64 { return &v }
