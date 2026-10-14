package main

import (
	"errors"
	"fmt"
	"log"
	"net/http"
	"os"
	"strings"
	"sync"
	"time"

	"github.com/gin-gonic/gin"
	"gorm.io/gorm"
	"gorm.io/gorm/clause"
)

func handleAddWatched(c *gin.Context) {
	userID, ok := c.Get("user_id")
	if !ok {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "Unauthorized"})
		return
	}
	userUID := userID.(uint)

	var req WatchedItemRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Invalid watched payload"})
		return
	}
	if req.MediaType != "movie" && req.MediaType != "tv" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Media type must be movie or tv"})
		return
	}
	if req.MediaID == 0 {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Media id is required"})
		return
	}
	if req.MediaType == "tv" && (req.SeasonNumber == nil || req.EpisodeNumber == nil) {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Season and episode numbers are required for TV episodes"})
		return
	}

	if isUnreleased(req.MediaType, req.MediaID, req.SeasonNumber, req.EpisodeNumber, scopeFrom(c)) {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Cannot watch unreleased content"})
		return
	}

	// Identity and timestamp come from the server, never from the request body.
	item := req.WatchedItem(userUID, time.Now())

	// The write and its change-log entry share one transaction. A change-log
	// entry whose row was never written would tell the client about an episode
	// it cannot then fetch, and a row written without an entry would never
	// reach the user's other devices.
	err := db.Transaction(func(tx *gorm.DB) error {
		if err := addOrUpdateWatchedTx(tx, userUID, &item); err != nil {
			return err
		}
		if !recordSyncOpsTx(tx, userUID, []pendingSyncOp{{
			collection: syncCollectionWatched,
			opType:     syncOpUpsert,
			entityKey:  watchedEntityKey(item.MediaType, item.MediaID, item.SeasonNumber, item.EpisodeNumber),
			payload:    item,
		}}) {
			return errors.New("failed to record watched change")
		}
		return nil
	})
	if err != nil {
		log.Printf("Watched: failed to record %s/%d for user %d: %v", item.MediaType, item.MediaID, userUID, err)
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to save watched item"})
		return
	}

	invalidateUserCaches(userUID)
	c.JSON(http.StatusCreated, item)
}

// maxBulkWatchedItems caps how many items one bulk mark may carry.
//
// bulkDelete has always had an equivalent cap; the add path had none, so a
// single request could carry an arbitrarily large array. Every item becomes a
// row plus a change-log entry, so an unbounded payload is simultaneously an
// unbounded transaction, an unbounded response, and enough change-log churn to
// push every other device past the retention window into a full resync.
const maxBulkWatchedItems = 5000

func handleAddWatchedBulk(c *gin.Context) {
	userID, ok := c.Get("user_id")
	if !ok {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "Unauthorized"})
		return
	}
	userUID := userID.(uint)

	var req struct {
		Items []WatchedItemRequest `json:"items"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Invalid bulk payload"})
		return
	}

	if len(req.Items) > maxBulkWatchedItems {
		c.JSON(http.StatusRequestEntityTooLarge, gin.H{"error": "Too many items in one request"})
		return
	}

	now := time.Now()
	scope := scopeFrom(c)

	// Validate the whole payload before touching TMDB or the database, so a
	// malformed item fails fast instead of after a batch of lookups.
	for i := range req.Items {
		item := &req.Items[i]
		if item.MediaType != "movie" && item.MediaType != "tv" {
			c.JSON(http.StatusBadRequest, gin.H{"error": "Media type must be movie or tv"})
			return
		}
		if item.MediaID == 0 {
			c.JSON(http.StatusBadRequest, gin.H{"error": "Media id is required"})
			return
		}
		if item.MediaType == "tv" && (item.SeasonNumber == nil || item.EpisodeNumber == nil) {
			c.JSON(http.StatusBadRequest, gin.H{"error": "Season and episode numbers are required for TV episodes"})
			return
		}
	}

	// One release-date lookup for the batch instead of one per item; see
	// bulkReleaseLookup for why this matters.
	episodeAirDates, movieReleaseDates := bulkReleaseLookup(req.Items, scope)

	// One change-log entry per applied item, all at the version this batch
	// advanced to. A 200-episode mark therefore produces 200 ops but only one
	// version bump, and the client applies them in a single pass.
	applied := make([]WatchedItem, 0, len(req.Items))
	pending := make([]pendingSyncOp, 0, len(req.Items))
	seen := make(map[string]struct{}, len(req.Items))

	for i := range req.Items {
		item := req.Items[i].WatchedItem(userUID, now)
		if isUnreleasedFromLookup(&item, episodeAirDates, movieReleaseDates) {
			continue
		}

		// De-duplicate: the batch is inserted in one statement, so an episode
		// repeated inside a single payload would collide with itself.
		key := watchedItemKey(item)
		if _, duplicate := seen[key]; duplicate {
			continue
		}
		seen[key] = struct{}{}

		applied = append(applied, item)
		pending = append(pending, pendingSyncOp{
			collection: syncCollectionWatched,
			opType:     syncOpUpsert,
			entityKey:  watchedEntityKey(item.MediaType, item.MediaID, item.SeasonNumber, item.EpisodeNumber),
			payload:    item,
		})
	}

	if err := db.Transaction(func(tx *gorm.DB) error {
		if err := addOrUpdateWatchedBatch(tx, applied); err != nil {
			return err
		}
		if !recordSyncOpsTx(tx, userUID, pending) {
			return errors.New("failed to record watched changes")
		}
		return nil
	}); err != nil {
		log.Printf("Watched: bulk write of %d items failed for user %d: %v", len(applied), userUID, err)
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to save watched items"})
		return
	}

	invalidateUserCaches(userUID)
	c.JSON(http.StatusCreated, gin.H{"added": len(applied)})
}

// WatchedBulkDeleteReq removes many watched episodes in one request. The
// client previously issued one DELETE per episode, so clearing a ten-season
// show meant ~200 requests.
type WatchedBulkDeleteReq struct {
	MediaID   int64  `json:"media_id" binding:"required"`
	MediaType string `json:"media_type" binding:"required"`
	// Episodes may be omitted to remove every watched row for the title, which
	// is what "unmark all" for a movie (or a whole show) needs.
	Episodes []WatchedEpisodeRef `json:"episodes"`
}

type WatchedEpisodeRef struct {
	Season  int64 `json:"season"`
	Episode int64 `json:"episode"`
}

// maxBulkDeleteEpisodes caps the generated SQL. Each pair adds one OR clause,
// and an unbounded payload would build a statement SQLite has to parse in full.
const maxBulkDeleteEpisodes = 5000

func handleDeleteWatchedBulk(c *gin.Context) {
	userID, ok := c.Get("user_id")
	if !ok {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "Unauthorized"})
		return
	}
	userUID := userID.(uint)

	var req WatchedBulkDeleteReq
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Invalid bulk delete payload"})
		return
	}
	if req.MediaType != "movie" && req.MediaType != "tv" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Media type must be movie or tv"})
		return
	}
	if len(req.Episodes) > maxBulkDeleteEpisodes {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Too many episodes in one request"})
		return
	}

	query := db.Where("user_id = ? AND media_id = ? AND media_type = ?", userUID, req.MediaID, req.MediaType)

	if len(req.Episodes) > 0 {
		// Build "((season_number = ? AND episode_number = ?) OR ...)". Values
		// stay bound parameters; only the clause structure is interpolated.
		clauses := make([]string, 0, len(req.Episodes))
		args := make([]interface{}, 0, len(req.Episodes)*2)
		for _, ep := range req.Episodes {
			clauses = append(clauses, "(season_number = ? AND episode_number = ?)")
			args = append(args, ep.Season, ep.Episode)
		}
		query = query.Where(strings.Join(clauses, " OR "), args...)
	}

	result := query.Delete(&WatchedItem{})
	if result.Error != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to remove watched episodes"})
		return
	}

	// One change-log entry per requested episode, written in a single batch.
	// Previously each entry took its own version bump and prune cycle, so
	// clearing a ten-season show advanced the user's version 200 times and
	// invalidated every cached payload on every one of them.
	pending := make([]pendingSyncOp, 0, len(req.Episodes)+1)
	for _, ep := range req.Episodes {
		season := ep.Season
		episode := ep.Episode
		pending = append(pending, pendingSyncOp{
			collection: syncCollectionWatched,
			opType:     syncOpDelete,
			entityKey:  watchedEntityKey(req.MediaType, req.MediaID, &season, &episode),
		})
	}
	if len(req.Episodes) == 0 {
		// No episode list means "remove everything for this title".
		pending = append(pending, pendingSyncOp{
			collection: syncCollectionWatched,
			opType:     syncOpDelete,
			entityKey:  watchedEntityKey(req.MediaType, req.MediaID, nil, nil),
		})
	}

	if err := db.Transaction(func(tx *gorm.DB) error {
		if !recordSyncOpsTx(tx, userUID, pending) {
			return errors.New("failed to record watched deletions")
		}
		return nil
	}); err != nil {
		log.Printf("Watched: failed to record %d deletions for user %d: %v", len(pending), userUID, err)
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to record watched deletions"})
		return
	}

	invalidateUserCaches(userUID)
	c.JSON(http.StatusOK, gin.H{"deleted": result.RowsAffected})
}

func handleDeleteWatched(c *gin.Context) {
	userID, ok := c.Get("user_id")
	if !ok {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "Unauthorized"})
		return
	}
	userUID := userID.(uint)

	var req WatchedItem
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Invalid watched payload"})
		return
	}
	if req.MediaType != "movie" && req.MediaType != "tv" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Media type must be movie or tv"})
		return
	}
	if req.MediaID == 0 {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Media id is required"})
		return
	}

	query := db.Where("user_id = ? AND media_id = ? AND media_type = ?", userUID, req.MediaID, req.MediaType)
	if req.MediaType == "tv" {
		if req.SeasonNumber != nil {
			query = query.Where("season_number = ?", *req.SeasonNumber)
		} else {
			query = query.Where("season_number IS NULL")
		}
		if req.EpisodeNumber != nil {
			query = query.Where("episode_number = ?", *req.EpisodeNumber)
		} else {
			query = query.Where("episode_number IS NULL")
		}
	}

	if err := query.Delete(&WatchedItem{}).Error; err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to remove from watched list"})
		return
	}

	invalidateUserCaches(userUID)
	recordSyncOp(userUID, syncCollectionWatched, syncOpDelete,
		watchedEntityKey(req.MediaType, req.MediaID, req.SeasonNumber, req.EpisodeNumber), nil)
	c.Status(http.StatusNoContent)
}

func handleGetWatched(c *gin.Context) {
	userID, ok := c.Get("user_id")
	if !ok {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "Unauthorized"})
		return
	}
	userUID := userID.(uint)

	items := getUserWatched(userUID)
	c.JSON(http.StatusOK, items)
}

// watchedStatusIncludeTvProgress is the `include` value that asks the status
// endpoint for the TV progress payload. Named rather than inlined so the query
// value, the response key and the client's parameter can be grepped together.
const watchedStatusIncludeTvProgress = "tv_progress"

func handleWatchedStatus(c *gin.Context) {
	mediaID, err := parseID(c.Query("media_id"))
	if err != nil || mediaID == 0 {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Invalid media id"})
		return
	}
	mediaType := c.Query("type")
	if mediaType != "movie" && mediaType != "tv" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Media type must be movie or tv"})
		return
	}

	// The route is public; OptionalAuthMiddleware sets user_id only when a
	// valid token was supplied.
	userIDValue, _ := c.Get("user_id")
	userUID, _ := userIDValue.(uint)

	if userUID == 0 {
		// User is not logged in: return empty watched state
		if mediaType == "movie" {
			c.JSON(http.StatusOK, gin.H{"watched": false})
		} else {
			c.JSON(http.StatusOK, gin.H{"episodes": []gin.H{}})
		}
		return
	}

	// Scope the query to just this media row instead of loading (and scanning)
	// the user's entire watch history for every status check.
	items := getUserWatchedForMedia(userUID, mediaID, mediaType)
	if mediaType == "movie" {
		c.JSON(http.StatusOK, gin.H{"watched": len(items) > 0})
		return
	}

	episodes := []gin.H{}
	for _, item := range items {
		if item.SeasonNumber != nil && item.EpisodeNumber != nil {
			episodes = append(episodes, gin.H{"season": *item.SeasonNumber, "episode": *item.EpisodeNumber})
		}
	}

	response := gin.H{"episodes": episodes}

	// Opt-in: this is the only part of the response that costs a TMDB lookup
	// (a series summary plus, at most, the one season with an unwatched
	// episode), so callers that only need watched state keep the cheap
	// database-only path. A failure here is swallowed on purpose: the caller
	// asked for its own watched rows, and a metadata outage must not turn that
	// into an error.
	if c.Query("include") == watchedStatusIncludeTvProgress {
		scope := scopeFrom(c)
		if summary, ok := fetchTVSummary(mediaID, scope); ok {
			if progress, ok := buildTvProgress(mediaID, items, summary, func(seriesID, seasonNum int64) (*SeasonDetails, error) {
				return fetchSeasonDetail(seriesID, seasonNum, scope)
			}); ok {
				response["tv_progress"] = progress
			}
		}
	}

	c.JSON(http.StatusOK, response)
}

// tmdbTVSummary is the trimmed projection of a TMDB `/tv/{id}` response. It
// carries both the aggregate episode count used by the "fully watched" check
// and the per-season breakdown the Home schedule needs to locate a user's next
// unwatched episode from a single request.
type tmdbTVSummary struct {
	NumberOfEpisodes int64    `json:"number_of_episodes"`
	Status           string   `json:"status"`
	FirstAirDate     string   `json:"first_air_date"`
	Seasons          []Season `json:"seasons"`
}

func watchlistMediaType(item TMDBMedia) string {
	if item.MediaType != "" {
		return item.MediaType
	}
	if item.Title != "" {
		return "movie"
	}
	return "tv"
}

// isMovieFullyWatched reports whether a movie has been marked watched. Movies
// need no TMDB lookup, so unlike the TV path this is a pure in-memory check.
func isMovieFullyWatched(item TMDBMedia, watched []WatchedItem) bool {
	for _, w := range watched {
		if w.MediaID == item.ID && w.MediaType == "movie" {
			return true
		}
	}
	return false
}

func addOrUpdateWatched(userID uint, item WatchedItem) error {
	return addOrUpdateWatchedTx(db, userID, &item)
}

// addOrUpdateWatchedTx is addOrUpdateWatched bound to a transaction.
//
// It returns the database error rather than discarding it. The previous version
// ignored both Save and Create and the handler answered 201 regardless, so a
// failed write silently lost the user's data while telling the client it had
// been stored.
func addOrUpdateWatchedTx(tx *gorm.DB, userID uint, item *WatchedItem) error {
	// Match on media identity and let First() own the destination value. The
	// previous form passed the scoped query as First's condition and the row as
	// its destination, which is not how GORM's first argument works.
	query := tx.Where("user_id = ? AND media_id = ? AND media_type = ?", userID, item.MediaID, item.MediaType)
	if item.SeasonNumber == nil {
		query = query.Where("season_number IS NULL")
	} else {
		query = query.Where("season_number = ?", *item.SeasonNumber)
	}
	if item.EpisodeNumber == nil {
		query = query.Where("episode_number IS NULL")
	} else {
		query = query.Where("episode_number = ?", *item.EpisodeNumber)
	}

	var existing WatchedItem
	err := query.First(&existing).Error
	switch {
	case err == nil:
		existing.WatchedAt = item.WatchedAt
		return tx.Save(&existing).Error
	case errors.Is(err, gorm.ErrRecordNotFound):
		return tx.Create(item).Error
	default:
		return err
	}
}

// addOrUpdateWatchedBatch writes a whole bulk payload in a handful of
// statements instead of one per item.
//
// The per-item helper issues a SELECT plus an INSERT or UPDATE per item, so a
// 500-episode mark cost ~1,000 round trips and ~500 auto-commit fsyncs. The
// caller has already validated and de-duplicated the payload, so a straight
// batched INSERT is the same outcome at a fraction of the cost.
//
// `INSERT OR IGNORE` is used instead of `ON CONFLICT DO UPDATE` because the
// idx_user_watched unique index contains nullable season_number and
// episode_number columns. SQLite treats NULLs as distinct in a unique index,
// so an `ON CONFLICT` clause targeting that index would never fire for movies
// and duplicates would be inserted on every re-mark. `INSERT OR IGNORE` uses
// the storage engine's own conflict detection and simply skips the row,
// keeping the batch fast even when most items already exist.
//
// WatchedAt is preserved for an episode the user already had marked: the
// insert is ignored and the original timestamp stands.
func addOrUpdateWatchedBatch(tx *gorm.DB, items []WatchedItem) error {
	if len(items) == 0 {
		return nil
	}

	// GORM's Clauses API lets us prepend "OR IGNORE" to the INSERT without
	// writing raw SQL, keeping the batching and column mapping intact.
	ignoreTx := tx.Clauses(clause.Insert{Modifier: "OR IGNORE"})
	if err := ignoreTx.CreateInBatches(items, 200).Error; err != nil {
		return err
	}
	return nil
}

// watchedItemKey identifies a watched row the same way its unique index does.
// Bulk payloads are de-duplicated on this so a repeated episode in one request
// cannot collide with itself inside a single INSERT.
func watchedItemKey(item WatchedItem) string {
	season, episode := int64(0), int64(0)
	if item.SeasonNumber != nil {
		season = *item.SeasonNumber
	}
	if item.EpisodeNumber != nil {
		episode = *item.EpisodeNumber
	}
	return fmt.Sprintf("%d|%d|%s|%d|%d", item.UserID, item.MediaID, item.MediaType, season, episode)
}

// getUserWatched returns the user's watch history.
//
// Only the columns any caller actually reads are selected. The previous `SELECT
// *` pulled every column of every row — media ids, season and episode numbers,
// timestamps — into memory for a history that callers walk to count, group by
// media type, or extract dates from. Narrowing the projection is what keeps a
// long history from being the largest allocation on the watchlist and progress
// paths.
func getUserWatched(userID uint) []WatchedItem {
	var items []WatchedItem
	db.Select("user_id", "media_id", "media_type", "season_number", "episode_number", "watched_at").
		Where("user_id = ?", userID).
		Find(&items)
	return items
}

// getUserWatchedForMedia returns only the user's watched rows for one piece of
// media (instead of their whole history), which is all a status check needs.
func getUserWatchedForMedia(userID uint, mediaID int64, mediaType string) []WatchedItem {
	var items []WatchedItem
	db.Where("user_id = ? AND media_id = ? AND media_type = ?", userID, mediaID, mediaType).Find(&items)
	return items
}

func ptrInt64Equal(a, b *int64) bool {
	if a == nil && b == nil {
		return true
	}
	if a == nil || b == nil {
		return false
	}
	return *a == *b
}

// fetchMovieReleaseDate returns a movie's release date, falling back to the
// mock dataset when TMDB is unavailable so the unreleased check keeps working
// in offline/dummy mode.
func fetchMovieReleaseDate(mediaID int64, scope *callScope) string {
	apiKey := os.Getenv("TMDB_API_KEY")
	if apiKey != "dummy" {
		detailsURL := fmt.Sprintf("https://api.themoviedb.org/3/movie/%d", mediaID)
		var response tmdbMediaDetailsResponse
		if err := tmdbGet(detailsURL, apiKey, &response, scope); err == nil {
			return response.ReleaseDate
		}
	}

	details, ok := getMockMediaDetails("movie", mediaID)
	if !ok {
		details = getFallbackMediaDetails("movie", mediaID)
	}
	return details.ReleaseDate
}

// fetchEpisodeAirDate returns one episode's air date, with the same mock
// fallback as fetchMovieReleaseDate.
func fetchEpisodeAirDate(mediaID, seasonNum, episodeNum int64, scope *callScope) string {
	apiKey := os.Getenv("TMDB_API_KEY")
	if apiKey != "dummy" {
		episodeURL := fmt.Sprintf("https://api.themoviedb.org/3/tv/%d/season/%d/episode/%d", mediaID, seasonNum, episodeNum)
		var episode Episode
		if err := tmdbGet(episodeURL, apiKey, &episode, scope); err == nil {
			return episode.AirDate
		}
	}

	episode, ok := getMockEpisodeDetails(mediaID, seasonNum, episodeNum)
	if !ok {
		return ""
	}
	return episode.AirDate
}

// isUnreleased reports whether a title cannot be marked watched yet.
//
// Single-item callers use this directly. Bulk callers must NOT: it performs one
// lookup per item, which for a season of 24 episodes means 24 sequential TMDB
// round trips. Use bulkReleaseLookup for those.
func isUnreleased(mediaType string, mediaID int64, seasonNum, episodeNum *int64, scopes ...*callScope) bool {
	scope := firstScope(scopes)

	switch mediaType {
	case "movie":
		return isAfterToday(fetchMovieReleaseDate(mediaID, scope))
	case "tv":
		if seasonNum == nil || episodeNum == nil {
			return false
		}
		return isAfterToday(fetchEpisodeAirDate(mediaID, *seasonNum, *episodeNum, scope))
	}
	return false
}

// bulkReleaseLookup resolves release dates for a whole bulk payload up front.
//
// This is the fix for the bulk-mark performance problem: the previous
// implementation called isUnreleased per item, so marking a ten-season show
// watched issued ~200 sequential TMDB episode requests. Here each distinct
// season is fetched once (through the response cache) and each movie once, and
// the per-season fetches run concurrently.
func bulkReleaseLookup(items []WatchedItemRequest, scope *callScope) (episodeAirDates map[string]string, movieReleaseDates map[int64]string) {
	episodeAirDates = make(map[string]string)
	movieReleaseDates = make(map[int64]string)

	type seasonKey struct {
		mediaID int64
		season  int64
	}

	seasons := make(map[seasonKey]struct{})
	movies := make(map[int64]struct{})

	for _, item := range items {
		if item.MediaType == "movie" {
			movies[item.MediaID] = struct{}{}
			continue
		}
		if item.SeasonNumber != nil {
			seasons[seasonKey{item.MediaID, *item.SeasonNumber}] = struct{}{}
		}
	}

	var mu sync.Mutex
	var wg sync.WaitGroup
	sem := make(chan struct{}, tmdbDetailConcurrency)

	// Acquire the slot inside the goroutine but before any work. The important
	// property is that at most tmdbDetailConcurrency goroutines are ever doing
	// TMDB work; the previous form started one goroutine per distinct season
	// regardless, so a payload naming a thousand seasons spawned a thousand
	// goroutines and a thousand request closures before any of them ran.
	run := func(arg any, work func(any)) {
		wg.Add(1)
		go func() {
			defer wg.Done()
			sem <- struct{}{}
			defer func() { <-sem }()
			work(arg)
		}()
	}

	for key := range seasons {
		run(key, func(arg any) {
			k := arg.(seasonKey)
			season, err := fetchSeasonDetail(k.mediaID, k.season, scope)
			if err != nil {
				// Unknown season: leave its episodes unresolved. The caller
				// treats an unresolved date as "released", matching the old
				// single-item behaviour on a failed lookup.
				return
			}

			mu.Lock()
			for _, ep := range season.Episodes {
				episodeAirDates[episodeKey(k.mediaID, ep.SeasonNumber, ep.EpisodeNumber)] = ep.AirDate
			}
			mu.Unlock()
		})
	}

	for mediaID := range movies {
		run(mediaID, func(arg any) {
			id := arg.(int64)
			releaseDate := fetchMovieReleaseDate(id, scope)
			mu.Lock()
			movieReleaseDates[id] = releaseDate
			mu.Unlock()
		})
	}

	wg.Wait()
	return episodeAirDates, movieReleaseDates
}

func episodeKey(mediaID, seasonNumber, episodeNumber int64) string {
	return fmt.Sprintf("%d:%d:%d", mediaID, seasonNumber, episodeNumber)
}

// isUnreleasedFromLookup is the bulk-safe counterpart of isUnreleased: it reads
// dates resolved by bulkReleaseLookup instead of issuing its own requests.
func isUnreleasedFromLookup(item *WatchedItem, episodeAirDates map[string]string, movieReleaseDates map[int64]string) bool {
	switch item.MediaType {
	case "movie":
		return isAfterToday(movieReleaseDates[item.MediaID])
	case "tv":
		if item.SeasonNumber == nil || item.EpisodeNumber == nil {
			return false
		}
		return isAfterToday(episodeAirDates[episodeKey(item.MediaID, *item.SeasonNumber, *item.EpisodeNumber)])
	}
	return false
}
