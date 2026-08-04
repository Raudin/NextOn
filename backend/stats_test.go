package main

import (
	"testing"
	"time"
)

func TestCalculateStreakGo(t *testing.T) {
	// Case 1: Empty watch history
	if streak := calculateStreakGo([]WatchedItem{}); streak != 0 {
		t.Errorf("Expected streak to be 0 for empty history, got %d", streak)
	}

	// Helper to generate a date relative to today
	dateOffset := func(days int) time.Time {
		return time.Now().AddDate(0, 0, days)
	}

	// Case 2: Only watched today
	historyToday := []WatchedItem{
		{WatchedAt: dateOffset(0)},
	}
	if streak := calculateStreakGo(historyToday); streak != 1 {
		t.Errorf("Expected streak to be 1 for today, got %d", streak)
	}

	// Case 3: Only watched yesterday
	historyYesterday := []WatchedItem{
		{WatchedAt: dateOffset(-1)},
	}
	if streak := calculateStreakGo(historyYesterday); streak != 1 {
		t.Errorf("Expected streak to be 1 for yesterday, got %d", streak)
	}

	// Case 4: Watched 3 days ago (not consecutive to today/yesterday)
	historyGap := []WatchedItem{
		{WatchedAt: dateOffset(-3)},
	}
	if streak := calculateStreakGo(historyGap); streak != 0 {
		t.Errorf("Expected streak to be 0 for gap history, got %d", streak)
	}

	// Case 5: 3 consecutive days (today, yesterday, day before)
	consecutive3Days := []WatchedItem{
		{WatchedAt: dateOffset(0)},
		{WatchedAt: dateOffset(-1)},
		{WatchedAt: dateOffset(-2)},
	}
	if streak := calculateStreakGo(consecutive3Days); streak != 3 {
		t.Errorf("Expected streak to be 3, got %d", streak)
	}

	// Case 6: Duplicated dates on same day shouldn't count multiple times
	duplicatedSameDay := []WatchedItem{
		{WatchedAt: dateOffset(0)},
		{WatchedAt: dateOffset(0)},
		{WatchedAt: dateOffset(-1)},
		{WatchedAt: dateOffset(-1)},
	}
	if streak := calculateStreakGo(duplicatedSameDay); streak != 2 {
		t.Errorf("Expected streak to be 2 with duplicated dates, got %d", streak)
	}

	// Case 7: Gap in streak (today, yesterday, but then a gap and another date)
	gapInStreak := []WatchedItem{
		{WatchedAt: dateOffset(0)},
		{WatchedAt: dateOffset(-1)},
		{WatchedAt: dateOffset(-3)}, // gap on day -2
		{WatchedAt: dateOffset(-4)},
	}
	if streak := calculateStreakGo(gapInStreak); streak != 2 {
		t.Errorf("Expected streak to be 2 due to gap on day -2, got %d", streak)
	}
}
