package main

import (
	"net/http"

	"github.com/gin-gonic/gin"
)

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

// maxRequestBodyBytes caps how large a request body any mutating endpoint will
// read.
//
// Previously nothing bounded this: gin's JSON binding reads and decodes
// whatever arrives, so a single client could stream an arbitrarily large array
// to /api/watched/bulk and have the server buffer and unmarshal all of it
// before any per-item limit could reject it. The cap is generous relative to
// the real payloads (a 5,000-episode bulk mark is a few hundred KB), so it
// rejects abuse without touching legitimate traffic.
const maxRequestBodyBytes = 4 << 20 // 4 MiB

// BodyLimitMiddleware caps the bytes read from the body of a request that can
// carry one. GET/HEAD/OPTIONS are skipped: they have no body to bound, and
// installing a MaxBytesReader on them would be noise.
//
// A request over the cap fails during binding with a MaxBytesError, which the
// handler reports as 400. The important part is that the overage is never
// buffered in the first place.
func BodyLimitMiddleware(limit int64) gin.HandlerFunc {
	return func(c *gin.Context) {
		switch c.Request.Method {
		case http.MethodGet, http.MethodHead, http.MethodOptions:
			c.Next()
			return
		}

		if c.Request.Body != nil {
			c.Request.Body = http.MaxBytesReader(c.Writer, c.Request.Body, limit)
		}
		c.Next()
	}
}
