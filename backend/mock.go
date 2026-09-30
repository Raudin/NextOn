package main

import (
	"fmt"
	"time"
)

func getMockDiscoverData() *DiscoverResponse {
	// Realistic, high-fidelity mock data using actual TMDB poster/backdrop paths
	// and details to ensure a gorgeous layout even without an API key.
	today := time.Now()
	gladiatorDate := today.AddDate(0, -2, 0).Format("2006-01-02")
	sonicDate := today.AddDate(0, -1, 0).Format("2006-01-02")
	squidGameDate := today.AddDate(0, -3, 0).Format("2006-01-02")
	wickedDate := today.AddDate(0, 0, 3).Format("2006-01-02")
	wednesdayDate := today.AddDate(0, -2, 0).Format("2006-01-02")
	insideOutDate := today.AddDate(1, 2, 0).Format("2006-01-02")

	trending := []TMDBMedia{
		{
			ID:           558449,
			Title:        "Gladiator II",
			PosterPath:   "/2cxhv044tcl7eVm26LsGs4886tq.jpg",
			BackdropPath: "/3V4kDRpwBMj4NfbORkZIIjK2mIE.jpg",
			VoteAverage:  6.8,
			MediaType:    "movie",
			ReleaseDate:  gladiatorDate,
		},
		{
			ID:           939243,
			Title:        "Sonic the Hedgehog 3",
			PosterPath:   "/d8Ruo3Q5Z36K3x2rJ4t5ehZ0P6q.jpg",
			BackdropPath: "/zfbjgqjCpwlxXgny7aPQptQ4vF5.jpg",
			VoteAverage:  7.8,
			MediaType:    "movie",
			ReleaseDate:  sonicDate,
		},
		{
			ID:           135397,
			Name:         "Squid Game",
			PosterPath:   "/1xsGGB446l59er765XvFWfhVxK.jpg",
			BackdropPath: "/yg0ihCPPn0Zc7x570hCkiR3rSp5.jpg",
			VoteAverage:  7.9,
			MediaType:    "tv",
			FirstAirDate: squidGameDate,
		},
		{
			ID:           402431,
			Title:        "Wicked",
			PosterPath:   "/2nuK5Wtb76xS47TveQG6S65dNdD.jpg",
			BackdropPath: "/uKb2jW2SNee5T58Cn7g6225Xcl1.jpg",
			VoteAverage:  7.4,
			MediaType:    "movie",
			ReleaseDate:  wickedDate,
		},
		{
			ID:           119051,
			Name:         "Wednesday",
			PosterPath:   "/9PFw32r216Teg3LgolnACz7VAat.jpg",
			BackdropPath: "/iHjx1zR12948yR9Vsc4Z648wv2u.jpg",
			VoteAverage:  8.0,
			MediaType:    "tv",
			FirstAirDate: wednesdayDate,
		},
		{
			ID:           1022789,
			Title:        "Inside Out 2",
			PosterPath:   "/vpnVM9B6NMmFJWqRKxOKDmqnNJr.jpg",
			BackdropPath: "/stKG8fbvqvPAywj67HgkWh4IQUg.jpg",
			VoteAverage:  7.6,
			MediaType:    "movie",
			ReleaseDate:  insideOutDate,
		},
	}

	popular := []TMDBMedia{
		{
			ID:           939243,
			Title:        "Sonic the Hedgehog 3",
			PosterPath:   "/d8Ruo3Q5Z36K3x2rJ4t5ehZ0P6q.jpg",
			BackdropPath: "/zfbjgqjCpwlxXgny7aPQptQ4vF5.jpg",
			VoteAverage:  7.8,
			MediaType:    "movie",
			ReleaseDate:  sonicDate,
		},
		{
			ID:           558449,
			Title:        "Gladiator II",
			PosterPath:   "/2cxhv044tcl7eVm26LsGs4886tq.jpg",
			BackdropPath: "/3V4kDRpwBMj4NfbORkZIIjK2mIE.jpg",
			VoteAverage:  6.8,
			MediaType:    "movie",
			ReleaseDate:  gladiatorDate,
		},
		{
			ID:           762509,
			Title:        "Mufasa: The Lion King",
			PosterPath:   "/7C92170o6AXTVRlbbG36O60H0jB.jpg",
			BackdropPath: "/oHGlUzUi3t6q6VIPiOAXmgEH66c.jpg",
			VoteAverage:  7.1,
			MediaType:    "movie",
			ReleaseDate:  gladiatorDate,
		},
		{
			ID:           1241982,
			Title:        "Moana 2",
			PosterPath:   "/yh64goTFrm21Sfl7L08j5l7LGn7.jpg",
			BackdropPath: "/h7rJvl7vl45615nZOC6ZfxmZuu6.jpg",
			VoteAverage:  7.0,
			MediaType:    "movie",
			ReleaseDate:  gladiatorDate,
		},
	}

	popularSeries := []TMDBMedia{
		{
			ID:           135397,
			Name:         "Squid Game",
			PosterPath:   "/1xsGGB446l59er765XvFWfhVxK.jpg",
			BackdropPath: "/yg0ihCPPn0Zc7x570hCkiR3rSp5.jpg",
			VoteAverage:  7.9,
			MediaType:    "tv",
			FirstAirDate: squidGameDate,
		},
		{
			ID:           119051,
			Name:         "Wednesday",
			PosterPath:   "/9PFw32r216Teg3LgolnACz7VAat.jpg",
			BackdropPath: "/iHjx1zR12948yR9Vsc4Z648wv2u.jpg",
			VoteAverage:  8.0,
			MediaType:    "tv",
			FirstAirDate: wednesdayDate,
		},
	}

	return &DiscoverResponse{
		Trending:      trending,
		Popular:       popular,
		PopularSeries: popularSeries,
	}
}

func getMockSeasonDetails(seriesID, seasonNum int64) (*SeasonDetails, bool) {
	if seasonNum < 1 {
		return nil, false
	}
	var count int
	var name string
	switch seriesID {
	case 135397:
		count = 9
		name = "Season 1"
	case 119051:
		count = 8
		name = "Season 1"
	default:
		count = 6
		name = fmt.Sprintf("Season %d", seasonNum)
	}

	episodes := make([]Episode, 0, count)
	for i := 1; i <= count; i++ {
		airDate := time.Now().AddDate(0, 0, -5).Format("2006-01-02") // default 5 days ago
		if seriesID == 135397 {
			// Squid Game Season 1
			if i < 9 {
				// Ep 1-8 released weekly in the past
				airDate = time.Now().AddDate(0, 0, -7*(9-i)).Format("2006-01-02")
			} else {
				// Ep 9 is upcoming (in 2 days)
				airDate = time.Now().AddDate(0, 0, 2).Format("2006-01-02")
			}
		} else if seriesID == 119051 {
			// Wednesday Season 1
			if i < 8 {
				// Ep 1-7 released weekly in the past
				airDate = time.Now().AddDate(0, 0, -7*(8-i)).Format("2006-01-02")
			} else {
				// Ep 8 is upcoming (in 10 days, beyond standard week!)
				airDate = time.Now().AddDate(0, 0, 10).Format("2006-01-02")
			}
		}

		episodes = append(episodes, Episode{
			ID:            int64(i),
			Name:          fmt.Sprintf("Episode %d", i),
			Overview:      fmt.Sprintf("Overview for episode %d.", i),
			EpisodeNumber: int64(i),
			SeasonNumber:  seasonNum,
			AirDate:       airDate,
		})
	}

	return &SeasonDetails{
		ID:           seasonNum,
		SeasonNumber: seasonNum,
		Name:         name,
		Overview:     "",
		Episodes:     episodes,
	}, true
}

func getMockEpisodeDetails(seriesID, seasonNum, episodeNum int64) (*Episode, bool) {
	season, ok := getMockSeasonDetails(seriesID, seasonNum)
	if !ok {
		return nil, false
	}
	for _, ep := range season.Episodes {
		if ep.EpisodeNumber == episodeNum {
			return &ep, true
		}
	}
	return nil, false
}

func getFallbackMediaDetails(mediaType string, id int64) *MediaDetails {
	details := &MediaDetails{
		Overview: "Details are not available without a TMDB API key. Add TMDB_API_KEY to your environment for full data.",
		Genres:   []Genre{},
		Cast:     []CastMember{},
	}
	details.ID = id
	details.MediaType = mediaType
	details.VoteAverage = 0
	if mediaType == "tv" {
		details.Name = fmt.Sprintf("TV Show %d", id)
		details.NumberOfSeasons = 1
		details.Seasons = []Season{
			{ID: 1, SeasonNumber: 1, Name: "Season 1", Overview: "", EpisodeCount: 6},
		}
		details.EpisodeRunTime = []int64{45}
	} else {
		details.Title = fmt.Sprintf("Movie %d", id)
		details.Runtime = 120
	}
	return details
}

func getMockMediaDetails(mediaType string, id int64) (*MediaDetails, bool) {
	today := time.Now()
	gladiatorDate := today.AddDate(0, -2, 0).Format("2006-01-02")
	sonicDate := today.AddDate(0, -1, 0).Format("2006-01-02")
	squidGameDate := today.AddDate(0, -3, 0).Format("2006-01-02")
	wickedDate := today.AddDate(0, 0, 3).Format("2006-01-02")
	wednesdayDate := today.AddDate(0, -2, 0).Format("2006-01-02")
	insideOutDate := today.AddDate(1, 2, 0).Format("2006-01-02")

	lookup := map[int64]MediaDetails{
		558449: {
			TMDBMedia: TMDBMedia{
				ID:           558449,
				Title:        "Gladiator II",
				PosterPath:   "/2cxhv044tcl7eVm26LsGs4886tq.jpg",
				BackdropPath: "/3V4kDRpwBMj4NfbORkZIIjK2mIE.jpg",
				VoteAverage:  6.8,
				MediaType:    "movie",
				ReleaseDate:  gladiatorDate,
			},
			Runtime:       148,
			Certification: "R",
			Overview:      "Years after witnessing the death of Maximus, Lucius is forced to enter the Colosseum after his home is conquered by tyrannical emperors who now lead Rome.",
			Genres:        []Genre{{ID: 28, Name: "Action"}, {ID: 12, Name: "Adventure"}, {ID: 18, Name: "Drama"}},
			Cast: []CastMember{
				{ID: 25072, Name: "Paul Mescal", ProfilePath: "/poKiP6PyjEbi0Cwl34qQJm5C6fB.jpg"},
				{ID: 5292, Name: "Denzel Washington", ProfilePath: "/jj2Gcobpopokal0YstuCQW0ldJ4.jpg"},
				{ID: 1158, Name: "Pedro Pascal", ProfilePath: "/9VYK7oxcqhjd5LAH6ZFJ3XzOlID.jpg"},
			},
		},
		939243: {
			TMDBMedia: TMDBMedia{
				ID:           939243,
				Title:        "Sonic the Hedgehog 3",
				PosterPath:   "/d8Ruo3Q5Z36K3x2rJ4t5ehZ0P6q.jpg",
				BackdropPath: "/zfbjgqjCpwlxXgny7aPQptQ4vF5.jpg",
				VoteAverage:  7.8,
				MediaType:    "movie",
				ReleaseDate:  sonicDate,
			},
			Runtime:       110,
			Certification: "PG",
			Overview:      "Sonic, Knuckles, and Tails reunite against a powerful new adversary, Shadow, whose abilities force them to seek an unlikely alliance.",
			Genres:        []Genre{{ID: 28, Name: "Action"}, {ID: 35, Name: "Comedy"}, {ID: 10751, Name: "Family"}},
			Cast: []CastMember{
				{ID: 222121, Name: "Ben Schwartz", ProfilePath: "/5jVbHfxkLumu9Tcj0SwYv6sk5b5.jpg"},
				{ID: 6384, Name: "Jim Carrey", ProfilePath: "/u0AqTz6Y7GHPCHINS01P7gPvDSb.jpg"},
				{ID: 6383, Name: "Keanu Reeves", ProfilePath: "/4D0PpNI0kmP58hgrwGC3wCjxhnm.jpg"},
			},
		},
		135397: {
			TMDBMedia: TMDBMedia{
				ID:           135397,
				Name:         "Squid Game",
				PosterPath:   "/1xsGGB446l59er765XvFWfhVxK.jpg",
				BackdropPath: "/yg0ihCPPn0Zc7x570hCkiR3rSp5.jpg",
				VoteAverage:  7.9,
				MediaType:    "tv",
				FirstAirDate: squidGameDate,
			},
			Certification:   "TV-MA",
			EpisodeRunTime:  []int64{54},
			NumberOfSeasons: 1,
			Seasons: []Season{
				{ID: 1, SeasonNumber: 1, Name: "Season 1", Overview: "", EpisodeCount: 9, PosterPath: "/1xsGGB446l59er765XvFWfhVxK.jpg"},
			},
			Overview: "Hundreds of cash-strapped players accept a strange invitation to compete in children's games for a tempting prize, but the stakes are deadly.",
			Genres:   []Genre{{ID: 10759, Name: "Action & Adventure"}, {ID: 9648, Name: "Mystery"}, {ID: 18, Name: "Drama"}},
			Cast: []CastMember{
				{ID: 73249, Name: "Lee Jung-jae", ProfilePath: "/dsI2ki9A7hZeSZ4vYd7EUDgL9De.jpg"},
				{ID: 3194501, Name: "Jung Ho-yeon", ProfilePath: "/4GxPdr4tP2FwwiO7kY6r1M8vW6h.jpg"},
				{ID: 65240, Name: "Lee Byung-hun", ProfilePath: "/zLwUqbyzJg1x3yTMSx3o2EusQkA.jpg"},
			},
			Status:  "Returning Series",
			Network: "Netflix",
		},
		402431: {
			TMDBMedia: TMDBMedia{
				ID:           402431,
				Title:        "Wicked",
				PosterPath:   "/2nuK5Wtb76xS47TveQG6S65dNdD.jpg",
				BackdropPath: "/uKb2jW2SNee5T58Cn7g6225Xcl1.jpg",
				VoteAverage:  7.4,
				MediaType:    "movie",
				ReleaseDate:  wickedDate,
			},
			Runtime:       160,
			Certification: "PG",
			Overview:      "Elphaba, misunderstood because of her green skin, forms an unlikely friendship with Glinda before their lives take very different turns in Oz.",
			Genres:        []Genre{{ID: 18, Name: "Drama"}, {ID: 14, Name: "Fantasy"}, {ID: 10749, Name: "Romance"}},
			Cast: []CastMember{
				{ID: 1746573, Name: "Cynthia Erivo", ProfilePath: "/7QzLA6rsML2rKXGIGcH9LwW5z6D.jpg"},
				{ID: 226513, Name: "Ariana Grande", ProfilePath: "/r9Z7A0nD84m1xkFw7sR5B3V34N.jpg"},
				{ID: 1253360, Name: "Jonathan Bailey", ProfilePath: "/xRVasSgB2brLuFj1kq6U34MPo9V.jpg"},
			},
		},
		119051: {
			TMDBMedia: TMDBMedia{
				ID:           119051,
				Name:         "Wednesday",
				PosterPath:   "/9PFw32r216Teg3LgolnACz7VAat.jpg",
				BackdropPath: "/iHjx1zR12948yR9Vsc4Z648wv2u.jpg",
				VoteAverage:  8.0,
				MediaType:    "tv",
				FirstAirDate: wednesdayDate,
			},
			Certification:   "TV-14",
			EpisodeRunTime:  []int64{48},
			NumberOfSeasons: 1,
			Seasons: []Season{
				{ID: 1, SeasonNumber: 1, Name: "Season 1", Overview: "", EpisodeCount: 8, PosterPath: "/9PFw32r216Teg3LgolnACz7VAat.jpg"},
			},
			Overview: "Smart, sarcastic Wednesday Addams investigates a murder spree while making new friends and enemies at Nevermore Academy.",
			Genres:   []Genre{{ID: 10765, Name: "Sci-Fi & Fantasy"}, {ID: 9648, Name: "Mystery"}, {ID: 35, Name: "Comedy"}},
			Cast: []CastMember{
				{ID: 974169, Name: "Jenna Ortega", ProfilePath: "/q1NRzyZQlYkxLY07GO9NVPkQnu8.jpg"},
				{ID: 1245, Name: "Catherine Zeta-Jones", ProfilePath: "/hWK9yghUnL0wA5ZDx4wvAZhU4DT.jpg"},
				{ID: 91804, Name: "Luis Guzman", ProfilePath: "/1n5vWyU6nF48Zxrp9RzcrwB3V4H.jpg"},
			},
			Status:  "Returning Series",
			Network: "Netflix",
		},
		1022789: {
			TMDBMedia: TMDBMedia{
				ID:           1022789,
				Title:        "Inside Out 2",
				PosterPath:   "/vpnVM9B6NMmFJWqRKxOKDmqnNJr.jpg",
				BackdropPath: "/stKG8fbvqvPAywj67HgkWh4IQUg.jpg",
				VoteAverage:  7.6,
				MediaType:    "movie",
				ReleaseDate:  insideOutDate,
			},
			Runtime:       97,
			Certification: "PG",
			Overview:      "Riley enters her teenage years, and Headquarters is suddenly disrupted by new emotions that complicate everything Joy thought she understood.",
			Genres:        []Genre{{ID: 16, Name: "Animation"}, {ID: 10751, Name: "Family"}, {ID: 35, Name: "Comedy"}},
			Cast: []CastMember{
				{ID: 56322, Name: "Amy Poehler", ProfilePath: "/hBJO9rVtO7SeC1FO8VBXMu5pM7v.jpg"},
				{ID: 86122, Name: "Maya Hawke", ProfilePath: "/jGiaJCPK0Y3jK62Cu6WKhG6WnTj.jpg"},
				{ID: 41088, Name: "Phyllis Smith", ProfilePath: "/wF4wltUcXlbYAIxzLkFo6ANkcTz.jpg"},
			},
		},
	}

	// Recommendations and the franchise are wired from the same catalogue rather
	// than duplicated, so mock mode exercises the related and collection rows
	// with artwork the rest of the mock data already uses.
	catalog := func(ids ...int64) []TMDBMedia {
		out := make([]TMDBMedia, 0, len(ids))
		for _, id := range ids {
			if item, ok := lookup[id]; ok {
				out = append(out, item.TMDBMedia)
			}
		}
		return out
	}
	if gladiator, ok := lookup[558449]; ok {
		gladiator.Collection = &CollectionSummary{
			ID:         mockGladiatorCollectionID,
			Name:       "Gladiator Collection",
			PosterPath: "/41RyTMtScaSYJ5ZHwOrkv3NJKEv.jpg",
		}
		gladiator.Recommendations = catalog(402431, 939243, 1022789)
		lookup[558449] = gladiator
	}
	if sonic, ok := lookup[939243]; ok {
		sonic.Recommendations = catalog(1022789, 558449)
		lookup[939243] = sonic
	}
	if squidGame, ok := lookup[135397]; ok {
		squidGame.Recommendations = catalog(119051)
		lookup[135397] = squidGame
	}

	details, ok := lookup[id]
	if !ok || details.MediaType != mediaType {
		return nil, false
	}
	return &details, true
}

// mockGladiatorCollectionID is the real TMDB collection the mock Gladiator II
// entry belongs to, so the details payload and the collection endpoint agree in
// mock mode.
const mockGladiatorCollectionID = 1069584

// getMockCollectionDetails serves the one franchise the mock catalogue knows
// about. Films are listed oldest first, matching what the real handler returns.
func getMockCollectionDetails(collectionID int64) (*CollectionDetails, bool) {
	if collectionID != mockGladiatorCollectionID {
		return nil, false
	}
	return &CollectionDetails{
		ID:           mockGladiatorCollectionID,
		Name:         "Gladiator Collection",
		Overview:     "The story of a Roman general's fight for revenge, and of the legacy it leaves behind.",
		PosterPath:   "/41RyTMtScaSYJ5ZHwOrkv3NJKEv.jpg",
		BackdropPath: "/j36t8sTYJfxH0WDsyqL0LF0eyDT.jpg",
		Parts: []TMDBMedia{
			{
				ID:           98,
				Title:        "Gladiator",
				PosterPath:   "/wN2xWp1eIwCKOD0BHTcErTBv1Uq.jpg",
				BackdropPath: "/Ar7QuJ7sJEiC0oP3I8fKBKIQD9u.jpg",
				VoteAverage:  8.2,
				MediaType:    "movie",
				ReleaseDate:  "2000-05-04",
			},
			{
				ID:           558449,
				Title:        "Gladiator II",
				PosterPath:   "/2cxhv044tcl7eVm26LsGs4886tq.jpg",
				BackdropPath: "/3V4kDRpwBMj4NfbORkZIIjK2mIE.jpg",
				VoteAverage:  6.8,
				MediaType:    "movie",
				ReleaseDate:  time.Now().AddDate(0, -2, 0).Format("2006-01-02"),
			},
		},
	}, true
}
