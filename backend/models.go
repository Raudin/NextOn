package main

import (
	"sync"
	"time"
)

// GORM Models
type User struct {
	ID                   uint      `gorm:"primaryKey" json:"id"`
	Email                string    `gorm:"uniqueIndex;not null" json:"email"`
	PasswordHash         string    `gorm:"not null" json:"-"`
	Name                 string    `json:"name"`
	AvatarURL            string    `json:"avatar_url"`
	NotificationsEnabled bool      `gorm:"default:true" json:"notifications_enabled"`
	CreatedAt            time.Time `json:"created_at"`
}

type WatchlistItem struct {
	ID           uint      `gorm:"primaryKey" json:"id"`
	UserID       uint      `gorm:"not null;uniqueIndex:idx_user_watchlist" json:"user_id"`
	MediaID      int64     `gorm:"not null;uniqueIndex:idx_user_watchlist" json:"media_id"`
	Title        string    `json:"title,omitempty"`
	Name         string    `json:"name,omitempty"`
	PosterPath   string    `json:"poster_path"`
	BackdropPath string    `json:"backdrop_path"`
	VoteAverage  float64   `json:"vote_average"`
	MediaType    string    `json:"media_type,omitempty"`
	ReleaseDate  string    `json:"release_date,omitempty"`
	FirstAirDate string    `json:"first_air_date,omitempty"`
	CreatedAt    time.Time `json:"created_at"`
}

type FavoriteItem struct {
	ID           uint      `gorm:"primaryKey" json:"id"`
	UserID       uint      `gorm:"not null;uniqueIndex:idx_user_favorite" json:"user_id"`
	MediaID      int64     `gorm:"not null;uniqueIndex:idx_user_favorite" json:"media_id"`
	Title        string    `json:"title,omitempty"`
	Name         string    `json:"name,omitempty"`
	PosterPath   string    `json:"poster_path"`
	BackdropPath string    `json:"backdrop_path"`
	VoteAverage  float64   `json:"vote_average"`
	MediaType    string    `json:"media_type,omitempty"`
	ReleaseDate  string    `json:"release_date,omitempty"`
	FirstAirDate string    `json:"first_air_date,omitempty"`
	CreatedAt    time.Time `json:"created_at"`
}

type WatchedItem struct {
	ID            uint      `gorm:"primaryKey" json:"id"`
	UserID        uint      `gorm:"not null;uniqueIndex:idx_user_watched" json:"user_id"`
	MediaID       int64     `gorm:"not null;uniqueIndex:idx_user_watched" json:"media_id"`
	MediaType     string    `gorm:"not null" json:"media_type"`
	SeasonNumber  *int64    `gorm:"uniqueIndex:idx_user_watched" json:"season_number,omitempty"`
	EpisodeNumber *int64    `gorm:"uniqueIndex:idx_user_watched" json:"episode_number,omitempty"`
	WatchedAt     time.Time `json:"watched_at"`
}

// UserSyncState holds a monotonic per-user version number.
//
// Every mutation increments it, and the new value is stamped onto the change
// record and used as the ETag for that user's derived payloads. Because it
// lives in the database rather than in Redis, ETag revalidation and delta sync
// stay correct whether or not Redis is available.
type UserSyncState struct {
	UserID  uint   `gorm:"primaryKey" json:"user_id"`
	Version uint64 `gorm:"not null;default:1" json:"version"`
}

// SyncOp is one entry in a user's change log, which is what makes delta sync
// possible.
//
// The alternative — version columns plus soft deletes on every entity table —
// was rejected because GORM's soft delete interacts badly with the existing
// composite unique indexes: `idx_user_watchlist (user_id, media_id)` would keep
// a deleted row occupying the slot, so re-adding a title would fail the
// constraint, and every add path would need "resurrect the tombstone" logic.
// A change log keeps the entity tables simple and gives the client exactly the
// operations it needs to replay, including deletes.
type SyncOp struct {
	ID         uint   `gorm:"primaryKey" json:"id"`
	UserID     uint   `gorm:"not null;index:idx_sync_user_version,priority:1" json:"user_id"`
	Version    uint64 `gorm:"not null;index:idx_sync_user_version,priority:2" json:"version"`
	Collection string `gorm:"not null" json:"collection"`
	OpType     string `gorm:"not null" json:"op_type"`
	EntityKey  string `gorm:"not null" json:"entity_key"`
	// Payload is the entity as the client should store it, or empty for a
	// delete. Inlining it means the client can apply a delta without a
	// follow-up request per collection.
	Payload   string    `json:"payload,omitempty"`
	CreatedAt time.Time `json:"created_at"`
}

// Sync collections. Also used as the `include` selector on the sync endpoints.
const (
	syncCollectionWatchlist = "watchlist"
	syncCollectionWatched   = "watched"
	syncCollectionFavorites = "favorites"

	syncOpUpsert = "upsert"
	syncOpDelete = "delete"
)

// MediaRating is the durable cache for OMDb ratings (IMDb, Metascore, Rotten
// Tomatoes), keyed by TMDB identity.
//
// Previously these lived only in an unbounded in-process map that was queried
// synchronously on every list request, so a watchlist render blocked on up to
// eight outbound OMDb calls and the map grew without limit for the lifetime of
// the process. Persisting them means a list request is a single indexed read,
// missing entries are filled in by a background worker, and the result survives
// restarts.
//
// Found is stored explicitly so a title OMDb has no record for is remembered
// as such. Without it, unknown titles were re-queried on every single request.
type MediaRating struct {
	MediaType      string    `gorm:"primaryKey;uniqueIndex:idx_media_rating" json:"media_type"`
	MediaID        int64     `gorm:"primaryKey;uniqueIndex:idx_media_rating" json:"media_id"`
	Found          bool      `json:"found"`
	IMDBRating     *float64  `json:"imdb_rating,omitempty"`
	Metascore      *int      `json:"metascore,omitempty"`
	RottenTomatoes *int      `json:"rotten_tomatoes,omitempty"`
	SourceTitle    string    `json:"source_title,omitempty"`
	SourceYear     string    `json:"source_year,omitempty"`
	FetchedAt      time.Time `json:"fetched_at"`
}

// TMDBMedia represents a movie or TV show item from TMDB
type TMDBMedia struct {
	ID             int64     `json:"id"`
	Title          string    `json:"title,omitempty"`
	Name           string    `json:"name,omitempty"`
	PosterPath     string    `json:"poster_path"`
	BackdropPath   string    `json:"backdrop_path"`
	VoteAverage    float64   `json:"vote_average"`
	IMDBRating     *float64  `json:"imdb_rating,omitempty"`
	Metascore      *int      `json:"metascore,omitempty"`
	RottenTomatoes *int      `json:"rotten_tomatoes,omitempty"`
	MediaType      string    `json:"media_type,omitempty"`
	ReleaseDate    string    `json:"release_date,omitempty"`
	FirstAirDate   string    `json:"first_air_date,omitempty"`
	CreatedAt      time.Time `json:"created_at,omitempty"`
}

type Genre struct {
	ID   int64  `json:"id"`
	Name string `json:"name"`
}

type Network struct {
	ID   int64  `json:"id"`
	Name string `json:"name"`
}

type CastMember struct {
	ID          int64  `json:"id"`
	Name        string `json:"name"`
	ProfilePath string `json:"profile_path"`
	// Character is the role this person plays in the title. TMDB exposes it on
	// `credits.cast[].character` for movies and TV alike, so the existing
	// credits append already carries it and no extra request is needed.
	// Absent for fallback payloads and for the rare entry TMDB leaves blank,
	// in which case the detail screen simply omits the second line.
	Character string `json:"character,omitempty"`
}

type Season struct {
	ID           int64  `json:"id"`
	SeasonNumber int64  `json:"season_number"`
	Name         string `json:"name"`
	Overview     string `json:"overview"`
	EpisodeCount int64  `json:"episode_count"`
	PosterPath   string `json:"poster_path"`
}

type Episode struct {
	ID            int64  `json:"id"`
	Name          string `json:"name"`
	Overview      string `json:"overview"`
	EpisodeNumber int64  `json:"episode_number"`
	SeasonNumber  int64  `json:"season_number"`
	StillPath     string `json:"still_path"`
	AirDate       string `json:"air_date"`
	Runtime       int64  `json:"runtime,omitempty"`
}

type SeasonDetails struct {
	ID           int64     `json:"id"`
	SeasonNumber int64     `json:"season_number"`
	Name         string    `json:"name"`
	Overview     string    `json:"overview"`
	Episodes     []Episode `json:"episodes"`
}

type Image struct {
	FilePath    string  `json:"file_path"`
	AspectRatio float64 `json:"aspect_ratio"`
	Width       int64   `json:"width"`
	Height      int64   `json:"height"`
	VoteAverage float64 `json:"vote_average,omitempty"`
	Iso6391     string  `json:"iso_639_1,omitempty"`
}

type Video struct {
	Key  string `json:"key"`
	Name string `json:"name"`
	Site string `json:"site"`
	Type string `json:"type"`
}

type MediaDetails struct {
	TMDBMedia
	Runtime         int64        `json:"runtime,omitempty"`
	EpisodeRunTime  []int64      `json:"episode_run_time,omitempty"`
	NumberOfSeasons int64        `json:"number_of_seasons,omitempty"`
	Seasons         []Season     `json:"seasons,omitempty"`
	Overview        string       `json:"overview"`
	Genres          []Genre      `json:"genres"`
	Cast            []CastMember `json:"cast"`
	Logos           []Image      `json:"logos,omitempty"`
	Trailers        []Video      `json:"trailers,omitempty"`
	Status          string       `json:"status,omitempty"`
	Tagline         string       `json:"tagline,omitempty"`
	Network         string       `json:"network,omitempty"`
	// Certification is the title's age rating, resolved from TMDB's
	// country-specific data (see extractCertification). Empty when no rating
	// could be resolved anywhere, in which case the client hides the badge
	// rather than showing a placeholder.
	Certification string `json:"certification,omitempty"`
	// Collection is the film franchise this title belongs to, if any. TMDB only
	// models collections for movies, so this is always nil for TV. It is the
	// summary only: the films themselves come from
	// GET /api/media/collection/:id, which the client asks for only when this
	// is present, keeping the extra TMDB call off the detail screen's critical
	// path.
	Collection *CollectionSummary `json:"collection,omitempty"`
	// Recommendations are the "more like this" titles for the related row,
	// already trimmed to the fields a list card draws, de-duplicated against
	// this title, and capped. Absent when TMDB has nothing to suggest.
	Recommendations []TMDBMedia `json:"recommendations,omitempty"`
	// Posters holds a few alternate poster variants. List cards always draw
	// `poster_path`, so the detail hero picks one of these instead of repeating
	// the exact artwork the user just tapped.
	Posters []Image `json:"posters,omitempty"`
}

type tmdbCredits struct {
	Cast []CastMember `json:"cast"`
}

type tmdbImagesResponse struct {
	Logos   []Image `json:"logos"`
	Posters []Image `json:"posters"`
}

type tmdbVideosResult struct {
	Results []Video `json:"results"`
}

// tmdbReleaseDateInfo is one release entry within a country's release-dates
// block. `type` is TMDB's release-type code: 1 premiere, 2 theatrical
// (limited), 3 theatrical, 4 digital, 5 physical, 6 TV.
type tmdbReleaseDateInfo struct {
	Certification string `json:"certification"`
	Type          int    `json:"type"`
}

type tmdbReleaseDatesResult struct {
	Iso3166_1    string                `json:"iso_3166_1"`
	ReleaseDates []tmdbReleaseDateInfo `json:"release_dates"`
}

// tmdbReleaseDatesResponse is the wire shape of `/movie/{id}/release_dates`,
// also available as an append to the movie details request.
type tmdbReleaseDatesResponse struct {
	Results []tmdbReleaseDatesResult `json:"results"`
}

type tmdbContentRating struct {
	Iso3166_1 string `json:"iso_3166_1"`
	Rating    string `json:"rating"`
}

// tmdbContentRatingsResponse is the wire shape of
// `/tv/{id}/content_ratings`, also available as an append to the TV details
// request. TV has no release-dates equivalent for ratings: `rating` is already
// the "TV-MA"/"TV-14" string the client shows.
type tmdbContentRatingsResponse struct {
	Results []tmdbContentRating `json:"results"`
}

// tmdbRecommendationsResponse covers both `/recommendations` and `/similar`,
// which share the same list shape.
type tmdbRecommendationsResponse struct {
	Results []TMDBMedia `json:"results"`
}

// tmdbCollectionResponse is the wire shape of `/collection/{id}`.
type tmdbCollectionResponse struct {
	ID           int64       `json:"id"`
	Name         string      `json:"name"`
	Overview     string      `json:"overview"`
	PosterPath   string      `json:"poster_path"`
	BackdropPath string      `json:"backdrop_path"`
	Parts        []TMDBMedia `json:"parts"`
}

// CollectionSummary is the franchise a movie belongs to, sent inline with the
// details payload. It is TMDB's `belongs_to_collection` under a shorter name,
// and it deliberately excludes the films: those come from
// GET /api/media/collection/:id so that the details request stays one TMDB call.
type CollectionSummary struct {
	ID           int64  `json:"id"`
	Name         string `json:"name"`
	PosterPath   string `json:"poster_path,omitempty"`
	BackdropPath string `json:"backdrop_path,omitempty"`
}

// CollectionDetails is a franchise and its films, as served by
// GET /api/media/collection/:id.
type CollectionDetails struct {
	ID           int64       `json:"id"`
	Name         string      `json:"name"`
	Overview     string      `json:"overview"`
	PosterPath   string      `json:"poster_path"`
	BackdropPath string      `json:"backdrop_path"`
	Parts        []TMDBMedia `json:"parts"`
}

type tmdbMediaDetailsResponse struct {
	MediaDetails
	ExternalIDs         tmdbExternalIDs             `json:"external_ids"`
	Credits             tmdbCredits                 `json:"credits"`
	Images              tmdbImagesResponse          `json:"images"`
	Videos              tmdbVideosResult            `json:"videos"`
	Networks            []Network                   `json:"networks"`
	BelongsToCollection *CollectionSummary          `json:"belongs_to_collection"`
	ReleaseDates        tmdbReleaseDatesResponse    `json:"release_dates"`
	ContentRatings      tmdbContentRatingsResponse  `json:"content_ratings"`
	Recommendations     tmdbRecommendationsResponse `json:"recommendations"`
}

type tmdbExternalIDs struct {
	IMDBID string `json:"imdb_id"`
}

// TMDBResponse matches the list response from TMDB endpoints
type TMDBResponse struct {
	Page    int         `json:"page"`
	Results []TMDBMedia `json:"results"`
}

// DiscoverResponse is the clean, combined object returned to the frontend
type DiscoverResponse struct {
	Trending      []TMDBMedia `json:"trending"`
	Popular       []TMDBMedia `json:"popular"`
	PopularSeries []TMDBMedia `json:"popular_series"`
}

// Cache holds the cached DiscoverResponse and its expiration time
type Cache struct {
	sync.RWMutex
	data      *DiscoverResponse
	expiresAt time.Time
	duration  time.Duration
}

// Request and Response bodies
type SignupReq struct {
	Email    string `json:"email" binding:"required,email"`
	Password string `json:"password" binding:"required,min=6"`
}

type LoginReq struct {
	Email    string `json:"email" binding:"required"`
	Password string `json:"password" binding:"required"`
}

type UpdateProfileReq struct {
	Name                 *string `json:"name"`
	AvatarURL            *string `json:"avatar_url"`
	NotificationsEnabled *bool   `json:"notifications_enabled"`
}
