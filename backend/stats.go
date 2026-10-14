package main

import (
	"sort"
	"time"
)

// calculateStreakGo reports the user's current daily watch streak.
//
// Kept as the entry point the tests exercise; it delegates to
// calculateStreakFromDates so the SQL-backed profile path and the in-memory
// path cannot drift apart.
func calculateStreakGo(watched []WatchedItem) int {
	dates := make([]string, 0, len(watched))
	for _, item := range watched {
		if !item.WatchedAt.IsZero() {
			dates = append(dates, item.WatchedAt.Format("2006-01-02"))
		}
	}
	return calculateStreakFromDates(dates)
}

// calculateStreakFromDates is the streak rule over "YYYY-MM-DD" dates, which is
// all the streak actually depends on.
//
// Taking dates rather than whole rows is what lets the profile endpoint compute
// this from a `SELECT DISTINCT date(watched_at)` instead of loading the user's
// entire watch history into memory to count days.
func calculateStreakFromDates(dates []string) int {
	if len(dates) == 0 {
		return 0
	}

	// Unique dates, descending.
	dateSet := make(map[string]struct{}, len(dates))
	for _, date := range dates {
		if date != "" {
			dateSet[date] = struct{}{}
		}
	}
	if len(dateSet) == 0 {
		return 0
	}

	uniqueDates := make([]string, 0, len(dateSet))
	for date := range dateSet {
		uniqueDates = append(uniqueDates, date)
	}
	sort.Sort(sort.Reverse(sort.StringSlice(uniqueDates)))

	now := time.Now()
	todayStr := now.Format("2006-01-02")
	yesterdayStr := now.AddDate(0, 0, -1).Format("2006-01-02")

	mostRecent := uniqueDates[0]
	if mostRecent != todayStr && mostRecent != yesterdayStr {
		return 0
	}

	streak := 1
	currentDate, _ := time.Parse("2006-01-02", mostRecent)

	for i := 1; i < len(uniqueDates); i++ {
		nextDate, _ := time.Parse("2006-01-02", uniqueDates[i])
		diff := currentDate.Sub(nextDate)
		diffDays := int(diff.Hours() / 24)

		if diffDays == 1 {
			streak++
			currentDate = nextDate
		} else if diffDays > 1 {
			break
		}
	}

	return streak
}
