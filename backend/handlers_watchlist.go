package main

import (
	"net/http"
	"sort"
	"sync"
	"time"

	"github.com/gin-gonic/gin"
)

func handleAddWatchlist(c *gin.Context) {
	userID, ok := c.Get("user_id")
	if !ok {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "Unauthorized"})
		return
	}
	userUID := userID.(uint)

	var item TMDBMedia
	if err := c.ShouldBindJSON(&item); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Invalid media payload"})
		return
	}
	if item.ID == 0 {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Media id is required"})
		return
	}

	var existing WatchlistItem
	if err := db.Where("user_id = ? AND media_id = ?", userUID, item.ID).First(&existing).Error; err == nil {
		// Already present. Still record an upsert so a client that is behind
		// converges on the current state.
		recordSyncOp(userUID, syncCollectionWatchlist, syncOpUpsert,
			watchlistEntityKey(existing.MediaType, item.ID), existing)
		c.JSON(http.StatusOK, existing)
		return
	}

	watchItem := WatchlistItem{
		UserID:       userUID,
		MediaID:      item.ID,
		Title:        item.Title,
		Name:         item.Name,
		PosterPath:   item.PosterPath,
		BackdropPath: item.BackdropPath,
		VoteAverage:  item.VoteAverage,
		MediaType:    item.MediaType,
		ReleaseDate:  item.ReleaseDate,
		FirstAirDate: item.FirstAirDate,
		CreatedAt:    time.Now(),
	}

	if err := db.Create(&watchItem).Error; err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to add to watchlist"})
		return
	}

	invalidateUserCaches(userUID)
	recordSyncOp(userUID, syncCollectionWatchlist, syncOpUpsert,
		watchlistEntityKey(watchItem.MediaType, item.ID), watchItem)
	c.JSON(http.StatusCreated, item)
}

// WatchlistEntry is a watchlist row plus, when requested, the show's progress.
// TMDBMedia is embedded anonymously so the JSON is the media object the client
// already understands, with a `progress` object added for TV entries.
type WatchlistEntry struct {
	TMDBMedia
	Progress *ShowProgressLite `json:"progress,omitempty"`
}

// WatchlistResponse is returned only when `include=progress` is requested.
// Without it the endpoint keeps returning a bare array, so the Discover screen
// (which only needs ids) is unaffected.
type WatchlistResponse struct {
	GeneratedAt time.Time        `json:"generated_at"`
	Items       []WatchlistEntry `json:"items"`
}

func handleGetWatchlist(c *gin.Context) {
	userID, ok := c.Get("user_id")
	if !ok {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "Unauthorized"})
		return
	}
	userUID := userID.(uint)

	filterWatched := c.Query("filter_watched") == "true"
	includeProgress := c.Query("include") == "progress"

	cachedJSONResponse(c, watchlistCacheKey(userUID, filterWatched, includeProgress), watchlistCacheTTL, func() (any, bool) {
		return buildWatchlist(c, userUID, filterWatched, includeProgress)
	})
}

// buildWatchlist does the actual work. It reports ok=false only after writing an
// error response itself.
func buildWatchlist(c *gin.Context, userUID uint, filterWatched, includeProgress bool) (any, bool) {
	scope := scopeFrom(c)

	var dbItems []WatchlistItem
	if err := db.Where("user_id = ?", userUID).Find(&dbItems).Error; err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to fetch watchlist"})
		return nil, false
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

	// One history read for the whole request, sliced per show below. Both the
	// filter and the progress report need it, and it used to be re-queried per
	// watchlist entry.
	var watched []WatchedItem
	if filterWatched || includeProgress {
		watched = getUserWatched(userUID)
	}

	watchedByMedia := make(map[int64][]WatchedItem, len(watched))
	for _, w := range watched {
		if w.MediaType == "tv" {
			watchedByMedia[w.MediaID] = append(watchedByMedia[w.MediaID], w)
		}
	}

	// Progress and the fully-watched verdict come from the same TMDB summary,
	// so they are computed together. Movies need no network call: a movie is
	// either in the history or it is not.
	progress := make([]*ShowProgressLite, len(items))
	fullyWatched := make([]bool, len(items))

	if filterWatched || includeProgress {
		for i, item := range items {
			if watchlistMediaType(item) != "tv" && filterWatched {
				fullyWatched[i] = isMovieFullyWatched(item, watched)
			}
		}

		// Each show needs its own TMDB summary. Run them concurrently (bounded)
		// so endpoint latency is ~max(lookup) rather than the sum of N
		// sequential calls, which on a cold cache is the difference between a
		// fast screen and a client timeout. Every goroutine writes only its own
		// index, so no locking is required.
		var wg sync.WaitGroup
		sem := make(chan struct{}, tmdbDetailConcurrency)
		for i := range items {
			if watchlistMediaType(items[i]) != "tv" {
				continue
			}
			wg.Add(1)
			go func(idx int, it TMDBMedia) {
				defer wg.Done()
				sem <- struct{}{}
				defer func() { <-sem }()

				result, ok := computeShowProgress(it, watchedByMedia[it.ID], scope)
				if !ok {
					// A TMDB hiccup must not silently drop a title from the
					// user's watchlist, so a failed lookup counts as "keep it".
					return
				}
				fullyWatched[idx] = result.FullyWatchedEnded
				if includeProgress {
					lite := result.Lite
					progress[idx] = &lite
				}
			}(i, items[i])
		}
		wg.Wait()
	}

	if includeProgress {
		// Enrich the surviving media objects *before* copying them into the
		// response entries: enrichment mutates a []TMDBMedia in place, and
		// WatchlistEntry holds TMDBMedia by value, so a later copy would not
		// see the ratings.
		kept := make([]int, 0, len(items))
		for i := range items {
			if filterWatched && fullyWatched[i] {
				continue
			}
			kept = append(kept, i)
		}

		media := make([]TMDBMedia, 0, len(kept))
		for _, i := range kept {
			media = append(media, items[i])
		}
		enrichMediaRatings(media, scope)

		entries := make([]WatchlistEntry, 0, len(kept))
		for n, i := range kept {
			entries = append(entries, WatchlistEntry{
				TMDBMedia: media[n],
				Progress:  progress[i],
			})
		}

		sort.Slice(entries, func(i, j int) bool {
			return displayTitle(entries[i].TMDBMedia) < displayTitle(entries[j].TMDBMedia)
		})

		return WatchlistResponse{
			GeneratedAt: time.Now().UTC(),
			Items:       entries,
		}, true
	}

	if filterWatched {
		filtered := make([]TMDBMedia, 0, len(items))
		for i, item := range items {
			if !fullyWatched[i] {
				filtered = append(filtered, item)
			}
		}
		items = filtered
	}
	enrichMediaRatings(items, scope)

	sort.Slice(items, func(i, j int) bool {
		return displayTitle(items[i]) < displayTitle(items[j])
	})

	return items, true
}

func handleDeleteWatchlist(c *gin.Context) {
	userID, ok := c.Get("user_id")
	if !ok {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "Unauthorized"})
		return
	}
	userUID := userID.(uint)

	id, err := parseID(c.Param("id"))
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Invalid media id"})
		return
	}

	// Read the row first so the change-log key matches the one recorded when it
	// was added; deriving the key from the request alone would risk a
	// "movie:123" delete that never matches a stored "tv:123".
	var existing WatchlistItem
	if err := db.Where("user_id = ? AND media_id = ?", userUID, id).First(&existing).Error; err != nil {
		// Nothing to delete. Report success: the client's intent is satisfied.
		c.Status(http.StatusNoContent)
		return
	}

	if err := db.Where("user_id = ? AND media_id = ?", userUID, id).Delete(&WatchlistItem{}).Error; err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to delete from watchlist"})
		return
	}

	invalidateUserCaches(userUID)
	recordSyncOp(userUID, syncCollectionWatchlist, syncOpDelete,
		watchlistEntityKey(existing.MediaType, id), nil)
	c.Status(http.StatusNoContent)
}
