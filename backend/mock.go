package main

import (
	"fmt"
)

func getMockDiscoverData() *DiscoverResponse {
	// Realistic, high-fidelity mock data using actual TMDB poster/backdrop paths
	// and details to ensure a gorgeous layout even without an API key.
	trending := []TMDBMedia{
		{
			ID:           558449,
			Title:        "Gladiator II",
			PosterPath:   "/2cxhv044tcl7eVm26LsGs4886tq.jpg",
			BackdropPath: "/3V4kDRpwBMj4NfbORkZIIjK2mIE.jpg",
			VoteAverage:  6.8,
			MediaType:    "movie",
			ReleaseDate:  "2024-11-05",
		},
		{
			ID:           939243,
			Title:        "Sonic the Hedgehog 3",
			PosterPath:   "/d8Ruo3Q5Z36K3x2rJ4t5ehZ0P6q.jpg",
			BackdropPath: "/zfbjgqjCpwlxXgny7aPQptQ4vF5.jpg",
			VoteAverage:  7.8,
			MediaType:    "movie",
			ReleaseDate:  "2024-12-19",
		},
		{
			ID:           135397,
			Name:         "Squid Game",
			PosterPath:   "/1xsGGB446l59er765XvFWfhVxK.jpg",
			BackdropPath: "/yg0ihCPPn0Zc7x570hCkiR3rSp5.jpg",
			VoteAverage:  7.9,
			MediaType:    "tv",
			FirstAirDate: "2021-09-17",
		},
		{
			ID:           402431,
			Title:        "Wicked",
			PosterPath:   "/2nuK5Wtb76xS47TveQG6S65dNdD.jpg",
			BackdropPath: "/uKb2jW2SNee5T58Cn7g6225Xcl1.jpg",
			VoteAverage:  7.4,
			MediaType:    "movie",
			ReleaseDate:  "2024-11-20",
		},
		{
			ID:           119051,
			Name:         "Wednesday",
			PosterPath:   "/9PFw32r216Teg3LgolnACz7VAat.jpg",
			BackdropPath: "/iHjx1zR12948yR9Vsc4Z648wv2u.jpg",
			VoteAverage:  8.0,
			MediaType:    "tv",
			FirstAirDate: "2022-11-23",
		},
		{
			ID:           1022789,
			Title:        "Inside Out 2",
			PosterPath:   "/vpnVM9B6NMmFJWqRKxOKDmqnNJr.jpg",
			BackdropPath: "/stKG8fbvqvPAywj67HgkWh4IQUg.jpg",
			VoteAverage:  7.6,
			MediaType:    "movie",
			ReleaseDate:  "2024-06-11",
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
			ReleaseDate:  "2024-12-19",
		},
		{
			ID:           558449,
			Title:        "Gladiator II",
			PosterPath:   "/2cxhv044tcl7eVm26LsGs4886tq.jpg",
			BackdropPath: "/3V4kDRpwBMj4NfbORkZIIjK2mIE.jpg",
			VoteAverage:  6.8,
			MediaType:    "movie",
			ReleaseDate:  "2024-11-05",
		},
		{
			ID:           762509,
			Title:        "Mufasa: The Lion King",
			PosterPath:   "/7C92170o6AXTVRlbbG36O60H0jB.jpg",
			BackdropPath: "/oHGlUzUi3t6q6VIPiOAXmgEH66c.jpg",
			VoteAverage:  7.1,
			MediaType:    "movie",
			ReleaseDate:  "2024-12-18",
		},
		{
			ID:           1241982,
			Title:        "Moana 2",
			PosterPath:   "/yh64goTFrm21Sfl7L08j5l7LGn7.jpg",
			BackdropPath: "/h7rJvl7vl45615nZOC6ZfxmZuu6.jpg",
			VoteAverage:  7.0,
			MediaType:    "movie",
			ReleaseDate:  "2024-11-27",
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
			FirstAirDate: "2021-09-17",
		},
		{
			ID:           119051,
			Name:         "Wednesday",
			PosterPath:   "/9PFw32r216Teg3LgolnACz7VAat.jpg",
			BackdropPath: "/iHjx1zR12948yR9Vsc4Z648wv2u.jpg",
			VoteAverage:  8.0,
			MediaType:    "tv",
			FirstAirDate: "2022-11-23",
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
		episodes = append(episodes, Episode{
			ID:            int64(i),
			Name:          fmt.Sprintf("Episode %d", i),
			Overview:      fmt.Sprintf("Overview for episode %d.", i),
			EpisodeNumber: int64(i),
			SeasonNumber:  seasonNum,
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
	lookup := map[int64]MediaDetails{
		558449: {
			TMDBMedia: TMDBMedia{
				ID:           558449,
				Title:        "Gladiator II",
				PosterPath:   "/2cxhv044tcl7eVm26LsGs4886tq.jpg",
				BackdropPath: "/3V4kDRpwBMj4NfbORkZIIjK2mIE.jpg",
				VoteAverage:  6.8,
				MediaType:    "movie",
				ReleaseDate:  "2024-11-05",
			},
			Runtime:  148,
			Overview: "Years after witnessing the death of Maximus, Lucius is forced to enter the Colosseum after his home is conquered by tyrannical emperors who now lead Rome.",
			Genres:   []Genre{{ID: 28, Name: "Action"}, {ID: 12, Name: "Adventure"}, {ID: 18, Name: "Drama"}},
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
				ReleaseDate:  "2024-12-19",
			},
			Runtime:  110,
			Overview: "Sonic, Knuckles, and Tails reunite against a powerful new adversary, Shadow, whose abilities force them to seek an unlikely alliance.",
			Genres:   []Genre{{ID: 28, Name: "Action"}, {ID: 35, Name: "Comedy"}, {ID: 10751, Name: "Family"}},
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
				FirstAirDate: "2021-09-17",
			},
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
				ReleaseDate:  "2024-11-20",
			},
			Runtime:  160,
			Overview: "Elphaba, misunderstood because of her green skin, forms an unlikely friendship with Glinda before their lives take very different turns in Oz.",
			Genres:   []Genre{{ID: 18, Name: "Drama"}, {ID: 14, Name: "Fantasy"}, {ID: 10749, Name: "Romance"}},
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
				FirstAirDate: "2022-11-23",
			},
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
				ReleaseDate:  "2024-06-11",
			},
			Runtime:  97,
			Overview: "Riley enters her teenage years, and Headquarters is suddenly disrupted by new emotions that complicate everything Joy thought she understood.",
			Genres:   []Genre{{ID: 16, Name: "Animation"}, {ID: 10751, Name: "Family"}, {ID: 35, Name: "Comedy"}},
			Cast: []CastMember{
				{ID: 56322, Name: "Amy Poehler", ProfilePath: "/hBJO9rVtO7SeC1FO8VBXMu5pM7v.jpg"},
				{ID: 86122, Name: "Maya Hawke", ProfilePath: "/jGiaJCPK0Y3jK62Cu6WKhG6WnTj.jpg"},
				{ID: 41088, Name: "Phyllis Smith", ProfilePath: "/wF4wltUcXlbYAIxzLkFo6ANkcTz.jpg"},
			},
		},
	}

	details, ok := lookup[id]
	if !ok || details.MediaType != mediaType {
		return nil, false
	}
	return &details, true
}
