import { useFocusEffect, useRouter } from "expo-router";
import { Image } from "expo-image";
import { useCallback, useState, useEffect, useMemo } from "react";
import { Animated, Platform, StyleSheet } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Button, ScrollView, Spinner, Text, XStack, YStack } from "tamagui";
import { useAuth } from "@/context/AuthContext";

import {
  fetchMediaDetails,
  fetchSeasonEpisodes,
  fetchWatchedStatus,
  fetchWatchlist,
  fetchWatchedHistory,
  imageUrl,
  markWatched,
  mediaTitle,
  type Episode,
  type MediaDetails,
  type TMDBMedia,
  type WatchedItem,
} from "@/lib/media-api";

function getLevelTitle(level: number): string {
  if (level < 3) return "Binge Novice";
  if (level < 6) return "Screen Cadet";
  if (level < 10) return "Episode Enthusiast";
  if (level < 15) return "Serial Streamer";
  if (level < 21) return "Binge Commander";
  if (level < 31) return "Showmaster";
  return "Couch Emperor";
}

function calculateStreak(watchedItems: WatchedItem[]): number {
  if (!watchedItems || watchedItems.length === 0) return 0;

  const uniqueDates = Array.from(
    new Set(
      watchedItems
        .map((item) => {
          if (!item.watched_at) return null;
          const date = new Date(item.watched_at);
          const year = date.getFullYear();
          const month = String(date.getMonth() + 1).padStart(2, "0");
          const day = String(date.getDate()).padStart(2, "0");
          return `${year}-${month}-${day}`;
        })
        .filter((d): d is string => d !== null)
    )
  ).sort((a, b) => b.localeCompare(a));

  if (uniqueDates.length === 0) return 0;

  const getLocalDateString = (date: Date) => {
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, "0");
    const day = String(date.getDate()).padStart(2, "0");
    return `${year}-${month}-${day}`;
  };

  const todayStr = getLocalDateString(new Date());
  const yesterday = new Date();
  yesterday.setDate(yesterday.getDate() - 1);
  const yesterdayStr = getLocalDateString(yesterday);

  const mostRecent = uniqueDates[0];
  if (mostRecent !== todayStr && mostRecent !== yesterdayStr) {
    return 0;
  }

  let streak = 1;
  let currentDate = new Date(mostRecent);

  for (let i = 1; i < uniqueDates.length; i++) {
    const nextDate = new Date(uniqueDates[i]);
    const diffTime = Math.abs(currentDate.getTime() - nextDate.getTime());
    const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));

    if (diffDays === 1) {
      streak++;
      currentDate = nextDate;
    } else if (diffDays > 1) {
      break;
    }
  }

  return streak;
}

export default function HomeScreen() {
  const router = useRouter();
  const { token, isLoading: authLoading } = useAuth();
  const [watchlistItems, setWatchlistItems] = useState<TMDBMedia[]>([]);
  const [watchedHistory, setWatchedHistory] = useState<WatchedItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!authLoading && !token) {
      router.replace("/auth");
    }
  }, [authLoading, token, router]);

  const loadData = useCallback(async () => {
    if (!token) return;
    setLoading(true);
    setError(null);
    try {
      const [watchlist, watched] = await Promise.all([
        fetchWatchlist({ filterWatched: true }),
        fetchWatchedHistory(),
      ]);
      setWatchlistItems(watchlist);
      setWatchedHistory(watched);
    } catch (err: any) {
      setError(err.message || String(err));
    } finally {
      setLoading(false);
    }
  }, [token]);

  useFocusEffect(
    useCallback(() => {
      if (token) {
        loadData();
      }
    }, [loadData, token])
  );

  const handleFullyWatched = useCallback((id: number) => {
    setWatchlistItems((current) => current.filter((item) => item.id !== id));
  }, []);

  const refreshProfileStats = useCallback(async () => {
    try {
      const watched = await fetchWatchedHistory();
      setWatchedHistory(watched);
    } catch {
      // ignore non-critical refresh failures
    }
  }, []);

  const shows = useMemo(() => {
    return watchlistItems.filter((item) => item.media_type === "tv");
  }, [watchlistItems]);

  const profileStats = useMemo(() => {
    let movies = 0;
    let episodes = 0;
    for (const item of watchedHistory) {
      if (item.media_type === "movie") {
        movies++;
      } else if (item.media_type === "tv") {
        episodes++;
      }
    }
    const xp = (movies * 120) + (episodes * 45);
    const level = Math.floor(xp / 1000);
    const xpInLevel = xp % 1000;
    const percentage = xpInLevel / 1000;
    const title = getLevelTitle(level);
    const streak = calculateStreak(watchedHistory);

    return {
      level,
      title,
      xpInLevel,
      percentage,
      streak,
    };
  }, [watchedHistory]);

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

  return (
    <YStack f={1} bg="$background">
      <SafeAreaView style={[styles.safeArea, { paddingTop: Platform.OS === 'web' ? 70 : 0 }]} edges={["top"]}>
        <YStack f={1} px="$4" gap="$4">
          {/* Top Header: Profile Summary */}
          <YStack
            bg="$backgroundElement"
            p="$4"
            borderRadius="$4"
            borderWidth={1}
            borderColor="$borderColor"
            gap="$3"
          >
            <XStack jc="space-between" ai="center">
              <YStack gap="$1">
                <Text color="$color" fow="900" fos="$5">
                  Lv. {profileStats.level} {profileStats.title}
                </Text>
                <Text color="$color" opacity={0.6} fos="$2">
                  {profileStats.xpInLevel} / 1000 XP
                </Text>
              </YStack>
              <XStack ai="center" gap="$1" bg="$background" px="$3" py="$1.5" borderRadius="$4">
                <Text fos="$4">🔥</Text>
                <Text fow="800" fos="$3" color="$color">
                  {profileStats.streak}-Day Streak
                </Text>
              </XStack>
            </XStack>

            {/* Horizontal progress bar */}
            <YStack h={8} bg="$background" borderRadius="$2" overflow="hidden">
              <YStack
                h="100%"
                w={`${Math.max(2, profileStats.percentage * 100)}%`}
                bg="$green10"
                borderRadius="$2"
              />
            </YStack>
          </YStack>

          {/* Main Section: Up Next */}
          <XStack ai="center" jc="space-between">
            <YStack>
              <Text fow="900" fos="$7" color="$color">
                Up Next
              </Text>
              <Text color="$color" opacity={0.5} fos="$2">
                Continue watching your tracked shows
              </Text>
            </YStack>
            <Button size="$3" circular chromeless onPress={loadData}>
              ↻
            </Button>
          </XStack>

          {loading ? (
            <YStack f={1} ai="center" jc="center" gap="$3">
              <Spinner size="large" color="$color" />
              <Text color="$color" opacity={0.5}>
                Loading Dashboard...
              </Text>
            </YStack>
          ) : error ? (
            <YStack f={1} ai="center" jc="center" gap="$4">
              <Text color="$red10" ta="center" fow="700">
                {error}
              </Text>
              <Button onPress={loadData}>Retry</Button>
            </YStack>
          ) : shows.length === 0 ? (
            <YStack f={1} ai="center" jc="center" gap="$3" px="$5">
              <Text fow="800" fos="$6" color="$color" ta="center">
                No shows in your watchlist
              </Text>
              <Text color="$color" opacity={0.55} ta="center">
                Track TV shows by saving them to your watchlist, and the next episodes will appear here.
              </Text>
            </YStack>
          ) : (
            <ScrollView
              showsVerticalScrollIndicator={false}
              contentContainerStyle={styles.scrollContent}
            >
              <YStack gap="$3">
                {shows.map((show) => (
                  <UpNextCard
                    key={`up-next-${show.id}`}
                    show={show}
                    onFullyWatched={handleFullyWatched}
                    onWatchedMarked={refreshProfileStats}
                  />
                ))}
              </YStack>
            </ScrollView>
          )}
        </YStack>
      </SafeAreaView>
    </YStack>
  );
}

function UpNextCard({
  show,
  onFullyWatched,
  onWatchedMarked,
}: {
  show: TMDBMedia;
  onFullyWatched: (id: number) => void;
  onWatchedMarked: () => void;
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
    loadNextEpisode();
  }, [loadNextEpisode]);

  const animateAndMarkWatched = async () => {
    if (!episode || marking) return;
    setMarking(true);

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

        // Notify parent immediately so XP/streak count refreshes
        onWatchedMarked();

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

  const seasonStr = String(episode.season_number).padStart(2, "0");
  const episodeStr = String(episode.episode_number).padStart(2, "0");

  const imageSource = episode.still_path
    ? imageUrl(episode.still_path)
    : showDetails?.backdrop_path
      ? imageUrl(showDetails.backdrop_path)
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

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
  },
  scrollContent: {
    paddingBottom: Platform.OS === "web" ? 40 : 120,
  },
  posterImage: {
    width: "100%",
    height: "100%",
  },
});
