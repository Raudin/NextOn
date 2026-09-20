package main

import (
	"log"
	"strconv"
	"sync"
	"time"

	"gorm.io/gorm/clause"
)

// Ratings are read from the durable MediaRating table on the request path, and
// missing or stale entries are filled in by a small background worker pool.
//
// The previous design called OMDb synchronously while building every list
// response. A watchlist of 40 titles meant up to eight concurrent OMDb requests
// *per request*, with an unbounded in-process map as the only cache, no TTL,
// and no negative caching — so unknown titles were re-queried forever and the
// response could not complete until OMDb answered.
//
// Now the request path only reads. A cold database returns items without
// ratings, the worker fills them in, and the client picks them up on its next
// revalidation. That trade is deliberate: a missing rating badge for a few
// seconds is far cheaper than making every list request wait on a third party.

const (
	// ratingTTL is how long a stored rating is trusted before being refreshed.
	// Ratings change rarely; a month keeps them current without re-querying.
	ratingTTL = 30 * 24 * time.Hour

	// ratingRefreshConcurrency bounds concurrent OMDb lookups from the worker
	// pool. OMDb's free tier is rate limited, so this must stay modest.
	ratingRefreshConcurrency = 4

	// ratingQueueDepth bounds the pending work. A full queue drops jobs rather
	// than blocking the request that produced them; a dropped job is simply
	// re-enqueued by the next request that misses it.
	ratingQueueDepth = 1024
)

type ratingJob struct {
	mediaType string
	mediaID   int64
	title     string
	year      string
	imdbID    string
}

var (
	ratingQueue = make(chan ratingJob, ratingQueueDepth)

	// ratingInFlight deduplicates jobs for the same title. Discover calls the
	// enrichment three times per response, and several users can request the
	// same trending title at once, so without this the same OMDb lookup would
	// be issued repeatedly.
	ratingInFlight sync.Map

	ratingWorkersOnce sync.Once
)

func ratingKey(mediaType string, mediaID int64) string {
	return mediaType + ":" + strconv.FormatInt(mediaID, 10)
}

// startRatingWorkers launches the background pool. Called once at startup.
func startRatingWorkers() {
	ratingWorkersOnce.Do(func() {
		for i := 0; i < ratingRefreshConcurrency; i++ {
			go ratingWorker()
		}
		log.Printf("Ratings: %d background refresh workers started", ratingRefreshConcurrency)
	})
}

func ratingWorker() {
	for job := range ratingQueue {
		processRatingJob(job)
		ratingInFlight.Delete(ratingKey(job.mediaType, job.mediaID))
	}
}

func processRatingJob(job ratingJob) {
	if !omdbEnabled() {
		return
	}

	ratings, found, err := fetchOMDbRatings(getOMDbAPIKey(), job.title, job.year, job.imdbID)
	if err != nil {
		// Leave no row behind: the next request that needs this title will
		// enqueue it again, whereas writing a negative row would suppress
		// retries for a whole month after a transient failure.
		log.Printf("Ratings: OMDb lookup failed for %s/%d (%q): %v", job.mediaType, job.mediaID, job.title, err)
		return
	}

	row := MediaRating{
		MediaType:   job.mediaType,
		MediaID:     job.mediaID,
		Found:       found,
		SourceTitle: job.title,
		SourceYear:  job.year,
		FetchedAt:   time.Now(),
	}
	if found {
		row.IMDBRating = ratings.IMDBRating
		row.Metascore = ratings.Metascore
		row.RottenTomatoes = ratings.RottenTomatoes
	}

	// Upsert on the composite key: two workers can race on the same title
	// (a refresh triggered from two different screens), and a plain Create
	// would fail the primary-key constraint.
	if err := db.Clauses(clause.OnConflict{UpdateAll: true}).Create(&row).Error; err != nil {
		log.Printf("Ratings: failed to store rating for %s/%d: %v", job.mediaType, job.mediaID, err)
	}
}

// enqueueRatingRefresh schedules a lookup unless one is already pending.
func enqueueRatingRefresh(job ratingJob) {
	if job.title == "" && job.imdbID == "" {
		return
	}

	key := ratingKey(job.mediaType, job.mediaID)
	if _, loaded := ratingInFlight.LoadOrStore(key, struct{}{}); loaded {
		return
	}

	select {
	case ratingQueue <- job:
	default:
		// Queue is saturated. Release the in-flight marker so a later request
		// can retry; the item just renders without ratings for now.
		ratingInFlight.Delete(key)
	}
}

// storeRating records a rating that a request already fetched directly (the
// media-details endpoint looks up by IMDb id, which is more precise than the
// title search the background worker uses).
func storeRating(mediaType string, mediaID int64, title, year string, ratings TMDBMedia, found bool) {
	if !omdbEnabled() {
		return
	}

	row := MediaRating{
		MediaType:   mediaType,
		MediaID:     mediaID,
		Found:       found,
		SourceTitle: title,
		SourceYear:  year,
		FetchedAt:   time.Now(),
	}
	if found {
		row.IMDBRating = ratings.IMDBRating
		row.Metascore = ratings.Metascore
		row.RottenTomatoes = ratings.RottenTomatoes
	}

	if err := db.Clauses(clause.OnConflict{UpdateAll: true}).Create(&row).Error; err != nil {
		log.Printf("Ratings: failed to store rating for %s/%d: %v", mediaType, mediaID, err)
	}
}

// loadRatings reads stored ratings for a batch of ids of one media type.
func loadRatings(mediaType string, ids []int64) map[int64]MediaRating {
	if len(ids) == 0 {
		return nil
	}

	var rows []MediaRating
	if err := db.Where("media_type = ? AND media_id IN ?", mediaType, ids).Find(&rows).Error; err != nil {
		log.Printf("Ratings: failed to read stored ratings: %v", err)
		return nil
	}

	out := make(map[int64]MediaRating, len(rows))
	for _, row := range rows {
		out[row.MediaID] = row
	}
	return out
}

// ratingTitleAndYear extracts the OMDb search inputs from a media item. TMDB
// exposes the same concept under two names depending on media type.
func ratingTitleAndYear(item TMDBMedia) (title, year string) {
	title = item.Title
	if title == "" {
		title = item.Name
	}

	date := item.ReleaseDate
	if date == "" {
		date = item.FirstAirDate
	}
	if len(date) >= 4 {
		year = date[:4]
	}
	return title, year
}

// applyStoredRating copies a stored rating onto a media item. Negative entries
// (Found == false) intentionally apply nothing.
func applyStoredRating(item *TMDBMedia, row MediaRating) {
	item.IMDBRating = row.IMDBRating
	item.Metascore = row.Metascore
	item.RottenTomatoes = row.RottenTomatoes
}

// enrichMediaRatings fills in ratings for a list of media items from the
// durable store and schedules refreshes for anything missing or stale.
//
// It never performs a network request, so it is safe to call on the request
// path for arbitrarily large lists.
func enrichMediaRatings(items []TMDBMedia, scopes ...*callScope) {
	if len(items) == 0 || !omdbEnabled() {
		return
	}
	scope := firstScope(scopes)

	// Group by resolved media type: ratings are keyed by (type, id), and TMDB
	// movie and TV ids are separate namespaces that can collide.
	indicesByType := make(map[string][]int, 2)
	for i := range items {
		mediaType := watchlistMediaType(items[i])
		indicesByType[mediaType] = append(indicesByType[mediaType], i)
	}

	for mediaType, indices := range indicesByType {
		ids := make([]int64, 0, len(indices))
		for _, i := range indices {
			ids = append(ids, items[i].ID)
		}

		stored := loadRatings(mediaType, ids)
		now := time.Now()

		for _, i := range indices {
			item := &items[i]
			title, year := ratingTitleAndYear(*item)
			scope.addOMDbLookup()

			row, ok := stored[item.ID]
			if ok {
				metrics.recordOMDbStore(true)
				applyStoredRating(item, row)
				if now.Sub(row.FetchedAt) < ratingTTL {
					continue
				}
			} else {
				metrics.recordOMDbStore(false)
			}

			enqueueRatingRefresh(ratingJob{
				mediaType: mediaType,
				mediaID:   item.ID,
				title:     title,
				year:      year,
			})
		}
	}
}
