package main

// Shared concurrency limits for outbound third-party calls.
//
// These were previously magic numbers inline at each call site
// (handleGetWatchlist used 10, enrichMediaRatings used 8), which made it
// impossible to reason about the aggregate outbound pressure a single screen
// could create. Keeping them together means one place to tune and one place to
// review when TMDB/OMDb start returning 429s.
const (
	// tmdbDetailConcurrency bounds parallel per-show TMDB lookups when a
	// handler has to enrich a list of watchlist entries.
	tmdbDetailConcurrency = 10

	// omdbEnrichConcurrency bounds parallel OMDb lookups while enriching a list
	// of media items with IMDb/Metascore/Rotten Tomatoes ratings.
	omdbEnrichConcurrency = 8
)
