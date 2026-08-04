package main

import (
	"sort"
	"time"
)

func calculateStreakGo(watched []WatchedItem) int {
	if len(watched) == 0 {
		return 0
	}

	// Extract unique date strings "YYYY-MM-DD"
	dateMap := make(map[string]bool)
	for _, item := range watched {
		if !item.WatchedAt.IsZero() {
			dateStr := item.WatchedAt.Format("2006-01-02")
			dateMap[dateStr] = true
		}
	}

	if len(dateMap) == 0 {
		return 0
	}

	// Sort dates in descending order
	var uniqueDates []string
	for d := range dateMap {
		uniqueDates = append(uniqueDates, d)
	}
	sort.Slice(uniqueDates, func(i, j int) bool {
		return uniqueDates[i] > uniqueDates[j]
	})

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
