import { useFocusEffect, useRouter } from "expo-router";
import { Image } from "expo-image";
import { useCallback, useState, useEffect } from "react";
import { Animated } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Button, ScrollView, Spinner, Text, XStack, YStack } from "tamagui";
import { useAuth } from "@/context/AuthContext";

import {
  BACKDROP_IMAGE_BASE_URL,
  fetchMediaDetails,
  fetchSeasonEpisodes,
  fetchWatchedStatus,
  fetchWatchlist,
  imageUrl,
  markWatched,
  mediaTitle,
  releaseYear,
  removeFromWatchlist,
  type Episode,
  type MediaDetails,
  type TMDBMedia,
} from "@/lib/media-api";

type Tab = "movies" | "tv";

export default function WatchlistScreen() {
  const router = useRouter();
  const { token, isLoading: authLoading } = useAuth();
  const [items, setItems] = useState<TMDBMedia[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<Tab>("movies");

  useEffect(() => {
    if (!authLoading && !token) {
      router.replace("/auth");
    }
  }, [authLoading, token]);

  const loadWatchlist = useCallback(async () => {
    if (!token) return;
    setLoading(true);
    setError(null);
    try {
      setItems(await fetchWatchlist({ filterWatched: true }));
    } catch (err: any) {
      setError(err.message || String(err));
    } finally {
      setLoading(false);
    }
  }, [token]);

  useFocusEffect(
    useCallback(() => {
      if (token) {
        loadWatchlist();
      }
    }, [loadWatchlist, token]),
  );

  if (authLoading) {
    return (
      <YStack f={1} ai="center" jc="center" bg="$background">
        <Spinner size="large" color="$color" />
      </YStack>
    );
  }

  if (!token) {
    return null;
  }

  const removeItem = async (id: number) => {
    const previous = items;
    setItems((current) => current.filter((item) => item.id !== id));
    try {
      await removeFromWatchlist(id);
    } catch (err: any) {
      setItems(previous);
      setError(err.message || String(err));
    }
  };

  const openDetails = (item: TMDBMedia) => {
    const type = item.media_type || (item.title ? "movie" : "tv");
    router.push({
      pathname: "/media/[type]/[id]",
      params: { type, id: String(item.id) },
    } as any);
  };

  const movies = items.filter(
    (item) => (item.media_type || "movie") === "movie",
  );
  const shows = items.filter((item) => item.media_type === "tv");

  const handleFullyWatched = useCallback((id: number) => {
    setItems((current) => current.filter((item) => item.id !== id));
  }, []);

  return (
    <YStack f={1} bg="$background">
      <SafeAreaView style={{ flex: 1 }} edges={["top"]}>
        <YStack f={1} px="$4">
          <XStack mt="$2" mb="$4" ai="center" jc="space-between">
            <YStack>
              <Text fow="900" fos="$9" color="$color">
                Watchlist
              </Text>
              <Text color="$color" opacity={0.5} fos="$2">
                Movies and shows saved for later
              </Text>
            </YStack>
            <Button size="$3" circular chromeless onPress={loadWatchlist}>
              ↻
            </Button>
          </XStack>

          <WatchlistTabs activeTab={activeTab} onChange={setActiveTab} />

          {loading ? (
            <YStack f={1} ai="center" jc="center" gap="$3">
              <Spinner size="large" color="$color" />
              <Text color="$color" opacity={0.5}>
                Loading watchlist...
              </Text>
            </YStack>
          ) : error ? (
            <YStack f={1} ai="center" jc="center" gap="$4">
              <Text color="$red10" ta="center" fow="700">
                {error}
              </Text>
              <Button onPress={loadWatchlist}>Retry</Button>
            </YStack>
          ) : items.length === 0 ? (
            <YStack f={1} ai="center" jc="center" gap="$2" px="$5">
              <Text fow="800" fos="$6" color="$color" ta="center">
                Your watchlist is empty
              </Text>
              <Text color="$color" opacity={0.55} ta="center">
                Add movies and TV shows from Discover and they will land here.
              </Text>
            </YStack>
          ) : (
            <ScrollView
              showsVerticalScrollIndicator={false}
              contentContainerStyle={{ paddingBottom: 120 }}
            >
              {activeTab === "movies" ? (
                <WatchlistGroup
                  title="Movies"
                  items={movies}
                  onOpen={openDetails}
                  onRemove={removeItem}
                />
              ) : (
                <WatchlistGroupTV
                  title="TV Shows"
                  items={shows}
                  onFullyWatched={handleFullyWatched}
                />
              )}
            </ScrollView>
          )}
        </YStack>
      </SafeAreaView>
    </YStack>
  );
}

function WatchlistTabs({
  activeTab,
  onChange,
}: {
  activeTab: Tab;
  onChange: (tab: Tab) => void;
}) {
  return (
    <XStack bg="$backgroundElement" p="$1" borderRadius="$4" mb="$4">
      {(["movies", "tv"] as const).map((tab) => {
        const active = activeTab === tab;
        return (
          <Button
            key={tab}
            flex={1}
            borderRadius="$3"
            bg={active ? "$background" : "transparent"}
            color="$color"
            opacity={active ? 1 : 0.6}
            onPress={() => onChange(tab)}
          >
            {tab === "movies" ? "Movies" : "TV Shows"}
          </Button>
        );
      })}
    </XStack>
  );
}

function WatchlistGroupTV({
  title,
  items,
  onFullyWatched,
}: {
  title: string;
  items: TMDBMedia[];
  onFullyWatched: (id: number) => void;
}) {
  return (
    <YStack gap="$3">
      <XStack ai="center" jc="space-between">
        <Text color="$color" fow="800" fos="$6">
          {title}
        </Text>
        <Text color="$color" opacity={0.45} fos="$1">
          {items.length} items
        </Text>
      </XStack>

      {items.length === 0 ? (
        <YStack py="$5" ai="center" bg="$backgroundElement" borderRadius="$4">
          <Text color="$color" opacity={0.5}>
            No {title.toLowerCase()} saved yet
          </Text>
        </YStack>
      ) : (
        <YStack gap="$3">
          {items.map((item) => (
            <NextEpisodeCard
              key={`${item.media_type || "tv"}-${item.id}`}
              show={item}
              onFullyWatched={onFullyWatched}
            />
          ))}
        </YStack>
      )}
    </YStack>
  );
}

function NextEpisodeCard({
  show,
  onFullyWatched,
}: {
  show: TMDBMedia;
  onFullyWatched: (id: number) => void;
}) {
  const router = useRouter();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [episode, setEpisode] = useState<Episode | null>(null);
  const [showDetails, setShowDetails] = useState<MediaDetails | null>(null);
  const [marking, setMarking] = useState(false);

  const [fadeAnim] = useState(() => new Animated.Value(1));
  const [scaleAnim] = useState(() => new Animated.Value(1));

  const loadNextEpisode = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [watchedStatus, detailsData] = await Promise.all([
        fetchWatchedStatus(show.id, "tv"),
        fetchMediaDetails("tv", show.id),
      ]);

      setShowDetails(detailsData);

      const watchedEpisodes = watchedStatus.episodes || [];
      const watchedCountBySeason: Record<number, number> = {};
      for (const ep of watchedEpisodes) {
        watchedCountBySeason[ep.season] = (watchedCountBySeason[ep.season] || 0) + 1;
      }

      const regularSeasons = (detailsData.seasons || [])
        .filter((s) => s.season_number >= 1)
        .sort((a, b) => a.season_number - b.season_number);
      const specialSeasons = (detailsData.seasons || [])
        .filter((s) => s.season_number === 0);

      const allSeasons = [...regularSeasons, ...specialSeasons];

      let foundNext = false;
      for (const s of allSeasons) {
        const total = s.episode_count;
        const watchedCount = watchedCountBySeason[s.season_number] || 0;
        if (watchedCount < total) {
          const seasonData = await fetchSeasonEpisodes(show.id, s.season_number);
          const nextEp = seasonData.episodes.find(
            (ep) =>
              !watchedEpisodes.some(
                (we) => we.season === ep.season_number && we.episode === ep.episode_number
              )
          );
          if (nextEp) {
            setEpisode(nextEp);
            foundNext = true;
            break;
          }
        }
      }

      if (!foundNext) {
        onFullyWatched(show.id);
      }
    } catch (err: any) {
      setError(err.message || String(err));
    } finally {
      setLoading(false);
    }
  }, [show.id, onFullyWatched]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    loadNextEpisode();
  }, [loadNextEpisode]);

  const animateAndMarkWatched = async () => {
    if (!episode || marking) return;
    setMarking(true);

    // Fade out / scale down slightly before the transition
    Animated.parallel([
      Animated.timing(fadeAnim, {
        toValue: 0,
        duration: 250,
        useNativeDriver: true,
      }),
      Animated.timing(scaleAnim, {
        toValue: 0.95,
        duration: 250,
        useNativeDriver: true,
      }),
    ]).start(async () => {
      try {
        await markWatched({
          media_id: show.id,
          media_type: "tv",
          season_number: episode.season_number,
          episode_number: episode.episode_number,
        });

        const watchedStatus = await fetchWatchedStatus(show.id, "tv");
        const activeDetails = showDetails || (await fetchMediaDetails("tv", show.id));

        const watchedEpisodes = watchedStatus.episodes || [];
        const watchedCountBySeason: Record<number, number> = {};
        for (const ep of watchedEpisodes) {
          watchedCountBySeason[ep.season] = (watchedCountBySeason[ep.season] || 0) + 1;
        }

        const regularSeasons = (activeDetails.seasons || [])
          .filter((s) => s.season_number >= 1)
          .sort((a, b) => a.season_number - b.season_number);
        const specialSeasons = (activeDetails.seasons || [])
          .filter((s) => s.season_number === 0);

        const allSeasons = [...regularSeasons, ...specialSeasons];

        let foundNext = false;
        for (const s of allSeasons) {
          const total = s.episode_count;
          const watchedCount = watchedCountBySeason[s.season_number] || 0;
          if (watchedCount < total) {
            const seasonData = await fetchSeasonEpisodes(show.id, s.season_number);
            const nextEp = seasonData.episodes.find(
              (ep) =>
                !watchedEpisodes.some(
                  (we) => we.season === ep.season_number && we.episode === ep.episode_number
                )
            );
            if (nextEp) {
              setEpisode(nextEp);
              foundNext = true;
              break;
            }
          }
        }

        if (!foundNext) {
          onFullyWatched(show.id);
        } else {
          // Fade back in with the new episode details
          Animated.parallel([
            Animated.timing(fadeAnim, {
              toValue: 1,
              duration: 250,
              useNativeDriver: true,
            }),
            Animated.timing(scaleAnim, {
              toValue: 1,
              duration: 250,
              useNativeDriver: true,
            }),
          ]).start(() => {
            setMarking(false);
          });
        }
      } catch (err: any) {
        setError(err.message || String(err));
        // Reset animation on error
        Animated.parallel([
          Animated.timing(fadeAnim, {
            toValue: 1,
            duration: 200,
            useNativeDriver: true,
          }),
          Animated.timing(scaleAnim, {
            toValue: 1,
            duration: 200,
            useNativeDriver: true,
          }),
        ]).start(() => {
          setMarking(false);
        });
      }
    });
  };

  if (loading) {
    return (
      <YStack
        h={136}
        ai="center"
        jc="center"
        bg="$backgroundElement"
        borderRadius="$4"
        borderWidth={1}
        borderColor="$borderColor"
      >
        <Spinner size="small" color="$color" />
      </YStack>
    );
  }

  if (error) {
    return (
      <YStack
        h={136}
        p="$3"
        ai="center"
        jc="center"
        bg="$backgroundElement"
        borderRadius="$4"
        borderWidth={1}
        borderColor="$borderColor"
        gap="$2"
      >
        <Text color="$red10" fos="$2" ta="center" numberOfLines={2}>
          {error}
        </Text>
        <Button size="$2" onPress={loadNextEpisode}>
          Retry
        </Button>
      </YStack>
    );
  }

  if (!episode) return null;

  const handleCardPress = () => {
    router.push({
      pathname: "/media/[type]/[id]/episode/[season]/[episode]",
      params: {
        type: "tv",
        id: String(show.id),
        season: String(episode.season_number),
        episode: String(episode.episode_number),
      },
    } as any);
  };

  const handleShowPress = (event: any) => {
    event.stopPropagation();
    router.push({
      pathname: "/media/[type]/[id]",
      params: { type: "tv", id: String(show.id) },
    } as any);
  };

  const seasonStr = String(episode.season_number).padStart(2, "0");
  const episodeStr = String(episode.episode_number).padStart(2, "0");

  const imageSource = episode.still_path
    ? imageUrl(episode.still_path)
    : showDetails?.backdrop_path
      ? imageUrl(showDetails.backdrop_path, BACKDROP_IMAGE_BASE_URL)
      : show.poster_path
        ? imageUrl(show.poster_path)
        : null;

  return (
    <Animated.View style={{ opacity: fadeAnim, transform: [{ scale: scaleAnim }] }}>
      <XStack
        gap="$3"
        p="$2"
        borderRadius="$4"
        bg="$backgroundElement"
        borderWidth={1}
        borderColor="$borderColor"
        pressStyle={{ opacity: 0.88 }}
        onPress={handleCardPress}
        ai="center"
      >
        <YStack
          w={96}
          h={64}
          borderRadius="$3"
          overflow="hidden"
          bg="$background"
        >
          {imageSource ? (
            <Image
              source={{ uri: imageSource }}
              style={{ width: "100%", height: "100%" }}
              contentFit="cover"
            />
          ) : (
            <YStack f={1} ai="center" jc="center">
              <Text color="$color" opacity={0.45} fos="$1">
                No art
              </Text>
            </YStack>
          )}
        </YStack>

        <YStack f={1} jc="center" gap="$1" py="$1">
          <Text
            color="$color"
            fow="900"
            fos="$3"
            pressStyle={{ opacity: 0.7 }}
            onPress={handleShowPress}
            numberOfLines={1}
          >
            {mediaTitle(show)}
          </Text>
          <Text color="$color" opacity={0.8} fow="700" fos="$2" numberOfLines={1}>
            S{seasonStr} E{episodeStr} • {episode.name}
          </Text>
          <XStack mt="$1" ai="center" jc="space-between" flexWrap="wrap" gap="$2">
            {episode.air_date ? (
              <Text color="$color" opacity={0.45} fos="$1" numberOfLines={1}>
                {episode.air_date}
              </Text>
            ) : (
              <YStack />
            )}
            <Button
              size="$2"
              theme="purple"
              borderRadius="$3"
              disabled={marking}
              onPress={(event: any) => {
                event.stopPropagation();
                animateAndMarkWatched();
              }}
            >
              {marking ? <Spinner size="small" /> : "✓ Mark Watched"}
            </Button>
          </XStack>
        </YStack>
      </XStack>
    </Animated.View>
  );
}

function WatchlistGroup({
  title,
  items,
  onOpen,
  onRemove,
}: {
  title: string;
  items: TMDBMedia[];
  onOpen: (item: TMDBMedia) => void;
  onRemove: (id: number) => void;
}) {
  return (
    <YStack gap="$3">
      <XStack ai="center" jc="space-between">
        <Text color="$color" fow="800" fos="$6">
          {title}
        </Text>
        <Text color="$color" opacity={0.45} fos="$1">
          {items.length} items
        </Text>
      </XStack>

      {items.length === 0 ? (
        <YStack py="$5" ai="center" bg="$backgroundElement" borderRadius="$4">
          <Text color="$color" opacity={0.5}>
            No {title.toLowerCase()} saved yet
          </Text>
        </YStack>
      ) : (
        <YStack gap="$3">
          {items.map((item) => (
            <WatchlistRow
              key={`${item.media_type}-${item.id}`}
              item={item}
              onOpen={() => onOpen(item)}
              onRemove={() => onRemove(item.id)}
            />
          ))}
        </YStack>
      )}
    </YStack>
  );
}

function WatchlistRow({
  item,
  onOpen,
  onRemove,
}: {
  item: TMDBMedia;
  onOpen: () => void;
  onRemove: () => void;
}) {
  return (
    <XStack
      gap="$3"
      p="$2"
      borderRadius="$4"
      bg="$backgroundElement"
      borderWidth={1}
      borderColor="$borderColor"
      pressStyle={{ opacity: 0.88 }}
      onPress={onOpen}
    >
      <YStack
        w={86}
        h={126}
        borderRadius="$3"
        overflow="hidden"
        bg="$background"
      >
        {item.poster_path ? (
          <Image
            source={{ uri: imageUrl(item.poster_path) }}
            style={{ width: "100%", height: "100%" }}
            contentFit="cover"
          />
        ) : (
          <YStack f={1} ai="center" jc="center">
            <Text color="$color" opacity={0.45}>
              No art
            </Text>
          </YStack>
        )}
      </YStack>

      <YStack f={1} jc="space-between" py="$1">
        <YStack gap="$1">
          <Text color="$color" fow="800" fos="$4" numberOfLines={2}>
            {mediaTitle(item)}
          </Text>
          <Text color="$color" opacity={0.5} fos="$2" tt="uppercase">
            {item.media_type || "movie"} {releaseYear(item)}
          </Text>
        </YStack>
        <XStack ai="center" jc="space-between">
          <Rating value={item.vote_average} />
        </XStack>
      </YStack>
    </XStack>
  );
}

function Rating({ value }: { value: number }) {
  const full = Math.max(0, Math.min(5, Math.round(value / 2)));
  const empty = 5 - full;
  return (
    <XStack ai="center" gap="$1">
      <Text color="$yellow9" fos="$2">
        {"★".repeat(full)}
        {"☆".repeat(empty)}
      </Text>
      <Text color="$color" opacity={0.65} fos="$2">
        {value.toFixed(1)}
      </Text>
    </XStack>
  );
}
