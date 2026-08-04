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

type WatchedItem struct {
	ID            uint      `gorm:"primaryKey" json:"id"`
	UserID        uint      `gorm:"not null;uniqueIndex:idx_user_watched" json:"user_id"`
	MediaID       int64     `gorm:"not null;uniqueIndex:idx_user_watched" json:"media_id"`
	MediaType     string    `gorm:"not null" json:"media_type"`
	SeasonNumber  *int64    `gorm:"uniqueIndex:idx_user_watched" json:"season_number,omitempty"`
	EpisodeNumber *int64    `gorm:"uniqueIndex:idx_user_watched" json:"episode_number,omitempty"`
	WatchedAt     time.Time `json:"watched_at"`
}

// TMDBMedia represents a movie or TV show item from TMDB
type TMDBMedia struct {
	ID           int64   `json:"id"`
	Title        string  `json:"title,omitempty"`
	Name         string  `json:"name,omitempty"`
	PosterPath   string  `json:"poster_path"`
	BackdropPath string  `json:"backdrop_path"`
	VoteAverage  float64 `json:"vote_average"`
	MediaType    string  `json:"media_type,omitempty"`
	ReleaseDate  string  `json:"release_date,omitempty"`
	FirstAirDate string  `json:"first_air_date,omitempty"`
}

type Genre struct {
	ID   int64  `json:"id"`
	Name string `json:"name"`
}

type CastMember struct {
	ID          int64  `json:"id"`
	Name        string `json:"name"`
	ProfilePath string `json:"profile_path"`
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
}

type tmdbCredits struct {
	Cast []CastMember `json:"cast"`
}

type tmdbImagesResponse struct {
	Logos []Image `json:"logos"`
}

type tmdbVideosResult struct {
	Results []Video `json:"results"`
}

type tmdbMediaDetailsResponse struct {
	MediaDetails
	Credits tmdbCredits      `json:"credits"`
	Images  tmdbImagesResponse `json:"images"`
	Videos  tmdbVideosResult   `json:"videos"`
}

// TMDBResponse matches the list response from TMDB endpoints
type TMDBResponse struct {
	Page    int         `json:"page"`
	Results []TMDBMedia `json:"results"`
}

// DiscoverResponse is the clean, combined object returned to the frontend
type DiscoverResponse struct {
	Trending []TMDBMedia `json:"trending"`
	Popular  []TMDBMedia `json:"popular"`
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
