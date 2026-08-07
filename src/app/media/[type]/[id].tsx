import { Image } from "expo-image";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useCallback, useEffect, useMemo, useState } from "react";
import { Alert, Linking, StyleSheet, TouchableOpacity } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Button, ScrollView, Spinner, Text, XStack, YStack } from "tamagui";
import { useAuth } from "@/context/AuthContext";
import { cache } from "@/lib/cache";

import {
  BACKDROP_IMAGE_BASE_URL,
  IMAGE_BASE_URL,
  PROFILE_IMAGE_BASE_URL,
  addToWatchlist,
  fetchMediaDetails,
  fetchSeasonEpisodes,
  fetchWatchedStatus,
  fetchWatchlist,
  imageUrl,
  markWatched,
  markWatchedBulk,
  mediaTitle,
  removeFromWatchlist,
  unmarkWatched,
  type Episode,
  type MediaDetails,
  type Season,
} from "@/lib/media-api";

const invalidateMediaCaches = async () => {
  try {
    await Promise.all([
      cache.delete("watchlist_items"),
      cache.delete("watchlist_show_progress"),
      cache.delete("home_watchlist_items"),
      cache.delete("home_watched_history"),
      cache.delete("discover_watchlist_ids"),
    ]);
  } catch (err) {
    console.warn("Failed to invalidate media caches:", err);
  }
};

export default function MediaDetailScreen() {
  const router = useRouter();
  const { token } = useAuth();
  const params = useLocalSearchParams<{ type: string; id: string }>();
  const [details, setDetails] = useState<MediaDetails | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [inWatchlist, setInWatchlist] = useState(false);
  const [watchlistLoading, setWatchlistLoading] = useState(false);
  const [watched, setWatched] = useState(false);
  const [watchedLoading, setWatchedLoading] = useState(false);
  const [activeTab, setActiveTab] = useState<"overview" | "episodes">(
    "overview",
  );
  const [expandedSeasons, setExpandedSeasons] = useState<Set<number>>(
    new Set(),
  );
  const [seasonEpisodes, setSeasonEpisodes] = useState<
    Record<number, Episode[]>
  >({});
  const [seasonLoading, setSeasonLoading] = useState<Set<number>>(new Set());
  const [watchedEpisodes, setWatchedEpisodes] = useState<Set<string>>(
    new Set(),
  );

  const isMovie = params.type === "movie";
  const isTv = params.type === "tv";

  const runtime = useMemo(() => {
    if (!details) {
      return "";
    }
    if (details.runtime) {
      const hours = Math.floor(details.runtime / 60);
      const minutes = details.runtime % 60;
      return hours > 0 ? `${hours}h ${minutes}m` : `${minutes}m`;
    }
    if (details.episode_run_time?.[0]) {
      return `${details.episode_run_time[0]}m episodes`;
    }
    return "";
  }, [details]);

  const trailer = useMemo(() => {
    if (!details?.trailers) return null;
    return (
      details.trailers.find(
        (v) => v.site === "YouTube" && v.type === "Trailer",
      ) ||
      details.trailers.find(
        (v) => v.site === "YouTube" && v.type === "Teaser",
      ) ||
      null
    );
  }, [details]);

  const logo = useMemo(() => {
    if (!details?.logos || details.logos.length === 0) return null;
    return details.logos[0];
  }, [details]);

  const loadAll = useCallback(async () => {
    if (!params.type || !params.id) {
      return;
    }
    setLoading(true);
    setError(null);
    try {
      if (token) {
        const [detailsData, watchlist, watchedStatus] = await Promise.all([
          fetchMediaDetails(params.type, params.id),
          fetchWatchlist(),
          fetchWatchedStatus(params.id, params.type),
        ]);
        setDetails(detailsData);
        setInWatchlist(watchlist.some((item) => item.id === detailsData.id));
        if (isMovie) {
          setWatched(watchedStatus.watched ?? false);
        } else if (watchedStatus.episodes) {
          const next = new Set<string>();
          for (const ep of watchedStatus.episodes) {
            next.add(`${ep.season}:${ep.episode}`);
          }
          setWatchedEpisodes(next);
        }
      } else {
        const detailsData = await fetchMediaDetails(params.type, params.id);
        setDetails(detailsData);
        setInWatchlist(false);
        setWatched(false);
        setWatchedEpisodes(new Set());
      }
    } catch (err: any) {
      setError(err.message || String(err));
    } finally {
      setLoading(false);
    }
  }, [params.type, params.id, isMovie, token]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    loadAll();
  }, [loadAll, token]);

  const toggleSeason = useCallback(async (seasonNumber: number) => {
    setExpandedSeasons((prev) => {
      const next = new Set(prev);
      if (next.has(seasonNumber)) {
        next.delete(seasonNumber);
      } else {
        next.add(seasonNumber);
      }
      return next;
    });

    if (seasonEpisodes[seasonNumber] || seasonLoading.has(seasonNumber)) {
      return;
    }

    setSeasonLoading((prev) => new Set(prev).add(seasonNumber));
    try {
      const data = await fetchSeasonEpisodes(params.id, seasonNumber);
      setSeasonEpisodes((prev) => ({ ...prev, [seasonNumber]: data.episodes }));
    } catch (err: any) {
      setError(err.message || String(err));
    } finally {
      setSeasonLoading((prev) => {
        const next = new Set(prev);
        next.delete(seasonNumber);
        return next;
      });
    }
  }, [params.id, seasonEpisodes, seasonLoading]);

  const toggleWatchlist = async () => {
    if (!token) {
      router.push("/auth");
      return;
    }
    if (!details || watchlistLoading) {
      return;
    }
    const next = !inWatchlist;
    setInWatchlist(next);
    setWatchlistLoading(true);
    try {
      if (next) {
        await addToWatchlist(details);
      } else {
        await removeFromWatchlist(details.id);
      }
      await invalidateMediaCaches();
    } catch (err: any) {
      setInWatchlist(!next);
      setError(err.message || String(err));
    } finally {
      setWatchlistLoading(false);
    }
  };

  const toggleWatched = async () => {
    if (!token) {
      router.push("/auth");
      return;
    }
    if (!details || !isMovie || watchedLoading) {
      return;
    }
    const next = !watched;
    setWatched(next);
    setWatchedLoading(true);
    try {
      if (next) {
        await markWatched({ media_id: details.id, media_type: "movie" });
      } else {
        await unmarkWatched({ media_id: details.id, media_type: "movie" });
      }
      await invalidateMediaCaches();
    } catch (err: any) {
      setWatched(!next);
      setError(err.message || String(err));
    } finally {
      setWatchedLoading(false);
    }
  };

  const openTrailer = () => {
    if (!trailer) return;
    const url = `https://www.youtube.com/watch?v=${trailer.key}`;
    Linking.openURL(url);
  };

  const isSeen = useMemo(() => {
    if (isMovie) {
      return watched;
    }
    if (!details?.seasons) return false;
    const totalEpisodes = details.seasons
      .filter((season) => season.season_number >= 1)
      .reduce((sum, season) => sum + season.episode_count, 0);
    return totalEpisodes > 0 && watchedEpisodes.size >= totalEpisodes;
  }, [isMovie, watched, details, watchedEpisodes]);

  const toggleAllEpisodesWatched = async (markAsSeen: boolean) => {
    if (!details?.seasons) return;
    setWatchedLoading(true);
    try {
      if (markAsSeen) {
        const seasonRequests = details.seasons
          .filter((s) => s.season_number >= 1)
          .map((s) => fetchSeasonEpisodes(details.id, s.season_number));
        const responses = await Promise.all(seasonRequests);
        const allEpisodes = responses.flatMap((r) => r.episodes);

        const payload = allEpisodes.map((ep) => ({
          media_id: details.id,
          media_type: "tv" as const,
          season_number: ep.season_number,
          episode_number: ep.episode_number,
        }));

        await markWatchedBulk(payload);

        const nextWatched = new Set<string>();
        allEpisodes.forEach((ep) =>
          nextWatched.add(`${ep.season_number}:${ep.episode_number}`)
        );
        setWatchedEpisodes(nextWatched);
        await invalidateMediaCaches();
      } else {
        const promises = Array.from(watchedEpisodes).map((key) => {
          const [season, episode] = key.split(":").map(Number);
          return unmarkWatched({
            media_id: details.id,
            media_type: "tv",
            season_number: season,
            episode_number: episode,
          });
        });
        await Promise.allSettled(promises);
        setWatchedEpisodes(new Set());
        await invalidateMediaCaches();
      }
    } catch (err: any) {
      setError(err.message || String(err));
    } finally {
      setWatchedLoading(false);
    }
  };

  const handleWatchlistButtonPress = async () => {
    if (!token) {
      router.push("/auth");
      return;
    }
    if (watchlistLoading || watchedLoading) return;

    if (!inWatchlist) {
      await toggleWatchlist();
    } else {
      if (isMovie) {
        await toggleWatched();
      } else {
        await toggleAllEpisodesWatched(!isSeen);
      }
    }
  };

  const episodeKey = (season: number, episode: number) =>
    `${season}:${episode}`;

  const toggleEpisode = async (
    episode: Episode,
    seasonEpisodesList: Episode[],
  ) => {
    if (!token) {
      router.push("/auth");
      return;
    }
    if (!details) {
      return;
    }
    const key = episodeKey(episode.season_number, episode.episode_number);
    const currentlyWatched = watchedEpisodes.has(key);

    const markSingle = async () => {
      const payload = {
        media_id: details.id,
        media_type: "tv" as const,
        season_number: episode.season_number,
        episode_number: episode.episode_number,
      };
      if (currentlyWatched) {
        setWatchedEpisodes((prev) => {
          const next = new Set(prev);
          next.delete(key);
          return next;
        });
        try {
          await unmarkWatched(payload);
          await invalidateMediaCaches();
        } catch (err: any) {
          setWatchedEpisodes((prev) => {
            const next = new Set(prev);
            next.add(key);
            return next;
          });
          setError(err.message || String(err));
        }
      } else {
        setWatchedEpisodes((prev) => {
          const next = new Set(prev);
          next.add(key);
          return next;
        });
        try {
          await markWatched(payload);
          await invalidateMediaCaches();
        } catch (err: any) {
          setWatchedEpisodes((prev) => {
            const next = new Set(prev);
            next.delete(key);
            return next;
          });
          setError(err.message || String(err));
        }
      }
    };

    if (currentlyWatched) {
      await markSingle();
      return;
    }

    const index = seasonEpisodesList.findIndex(
      (e) => e.episode_number === episode.episode_number,
    );
    const previousUnwatched = seasonEpisodesList
      .slice(0, index)
      .some(
        (e) =>
          !watchedEpisodes.has(episodeKey(e.season_number, e.episode_number)),
      );

    if (!previousUnwatched) {
      await markSingle();
      return;
    }

    Alert.alert(
      "Mark Previous Episodes?",
      "Would you like to mark all previous episodes of this show as watched too?",
      [
        { text: "No", onPress: markSingle },
        {
          text: "Yes",
          onPress: async () => {
            const toMark = seasonEpisodesList.slice(0, index + 1);
            const next = new Set(watchedEpisodes);
            const payload = toMark.map((e) => ({
              media_id: details.id,
              media_type: "tv" as const,
              season_number: e.season_number,
              episode_number: e.episode_number,
            }));
            toMark.forEach((e) =>
              next.add(episodeKey(e.season_number, e.episode_number)),
            );
            setWatchedEpisodes(next);
            try {
              await markWatchedBulk(payload);
              await invalidateMediaCaches();
            } catch (err: any) {
              setError(err.message || String(err));
              loadAll();
            }
          },
        },
      ],
    );
  };

  const openEpisode = (episode: Episode) => {
    router.push({
      pathname: "/media/[type]/[id]/episode/[season]/[episode]",
      params: {
        type: params.type,
        id: String(params.id),
        season: String(episode.season_number),
        episode: String(episode.episode_number),
      },
    } as any);
  };

  // Status badge color
  const statusColor = useMemo(() => {
    if (!details?.status) return "rgba(255,255,255,0.15)";
    const s = details.status.toLowerCase();
    if (s === "ended" || s === "canceled") return "rgba(255, 80, 80, 0.25)";
    if (s === "returning series" || s === "in production")
      return "rgba(80, 200, 120, 0.25)";
    if (s.includes("coming soon") || s.includes("planned"))
      return "rgba(255, 200, 50, 0.25)";
    return "rgba(255,255,255,0.15)";
  }, [details]);

  return (
    <YStack f={1} bg="$background">
      <SafeAreaView style={{ flex: 1 }} edges={["top"]}>
        {loading ? (
          <YStack f={1} ai="center" jc="center" gap="$3">
            <Spinner size="large" color="$color" />
            <Text color="$color" opacity={0.55}>
              Loading details...
            </Text>
          </YStack>
        ) : error ? (
          <YStack f={1} ai="center" jc="center" gap="$4" px="$4">
            <Text color="$red10" fow="700" ta="center">
              {error}
            </Text>
            <Button onPress={() => router.back()}>Back</Button>
          </YStack>
        ) : details ? (
          <ScrollView
            showsVerticalScrollIndicator={false}
            contentContainerStyle={{ paddingBottom: 120 }}
          >
            {/* Hero Backdrop */}
            <YStack h={420} bg="#151515">
              {details.backdrop_path ? (
                <Image
                  source={{
                    uri: imageUrl(
                      details.backdrop_path,
                      BACKDROP_IMAGE_BASE_URL,
                    ),
                  }}
                  style={{ width: "100%", height: "100%" }}
                  contentFit="cover"
                />
              ) : (
                <YStack f={1} ai="center" jc="center">
                  <Text color="$color" opacity={0.5}>
                    No backdrop available
                  </Text>
                </YStack>
              )}

              {/* Gradient overlay */}
              <YStack style={styles.gradientOverlay} />

              {/* Header row: Back + Title */}
              <YStack
                pos="absolute"
                t={0}
                l={0}
                r={0}
                b={0}
                jc="space-between"
                p="$4"
              >
                {/* Back button */}
                <TouchableOpacity
                  onPress={() => router.back()}
                  style={styles.backButton}
                >
                  <Text color="white" fow="700" fos="$5">
                    ‹
                  </Text>
                </TouchableOpacity>

                {/* Bottom of hero: Status + Logo/Title + Meta + Genres */}
                <YStack gap="$3" ai="center" w="100%">
                  {/* Status badge */}
                  {details.status ? (
                    <XStack jc="center" ai="center">
                      <XStack
                        px="$3"
                        py="$1"
                        borderRadius="$10"
                        bg={statusColor}
                        borderWidth={1}
                        borderColor="rgba(255,255,255,0.2)"
                      >
                        <Text color="white" fow="600" fos="$2">
                          {details.status}
                        </Text>
                      </XStack>
                    </XStack>
                  ) : null}

                  {/* Logo or Title */}
                  {logo ? (
                    <Image
                      source={{
                        uri: imageUrl(logo.file_path, IMAGE_BASE_URL),
                      }}
                      style={styles.logoImage}
                      contentFit="contain"
                    />
                  ) : (
                    <Text
                      color="white"
                      fow="900"
                      fos="$9"
                      numberOfLines={3}
                      ta="center"
                      style={styles.titleText}
                    >
                      {mediaTitle(details)}
                    </Text>
                  )}

                  {/* Genre bullets + runtime/date */}
                  <XStack ai="center" jc="center" gap="$2" flexWrap="wrap" w="100%">
                    {(details.genres ?? []).map((genre, i) => (
                      <XStack key={genre.id} ai="center" gap="$2">
                        {i > 0 && (
                          <YStack
                            w={3}
                            h={3}
                            borderRadius={999}
                            bg="rgba(255,255,255,0.5)"
                          />
                        )}
                        <Text color="white" opacity={0.85} fow="500" fos="$3">
                          {genre.name}
                        </Text>
                      </XStack>
                    ))}
                    {runtime ? (
                      <XStack ai="center" gap="$2">
                        {(details.genres ?? []).length > 0 && (
                          <YStack
                            w={3}
                            h={3}
                            borderRadius={999}
                            bg="rgba(255,255,255,0.5)"
                          />
                        )}
                        <Text color="white" opacity={0.7} fow="500" fos="$3">
                          {runtime}
                        </Text>
                      </XStack>
                    ) : null}
                    {isTv && details.network ? (
                      <XStack ai="center" gap="$2">
                        {((details.genres ?? []).length > 0 || runtime) && (
                          <YStack
                            w={3}
                            h={3}
                            borderRadius={999}
                            bg="rgba(255,255,255,0.5)"
                          />
                        )}
                        <Text color="white" opacity={0.85} fow="500" fos="$3">
                          {details.network}
                        </Text>
                      </XStack>
                    ) : null}
                  </XStack>

                  {/* Action Buttons in Banner */}
                  <XStack gap="$3" ai="center" jc="center" mt="$2" w="100%">
                    <Button
                      f={1}
                      size="$4"
                      borderRadius="$10"
                      bg="transparent"
                      color="white"
                      borderWidth={1}
                      borderColor="rgba(255,255,255,0.4)"
                      disabled={watchlistLoading || watchedLoading}
                      onPress={handleWatchlistButtonPress}
                      iconAfter={(watchlistLoading || watchedLoading) ? <Spinner size="small" color="white" /> : undefined}
                      h={44}
                    >
                      {!inWatchlist ? "+ Watchlist" : isSeen ? "✓ Seen" : "✔ Mark as seen"}
                    </Button>

                    {trailer ? (
                      <Button
                        size="$4"
                        borderRadius="$10"
                        bg="rgba(255,255,255,0.15)"
                        color="white"
                        fontWeight="700"
                        borderWidth={1}
                        borderColor="rgba(255,255,255,0.2)"
                        onPress={openTrailer}
                        px="$4"
                        h={44}
                      >
                        ▶ Trailer
                      </Button>
                    ) : null}

                    {isMovie && (
                      <Button
                        size="$4"
                        borderRadius="$10"
                        w={44}
                        h={44}
                        bg={watched ? "rgba(255, 50, 50, 0.2)" : "rgba(255,255,255,0.1)"}
                        borderWidth={1}
                        borderColor={watched ? "rgba(255, 50, 50, 0.5)" : "rgba(255,255,255,0.2)"}
                        disabled={watchedLoading}
                        onPress={toggleWatched}
                        p="$0"
                        jc="center"
                        ai="center"
                      >
                        <Text color={watched ? "rgb(255, 80, 80)" : "white"} fos="$5" fow="700">
                          {watched ? "♥" : "♡"}
                        </Text>
                      </Button>
                    )}
                  </XStack>
                </YStack>
              </YStack>
            </YStack>

            {/* TV Tab Switcher */}
            {isTv && (
              <XStack
                mt="$4"
                mx="$4"
                bg="$backgroundElement"
                borderRadius="$5"
                p="$1"
              >
                <Button
                  f={1}
                  size="$3"
                  borderRadius="$4"
                  bg={activeTab === "overview" ? "$background" : "transparent"}
                  color={activeTab === "overview" ? "$color" : "$color10"}
                  onPress={() => setActiveTab("overview")}
                >
                  Overview
                </Button>
                <Button
                  f={1}
                  size="$3"
                  borderRadius="$4"
                  bg={activeTab === "episodes" ? "$background" : "transparent"}
                  color={activeTab === "episodes" ? "$color" : "$color10"}
                  onPress={() => setActiveTab("episodes")}
                >
                  Episodes
                </Button>
              </XStack>
            )}

            {isTv && activeTab === "episodes" ? (
              <YStack px="$4" pt="$5" gap="$4">
                {details.seasons?.map((season) => {
                  const expanded = expandedSeasons.has(season.season_number);
                  const loading = seasonLoading.has(season.season_number);
                  const episodes = seasonEpisodes[season.season_number] ?? [];
                  return (
                    <SeasonCard
                      key={season.id}
                      season={season}
                      showDetails={details}
                      expanded={expanded}
                      loading={loading}
                      episodes={episodes}
                      watchedEpisodes={watchedEpisodes}
                      onToggle={() => toggleSeason(season.season_number)}
                      onToggleEpisode={(episode, list) =>
                        toggleEpisode(episode, list)
                      }
                      onOpenEpisode={openEpisode}
                    />
                  );
                })}
              </YStack>
            ) : (
              <YStack px="$4" pt="$5" gap="$6">
                {/* Tagline */}
                {details.tagline ? (
                  <Text
                    color="$color"
                    opacity={0.55}
                    fos="$4"
                    fow="600"
                    fontStyle="italic"
                  >
                    &ldquo;{details.tagline}&rdquo;
                  </Text>
                ) : null}

                {/* About / Overview */}
                <YStack gap="$2">
                  <Text color="$color" fow="800" fos="$6">
                    About
                  </Text>
                  <Text color="$color" opacity={0.72} fos="$4" lh="$5">
                    {details.overview ||
                      "No overview is available for this title."}
                  </Text>
                </YStack>

                {/* Top Cast */}
                <YStack gap="$3">
                  <Text color="$color" fow="800" fos="$6">
                    Top Cast
                  </Text>
                  {(details.cast ?? []).length === 0 ? (
                    <YStack
                      py="$5"
                      ai="center"
                      bg="$backgroundElement"
                      borderRadius="$4"
                    >
                      <Text color="$color" opacity={0.55}>
                        Cast details are not available.
                      </Text>
                    </YStack>
                  ) : (
                    <ScrollView
                      horizontal
                      showsHorizontalScrollIndicator={false}
                    >
                      <XStack gap="$4">
                        {(details.cast ?? []).map((member) => (
                          <YStack key={member.id} w={92} ai="center" gap="$2">
                            <YStack
                              w={76}
                              h={76}
                              borderRadius={999}
                              overflow="hidden"
                              bg="$backgroundElement"
                              borderWidth={1}
                              borderColor="$borderColor"
                            >
                              {member.profile_path ? (
                                <Image
                                  source={{
                                    uri: imageUrl(
                                      member.profile_path,
                                      PROFILE_IMAGE_BASE_URL,
                                    ),
                                  }}
                                  style={{ width: "100%", height: "100%" }}
                                  contentFit="cover"
                                />
                              ) : (
                                <YStack f={1} ai="center" jc="center">
                                  <Text color="$color" opacity={0.5} fos="$1">
                                    No photo
                                  </Text>
                                </YStack>
                              )}
                            </YStack>
                            <Text
                              color="$color"
                              fow="700"
                              fos="$2"
                              ta="center"
                              numberOfLines={2}
                            >
                              {member.name}
                            </Text>
                          </YStack>
                        ))}
                      </XStack>
                    </ScrollView>
                  )}
                </YStack>
              </YStack>
            )}
          </ScrollView>
        ) : null}
      </SafeAreaView>
    </YStack>
  );
}

const styles = StyleSheet.create({
  gradientOverlay: {
    position: "absolute",
    left: 0,
    right: 0,
    bottom: 0,
    height: "65%",
    // Gradient simulated with a semi-transparent layer darkening at bottom
    backgroundColor: "transparent",
    // React Native doesn't support CSS gradients; use a layered approach
  },
  backButton: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: "rgba(0,0,0,0.5)",
    alignItems: "center",
    justifyContent: "center",
    alignSelf: "flex-start",
  },
  logoImage: {
    width: 220,
    height: 80,
    alignSelf: "center",
  },
  titleText: {
    textShadowColor: "rgba(0,0,0,0.8)",
    textShadowOffset: { width: 0, height: 2 },
    textShadowRadius: 8,
  },
});

function SeasonCard({
  season,
  showDetails,
  expanded,
  loading,
  episodes,
  watchedEpisodes,
  onToggle,
  onToggleEpisode,
  onOpenEpisode,
}: {
  season: Season;
  showDetails: MediaDetails;
  expanded: boolean;
  loading: boolean;
  episodes: Episode[];
  watchedEpisodes: Set<string>;
  onToggle: () => void;
  onToggleEpisode: (episode: Episode, list: Episode[]) => void;
  onOpenEpisode: (episode: Episode) => void;
}) {
  return (
    <YStack
      bg="$backgroundElement"
      borderRadius="$4"
      borderWidth={1}
      borderColor="$borderColor"
      overflow="hidden"
    >
      <XStack
        p="$3"
        ai="center"
        jc="space-between"
        pressStyle={{ opacity: 0.8 }}
        onPress={onToggle}
      >
        <YStack f={1} pr="$2">
          <Text color="$color" fow="800" fos="$4">
            {season.name}
          </Text>
          <Text color="$color" opacity={0.5} fos="$2">
            {season.episode_count} episodes
          </Text>
        </YStack>
        <Text color="$color" opacity={0.7} fos="$4">
          {expanded ? "▲" : "▼"}
        </Text>
      </XStack>

      {expanded && (
        <YStack px="$3" pb="$3" gap="$0">
          {loading ? (
            <YStack py="$4" ai="center">
              <Spinner color="$color" />
            </YStack>
          ) : episodes.length === 0 ? (
            <YStack py="$4" ai="center">
              <Text color="$color" opacity={0.5}>
                No episodes available.
              </Text>
            </YStack>
          ) : (
            episodes.map((episode, i) => {
              const isLast = i === episodes.length - 1;
              return (
                <EpisodeRowListItem
                  key={episode.id}
                  episode={episode}
                  showDetails={showDetails}
                  watched={watchedEpisodes.has(
                    `${episode.season_number}:${episode.episode_number}`,
                  )}
                  isLast={isLast}
                  onPress={() => onOpenEpisode(episode)}
                  onToggle={() => onToggleEpisode(episode, episodes)}
                />
              );
            })
          )}
        </YStack>
      )}
    </YStack>
  );
}

function EpisodeRowListItem({
  episode,
  showDetails,
  watched,
  isLast,
  onPress,
  onToggle,
}: {
  episode: Episode;
  showDetails: MediaDetails;
  watched: boolean;
  isLast: boolean;
  onPress: () => void;
  onToggle: () => void;
}) {
  const formattedDate = useMemo(() => {
    if (!episode.air_date) return "";
    try {
      const parts = episode.air_date.split("-");
      if (parts.length === 3) {
        const year = parts[0];
        const monthNum = parseInt(parts[1], 10);
        const day = parseInt(parts[2], 10);
        const months = [
          "Jan", "Feb", "Mar", "Apr", "May", "Jun",
          "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"
        ];
        const month = months[monthNum - 1] || "";
        return `${month} ${day}, ${year}`;
      }
      return episode.air_date;
    } catch {
      return episode.air_date;
    }
  }, [episode.air_date]);

  const subtitle = useMemo(() => {
    const parts: string[] = [];
    if (formattedDate) parts.push(formattedDate);
    if (episode.runtime) parts.push(`${episode.runtime} min`);
    return parts.join(" · ");
  }, [formattedDate, episode.runtime]);

  const episodeCode = `S${episode.season_number} · E${episode.episode_number}`;

  return (
    <YStack>
      <XStack
        ai="center"
        py="$3"
        gap="$3"
        pressStyle={{ opacity: 0.85 }}
        onPress={onPress}
      >
        {/* Left: Thumbnail Still Image */}
        <YStack w={120} h={68} borderRadius={8} overflow="hidden" bg="$backgroundElement">
          {episode.still_path ? (
            <Image
              source={{
                uri: imageUrl(episode.still_path, BACKDROP_IMAGE_BASE_URL),
              }}
              style={{ width: "100%", height: "100%" }}
              contentFit="cover"
            />
          ) : showDetails.backdrop_path ? (
            <Image
              source={{
                uri: imageUrl(showDetails.backdrop_path, BACKDROP_IMAGE_BASE_URL),
              }}
              style={{ width: "100%", height: "100%" }}
              contentFit="cover"
            />
          ) : showDetails.poster_path ? (
            <Image
              source={{
                uri: imageUrl(showDetails.poster_path, IMAGE_BASE_URL),
              }}
              style={{ width: "100%", height: "100%" }}
              contentFit="cover"
            />
          ) : (
            <YStack f={1} ai="center" jc="center">
              <Text color="$color" opacity={0.4} fos="$1">No image</Text>
            </YStack>
          )}
        </YStack>

        {/* Middle: Content Stack */}
        <YStack f={1} gap="$1">
          <Text color="$color" opacity={0.5} fos="$2" fow="600" letterSpacing={0.5}>
            {episodeCode}
          </Text>
          <Text color="$color" fow="700" fos="$4" numberOfLines={1}>
            {episode.name}
          </Text>
          {subtitle ? (
            <Text color="$color" opacity={0.5} fos="$2">
              {subtitle}
            </Text>
          ) : null}
        </YStack>

        {/* Right: Circle Watch Toggle */}
        <TouchableOpacity
          onPress={(e) => {
            e.stopPropagation();
            onToggle();
          }}
          activeOpacity={0.7}
          style={{ padding: 8 }}
        >
          <YStack
            w={24}
            h={24}
            borderRadius={12}
            borderWidth={2}
            borderColor={watched ? "#2ecc71" : "$borderColor"}
            bg="transparent"
            ai="center"
            jc="center"
          />
        </TouchableOpacity>
      </XStack>

      {!isLast && (
        <YStack height={1} bg="$borderColor" opacity={0.2} />
      )}
    </YStack>
  );
}
