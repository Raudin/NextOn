import React, { useCallback, useState, useEffect, useMemo } from "react";
import { Platform, StyleSheet, TouchableOpacity } from "react-native";
import { useFocusEffect, useRouter } from "expo-router";
import { SafeAreaView } from "react-native-safe-area-context";
import { Button, ScrollView, Spinner, Text, XStack, YStack } from "tamagui";
import { Image } from "expo-image";
import { useAuth } from "@/context/AuthContext";

import { cache } from "@/lib/cache";

import {
  fetchWatchlist,
  fetchWatchedHistory,
  fetchWatchedStatus,
  fetchMediaDetails,
  fetchSeasonEpisodes,
  markWatched,
  imageUrl,
  mediaTitle,
  type TMDBMedia,
  type Episode,
  type MediaDetails,
} from "@/lib/media-api";

const invalidateMediaCaches = async () => {
  try {
    await Promise.all([
      cache.delete("watchlist_items"),
      cache.delete("watchlist_show_progress"),
      cache.delete("home_watchlist_items"),
      cache.delete("home_watched_history"),
      cache.delete("discover_watchlist_ids"),
      cache.delete("home_shows_ready"),
      cache.delete("home_shows_upcoming"),
      cache.delete("home_movies_ready"),
      cache.delete("home_movies_upcoming"),
    ]);
  } catch (err) {
    console.warn("Failed to invalidate media caches:", err);
  }
};


const getCountdownString = (targetDate: Date) => {
  const now = new Date();
  const diffMs = targetDate.getTime() - now.getTime();
  if (diffMs <= 0) return "Released";

  const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));
  if (diffDays >= 7) {
    const diffWeeks = Math.floor(diffDays / 7);
    if (diffWeeks >= 4) {
      const diffMonths = Math.floor(diffDays / 30);
      return `In ${diffMonths} ${diffMonths === 1 ? "month" : "months"}`;
    }
    return `In ${diffWeeks} ${diffWeeks === 1 ? "week" : "weeks"}`;
  }

  const diffHours = Math.floor((diffMs % (1000 * 60 * 60 * 24)) / (1000 * 60 * 60));
  if (diffDays > 0) {
    return `${diffDays}d ${diffHours}h`;
  }
  return `${diffHours}h`;
};

const getGroupHeader = (targetDate: Date) => {
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  const tomorrow = new Date(today);
  tomorrow.setDate(today.getDate() + 1);

  const nextWeek = new Date(today);
  nextWeek.setDate(today.getDate() + 7);

  const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  const days = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

  const formatMonthDay = (d: Date) => {
    return `${months[d.getMonth()]} ${d.getDate()}`;
  };

  const isSameDay = (d1: Date, d2: Date) => {
    return d1.getFullYear() === d2.getFullYear() &&
           d1.getMonth() === d2.getMonth() &&
           d1.getDate() === d2.getDate();
  };

  if (isSameDay(targetDate, today)) {
    return `Today ${formatMonthDay(targetDate)}`;
  }
  if (isSameDay(targetDate, tomorrow)) {
    return `Tomorrow ${formatMonthDay(targetDate)}`;
  }

  if (targetDate > today && targetDate < nextWeek) {
    return `${days[targetDate.getDay()]} ${formatMonthDay(targetDate)}`;
  }

  if (targetDate.getFullYear() !== today.getFullYear()) {
    return `${months[targetDate.getMonth()]} ${targetDate.getFullYear()}`;
  }
  return months[targetDate.getMonth()];
};

interface ResolvedShowItem {
  isTv: true;
  id: number;
  show: TMDBMedia;
  details: MediaDetails;
  episode: Episode;
  formattedDate: string;
  targetDate: Date | null;
}

interface ResolvedMovieItem {
  isTv: false;
  id: number;
  movie: TMDBMedia;
  details: MediaDetails;
  formattedDate: string;
  targetDate: Date | null;
}

export default function HomeScreen() {
  const router = useRouter();
  const { token, isLoading: authLoading } = useAuth();

  const [showsReady, setShowsReady] = useState<ResolvedShowItem[]>([]);
  const [showsUpcoming, setShowsUpcoming] = useState<ResolvedShowItem[]>([]);
  const [moviesReady, setMoviesReady] = useState<ResolvedMovieItem[]>([]);
  const [moviesUpcoming, setMoviesUpcoming] = useState<ResolvedMovieItem[]>([]);

  const [loading, setLoading] = useState(true);
  const [backgroundRefreshing, setBackgroundRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<"tv" | "movies">("tv");
  const [markingId, setMarkingId] = useState<number | null>(null);

  useEffect(() => {
    if (!authLoading && !token) {
      router.replace("/auth");
    }
  }, [authLoading, token, router]);

  const loadData = useCallback(async (forceRefresh = false) => {
    if (!token) return;
    setError(null);

    const cachedShowsReady = await cache.get<ResolvedShowItem[]>("home_shows_ready");
    const cachedShowsUpcoming = await cache.get<ResolvedShowItem[]>("home_shows_upcoming");
    const cachedMoviesReady = await cache.get<ResolvedMovieItem[]>("home_movies_ready");
    const cachedMoviesUpcoming = await cache.get<ResolvedMovieItem[]>("home_movies_upcoming");

    if (cachedShowsReady || cachedShowsUpcoming || cachedMoviesReady || cachedMoviesUpcoming) {
      setShowsReady(cachedShowsReady || []);
      setShowsUpcoming(cachedShowsUpcoming || []);
      setMoviesReady(cachedMoviesReady || []);
      setMoviesUpcoming(cachedMoviesUpcoming || []);
      setLoading(false);
      setBackgroundRefreshing(true);
    } else {
      setLoading(true);
    }

    try {
      const [watchlist] = await Promise.all([
        fetchWatchlist({ filterWatched: true }),
        fetchWatchedHistory(),
      ]);

      const resolvedList = await Promise.allSettled(
        watchlist.map(async (item) => {
          const type = item.media_type || (item.title ? "movie" : "tv");

          if (type === "tv") {
            const [watchedStatus, details] = await Promise.all([
              fetchWatchedStatus(item.id, "tv"),
              fetchMediaDetails("tv", item.id),
            ]);

            const watchedEpisodes = watchedStatus.episodes || [];
            const watchedCountBySeason: Record<number, number> = {};
            for (const ep of watchedEpisodes) {
              watchedCountBySeason[ep.season] = (watchedCountBySeason[ep.season] || 0) + 1;
            }

            const regularSeasons = (details.seasons || [])
              .filter((s) => s.season_number >= 1)
              .sort((a, b) => a.season_number - b.season_number);
            const specialSeasons = (details.seasons || [])
              .filter((s) => s.season_number === 0);

            const allSeasons = [...regularSeasons, ...specialSeasons];

            let nextEp: Episode | null = null;
            for (const s of allSeasons) {
              const total = s.episode_count;
              const watchedCount = watchedCountBySeason[s.season_number] || 0;
              if (watchedCount < total) {
                const seasonData = await fetchSeasonEpisodes(item.id, s.season_number);
                const found = seasonData.episodes.find(
                  (ep) =>
                    !watchedEpisodes.some(
                      (we) => we.season === ep.season_number && we.episode === ep.episode_number
                    )
                );
                if (found) {
                  nextEp = found;
                  break;
                }
              }
            }

            if (nextEp) {
              return {
                isTv: true,
                id: item.id,
                show: item,
                details,
                episode: nextEp,
                formattedDate: nextEp.air_date || "",
              };
            }
          } else {
            // Movie
            const watchedStatus = await fetchWatchedStatus(item.id, "movie");
            if (!watchedStatus.watched) {
              const details = await fetchMediaDetails("movie", item.id);
              return {
                isTv: false,
                id: item.id,
                movie: item,
                details,
                formattedDate: item.release_date || "",
              };
            }
          }
          return null;
        })
      );

      const resolvedItems = resolvedList
        .filter((r): r is PromiseFulfilledResult<any> => r.status === "fulfilled" && r.value !== null)
        .map((r) => r.value);

      const today = new Date();
      today.setHours(0, 0, 0, 0);

      const nextShowsReady: ResolvedShowItem[] = [];
      const nextShowsUpcoming: ResolvedShowItem[] = [];
      const nextMoviesReady: ResolvedMovieItem[] = [];
      const nextMoviesUpcoming: ResolvedMovieItem[] = [];

      for (const resolved of resolvedItems) {
        const dateStr = resolved.formattedDate;
        let targetDate: Date | null = null;
        if (dateStr) {
          const parts = dateStr.split("-");
          if (parts.length === 3) {
            targetDate = new Date(Number(parts[0]), Number(parts[1]) - 1, Number(parts[2]));
          }
        }

        const isUnreleasedItem = targetDate && targetDate > today;

        if (resolved.isTv) {
          if (isUnreleasedItem) {
            nextShowsUpcoming.push({ ...resolved, targetDate });
          } else {
            nextShowsReady.push({ ...resolved, targetDate });
          }
        } else {
          if (isUnreleasedItem) {
            nextMoviesUpcoming.push({ ...resolved, targetDate });
          } else {
            nextMoviesReady.push({ ...resolved, targetDate });
          }
        }
      }

      const dateSort = (a: any, b: any) => {
        if (!a.targetDate) return 1;
        if (!b.targetDate) return -1;
        return a.targetDate.getTime() - b.targetDate.getTime();
      };
      nextShowsUpcoming.sort(dateSort);
      nextMoviesUpcoming.sort(dateSort);

      await Promise.all([
        cache.set("home_shows_ready", nextShowsReady),
        cache.set("home_shows_upcoming", nextShowsUpcoming),
        cache.set("home_movies_ready", nextMoviesReady),
        cache.set("home_movies_upcoming", nextMoviesUpcoming),
      ]);

      setShowsReady(nextShowsReady);
      setShowsUpcoming(nextShowsUpcoming);
      setMoviesReady(nextMoviesReady);
      setMoviesUpcoming(nextMoviesUpcoming);

      setError(null);
    } catch (err: any) {
      if (!cachedShowsReady && !cachedShowsUpcoming && !cachedMoviesReady && !cachedMoviesUpcoming) {
        setError(err.message || String(err));
      } else {
        console.warn("Silent home background revalidation failed:", err);
      }
    } finally {
      setLoading(false);
      setBackgroundRefreshing(false);
    }
  }, [token]);

  useFocusEffect(
    useCallback(() => {
      if (token) {
        loadData(false);
      }
    }, [loadData, token])
  );

  const handleMarkWatched = async (item: ResolvedShowItem | ResolvedMovieItem) => {
    if (markingId !== null) return;
    setMarkingId(item.id);

    try {
      if (item.isTv) {
        await markWatched({
          media_id: item.show.id,
          media_type: "tv",
          season_number: item.episode.season_number,
          episode_number: item.episode.episode_number,
        });
      } else {
        await markWatched({
          media_id: item.movie.id,
          media_type: "movie",
        });
      }
      await invalidateMediaCaches();
      await loadData(true);
    } catch (err: any) {
      setError(err.message || "Failed to mark as watched");
    } finally {
      setMarkingId(null);
    }
  };

  const handleCardPress = (item: ResolvedShowItem | ResolvedMovieItem) => {
    if (item.isTv) {
      router.push({
        pathname: "/media/[type]/[id]/episode/[season]/[episode]",
        params: {
          type: "tv",
          id: String(item.show.id),
          season: String(item.episode.season_number),
          episode: String(item.episode.episode_number),
        },
      } as any);
    } else {
      router.push({
        pathname: "/media/[type]/[id]",
        params: {
          type: "movie",
          id: String(item.movie.id),
        },
      } as any);
    }
  };

  const groupedShowsUpcoming = useMemo(() => {
    const groups: Record<string, ResolvedShowItem[]> = {};
    for (const item of showsUpcoming) {
      if (item.targetDate) {
        const header = getGroupHeader(item.targetDate);
        if (!groups[header]) {
          groups[header] = [];
        }
        groups[header].push(item);
      }
    }
    return groups;
  }, [showsUpcoming]);

  const groupedMoviesUpcoming = useMemo(() => {
    const groups: Record<string, ResolvedMovieItem[]> = {};
    for (const item of moviesUpcoming) {
      if (item.targetDate) {
        const header = getGroupHeader(item.targetDate);
        if (!groups[header]) {
          groups[header] = [];
        }
        groups[header].push(item);
      }
    }
    return groups;
  }, [moviesUpcoming]);

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

  const activeReadyList = activeTab === "tv" ? showsReady : moviesReady;
  const activeUpcomingGroups = activeTab === "tv" ? groupedShowsUpcoming : groupedMoviesUpcoming;
  const activeUpcomingKeys = Object.keys(activeUpcomingGroups);

  return (
    <YStack f={1} bg="$background">
      <SafeAreaView style={styles.safeArea} edges={["top"]}>
        <YStack f={1} px="$4" gap="$4">

          {/* Top Tabs Toggle: Shows vs Movies */}
          <XStack mt="$2" ai="center" jc="space-between">
            <XStack gap="$3" ai="center">
              {(["tv", "movies"] as const).map((tab) => {
                const active = activeTab === tab;
                return (
                  <Text
                    key={tab}
                    color="$color"
                    opacity={active ? 1 : 0.6}
                    fow={active ? "900" : "700"}
                    fos={active ? "$10" : "$9"}
                    pressStyle={{ opacity: 0.75 }}
                    onPress={() => setActiveTab(tab)}
                  >
                    {tab === "movies" ? "Movies" : "Shows"}
                  </Text>
                );
              })}
              {backgroundRefreshing && (
                <Spinner size="small" color="$color" opacity={0.6} />
              )}
            </XStack>
            <Button size="$3" circular chromeless onPress={() => loadData(true)}>
              ↻
            </Button>
          </XStack>

          {loading ? (
            <YStack f={1} ai="center" jc="center" gap="$3">
              <Spinner size="large" color="$color" />
              <Text color="$color" opacity={0.5}>
                Loading Schedule...
              </Text>
            </YStack>
          ) : error ? (
            <YStack f={1} ai="center" jc="center" gap="$4">
              <Text color="$red10" ta="center" fow="700">
                {error}
              </Text>
              <Button onPress={() => loadData(true)}>Retry</Button>
            </YStack>
          ) : (activeReadyList.length === 0 && activeUpcomingKeys.length === 0) ? (
            <YStack f={1} ai="center" jc="center" gap="$3" px="$5">
              <Text fow="800" fos="$6" color="$color" ta="center">
                No tracked {activeTab === "tv" ? "shows" : "movies"} in your watchlist
              </Text>
              <Text color="$color" opacity={0.55} ta="center">
                Track {activeTab === "tv" ? "TV shows" : "movies"} by saving them to your watchlist, and they will appear here.
              </Text>
            </YStack>
          ) : (
            <ScrollView
              showsVerticalScrollIndicator={false}
              contentContainerStyle={styles.scrollContent}
            >
              <YStack gap="$5">

                {/* Section 1: Ready to Watch */}
                {activeReadyList.length > 0 && (
                  <YStack gap="$3">
                    <Text fow="900" fos="$5" color="$color">
                      Ready to Watch
                    </Text>
                    <YStack gap="$3">
                      {activeReadyList.map((item) => {
                        const posterPath = item.isTv ? item.show.poster_path : item.movie.poster_path;
                        const posterUrl = posterPath ? imageUrl(posterPath) : null;
                        const title = item.isTv ? mediaTitle(item.show) : mediaTitle(item.movie);

                        // Calculate visual badge text
                        let badgeText = "READY TO WATCH";
                        if (item.isTv) {
                          if (item.episode.episode_number === 1) {
                            badgeText = "NEW SEASON";
                          } else if (item.details?.seasons) {
                            const currentSeason = item.details.seasons.find(s => s.season_number === item.episode.season_number);
                            if (currentSeason && item.episode.episode_number === currentSeason.episode_count) {
                              badgeText = "SEASON FINALE";
                            }
                          }
                        }

                        const detailsText = item.isTv
                          ? `S${item.episode.season_number}, E${item.episode.episode_number}`
                          : `${item.details?.runtime ? `${Math.floor(item.details.runtime / 60)}h ${item.details.runtime % 60}m` : "Movie"}`;

                        const epNameText = item.isTv
                          ? item.episode.name
                          : item.details?.tagline || "Released";

                        const isMarking = markingId === item.id;

                        return (
                          <XStack
                            key={`ready-${item.id}`}
                            gap="$3"
                            p="$3"
                            borderRadius="$4"
                            bg="$backgroundElement"
                            borderWidth={1}
                            borderColor="$borderColor"
                            pressStyle={{ opacity: 0.88 }}
                            onPress={() => handleCardPress(item)}
                            ai="center"
                            jc="space-between"
                          >
                            <XStack gap="$3" f={1} ai="center">
                              <YStack w={60} h={90} borderRadius="$2" overflow="hidden" bg="$background">
                                {posterUrl ? (
                                  <Image
                                    source={{ uri: posterUrl }}
                                    style={styles.posterImage}
                                    contentFit="cover"
                                  />
                                ) : (
                                  <YStack f={1} ai="center" jc="center">
                                    <Text color="$color" opacity={0.45} fos="$1" ta="center">
                                      No art
                                    </Text>
                                  </YStack>
                                )}
                              </YStack>

                              <YStack f={1} gap="$1" py="$1">
                                <Text color="$orange10" fow="bold" fos="$1" letterSpacing={0.5}>
                                  {badgeText}
                                </Text>
                                <Text color="$color" fow="900" fos="$4" numberOfLines={1}>
                                  {title}
                                </Text>
                                <Text color="$color" opacity={0.8} fow="600" fos="$3">
                                  {detailsText}
                                </Text>
                                <Text color="$color" opacity={0.5} fow="500" fos="$2" numberOfLines={1}>
                                  {epNameText}
                                </Text>
                              </YStack>
                            </XStack>

                            {/* Hollow Ring Watched Checkbox */}
                            <TouchableOpacity
                              onPress={(e) => {
                                e.stopPropagation();
                                handleMarkWatched(item);
                              }}
                              disabled={markingId !== null}
                              style={styles.checkmarkTouch}
                            >
                              <YStack
                                w={36}
                                h={36}
                                borderRadius={18}
                                borderWidth={2.5}
                                borderColor="$borderColor"
                                bg="transparent"
                                ai="center"
                                jc="center"
                              >
                                {isMarking ? (
                                  <Spinner size="small" color="$color" />
                                ) : null}
                              </YStack>
                            </TouchableOpacity>
                          </XStack>
                        );
                      })}
                    </YStack>
                  </YStack>
                )}

                {/* Section 2: Grouped Upcoming Schedule */}
                {activeUpcomingKeys.map((header) => {
                  const upcomingItems = activeUpcomingGroups[header];
                  return (
                    <YStack key={`group-${header}`} gap="$3">
                      <XStack ai="center" gap="$2">
                        <Text fow="900" fos="$5" color="$color">
                          {header.split(" ")[0]}
                        </Text>
                        {header.includes(" ") && (
                          <Text fos="$3" color="$color" opacity={0.4} fow="600">
                            {header.split(" ").slice(1).join(" ")}
                          </Text>
                        )}
                      </XStack>

                      <YStack gap="$3">
                        {upcomingItems.map((item) => {
                          const posterPath = item.isTv ? item.show.poster_path : item.movie.poster_path;
                          const posterUrl = posterPath ? imageUrl(posterPath) : null;
                          const title = item.isTv ? mediaTitle(item.show) : mediaTitle(item.movie);

                          // Calculate badge text
                          let badgeText = "UPCOMING";
                          if (item.isTv) {
                            if (item.episode.episode_number === 1) {
                              badgeText = "NEW SEASON";
                            } else if (item.details?.seasons) {
                              const currentSeason = item.details.seasons.find(s => s.season_number === item.episode.season_number);
                              if (currentSeason && item.episode.episode_number === currentSeason.episode_count) {
                                badgeText = "SEASON FINALE";
                              }
                            }
                          }

                          const detailsText = item.isTv
                            ? `Episode ${item.episode.episode_number}`
                            : `${item.details?.runtime ? `${Math.floor(item.details.runtime / 60)}h ${item.details.runtime % 60}m` : "Movie"}`;

                          const countdown = item.targetDate ? getCountdownString(item.targetDate) : "Upcoming";

                          return (
                            <XStack
                              key={`upcoming-${item.id}`}
                              gap="$3"
                              p="$3"
                              borderRadius="$4"
                              bg="$backgroundElement"
                              borderWidth={1}
                              borderColor="$borderColor"
                              pressStyle={{ opacity: 0.88 }}
                              onPress={() => handleCardPress(item)}
                              ai="center"
                              jc="space-between"
                            >
                              <XStack gap="$3" f={1} ai="center">
                                <YStack w={60} h={90} borderRadius="$2" overflow="hidden" bg="$background">
                                  {posterUrl ? (
                                    <Image
                                      source={{ uri: posterUrl }}
                                      style={styles.posterImage}
                                      contentFit="cover"
                                    />
                                  ) : (
                                    <YStack f={1} ai="center" jc="center">
                                      <Text color="$color" opacity={0.45} fos="$1" ta="center">
                                        No art
                                      </Text>
                                    </YStack>
                                  )}
                                </YStack>

                                <YStack f={1} gap="$1" py="$1">
                                  <Text color="$green10" fow="bold" fos="$1" letterSpacing={0.5}>
                                    {badgeText}
                                  </Text>
                                  <Text color="$color" fow="900" fos="$4" numberOfLines={1}>
                                    {title}
                                  </Text>
                                  <Text color="$color" opacity={0.8} fow="600" fos="$3">
                                    {detailsText}
                                  </Text>
                                  <Text color="$color" opacity={0.5} fow="500" fos="$2" numberOfLines={1}>
                                    {item.isTv ? item.episode.name : item.details?.tagline || "Upcoming Release"}
                                  </Text>
                                </YStack>
                              </XStack>

                              {/* Right countdown timer instead of watch circle */}
                              <YStack ai="flex-end" gap="$1" pr="$2">
                                <XStack ai="center" gap="$1">
                                  <Text color="$color" fow="bold" fos="$3">
                                    {countdown}
                                  </Text>
                                </XStack>
                                <Text color="$color" opacity={0.4} fos="$1">
                                  12:00 AM
                                </Text>
                              </YStack>
                            </XStack>
                          );
                        })}
                      </YStack>
                    </YStack>
                  );
                })}

              </YStack>
            </ScrollView>
          )}
        </YStack>
      </SafeAreaView>
    </YStack>
  );
}

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
    paddingTop: Platform.OS === "web" ? 60 : 0,
  },
  scrollContent: {
    paddingBottom: Platform.OS === "web" ? 40 : 120,
  },
  posterImage: {
    width: "100%",
    height: "100%",
  },
  checkmarkTouch: {
    padding: 6,
    alignItems: "center",
    justifyContent: "center",
  },
});
