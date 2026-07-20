import { Image } from "expo-image";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useCallback, useEffect, useMemo, useState } from "react";
import { Alert } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Button, ScrollView, Spinner, Text, XStack, YStack } from "tamagui";
import { useAuth } from "@/context/AuthContext";

import {
  BACKDROP_IMAGE_BASE_URL,
  PROFILE_IMAGE_BASE_URL,
  addToWatchlist,
  fetchMediaDetails,
  fetchSeasonEpisodes,
  fetchWatchedStatus,
  fetchWatchlist,
  imageUrl,
  markWatched,
  markWatchedBulk,
  mediaDate,
  mediaTitle,
  removeFromWatchlist,
  unmarkWatched,
  type Episode,
  type MediaDetails,
  type Season,
} from "@/lib/media-api";

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
    loadAll();
  }, [loadAll, token]);

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
    } catch (err: any) {
      setWatched(!next);
      setError(err.message || String(err));
    } finally {
      setWatchedLoading(false);
    }
  };

  const toggleSeason = async (season: Season) => {
    const seasonNumber = season.season_number;
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
            <YStack h={360} bg="$backgroundElement">
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

              <YStack
                pos="absolute"
                t={0}
                l={0}
                r={0}
                b={0}
                jc="space-between"
                p="$4"
                bg="rgba(0,0,0,0.24)"
              >
                <Button
                  size="$3"
                  circular
                  alignSelf="flex-start"
                  bg="rgba(0,0,0,0.55)"
                  color="white"
                  onPress={() => router.back()}
                >
                  Back
                </Button>

                <YStack gap="$3">
                  <YStack gap="$1">
                    <Text color="white" fow="900" fos="$9" numberOfLines={3}>
                      {mediaTitle(details)}
                    </Text>
                    <Text color="white" opacity={0.82} fow="700">
                      {[mediaDate(details), runtime].filter(Boolean).join("  ")}
                    </Text>
                  </YStack>

                  <XStack gap="$2" flexWrap="wrap">
                    {(details.genres ?? []).map((genre) => (
                      <XStack
                        key={genre.id}
                        px="$2.5"
                        py="$1"
                        borderRadius="$5"
                        bg="rgba(255,255,255,0.2)"
                        borderWidth={1}
                        borderColor="rgba(255,255,255,0.24)"
                      >
                        <Text color="white" fow="700" fos="$1">
                          {genre.name}
                        </Text>
                      </XStack>
                    ))}
                  </XStack>
                </YStack>
              </YStack>
            </YStack>

            <XStack mt="$4" px="$4" gap="$3">
              <Button
                f={1}
                size="$4"
                borderRadius="$4"
                bg={inWatchlist ? "$purple9" : "transparent"}
                color={inWatchlist ? "white" : "$purple9"}
                borderWidth={1}
                borderColor="$purple9"
                disabled={watchlistLoading}
                onPress={toggleWatchlist}
              >
                {inWatchlist ? "In Watchlist" : "Watchlist"}
              </Button>
              {isMovie && (
                <Button
                  f={1}
                  size="$4"
                  borderRadius="$4"
                  bg={watched ? "$green9" : "transparent"}
                  color={watched ? "white" : "$green9"}
                  borderWidth={1}
                  borderColor="$green9"
                  disabled={watchedLoading}
                  onPress={toggleWatched}
                >
                  {watched ? "Watched" : "Mark Watched"}
                </Button>
              )}
            </XStack>

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
                {details.seasons?.map((season) => (
                  <SeasonCard
                    key={season.id}
                    season={season}
                    expanded={expandedSeasons.has(season.season_number)}
                    loading={seasonLoading.has(season.season_number)}
                    episodes={seasonEpisodes[season.season_number] ?? []}
                    watchedEpisodes={watchedEpisodes}
                    onToggle={() => toggleSeason(season)}
                    onToggleEpisode={(episode, list) =>
                      toggleEpisode(episode, list)
                    }
                    onOpenEpisode={openEpisode}
                  />
                ))}
              </YStack>
            ) : (
              <YStack px="$4" pt="$5" gap="$6">
                <YStack gap="$2">
                  <Text color="$color" fow="800" fos="$6">
                    Overview
                  </Text>
                  <Text color="$color" opacity={0.72} fos="$4" lh="$5">
                    {details.overview ||
                      "No overview is available for this title."}
                  </Text>
                </YStack>

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

function SeasonCard({
  season,
  expanded,
  loading,
  episodes,
  watchedEpisodes,
  onToggle,
  onToggleEpisode,
  onOpenEpisode,
}: {
  season: Season;
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
        <YStack px="$3" pb="$3" gap="$2">
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
            episodes.map((episode) => (
              <EpisodeRow
                key={episode.id}
                episode={episode}
                watched={watchedEpisodes.has(
                  `${episode.season_number}:${episode.episode_number}`,
                )}
                onPress={() => onOpenEpisode(episode)}
                onToggle={() => onToggleEpisode(episode, episodes)}
              />
            ))
          )}
        </YStack>
      )}
    </YStack>
  );
}

function EpisodeRow({
  episode,
  watched,
  onPress,
  onToggle,
}: {
  episode: Episode;
  watched: boolean;
  onPress: () => void;
  onToggle: () => void;
}) {
  return (
    <XStack
      ai="center"
      jc="space-between"
      p="$2"
      borderRadius="$3"
      bg="$background"
      pressStyle={{ opacity: 0.8 }}
      onPress={onPress}
    >
      <YStack f={1} pr="$2">
        <Text color="$color" fow="700" fos="$3" numberOfLines={1}>
          Episode {episode.episode_number} - {episode.name}
        </Text>
        {episode.air_date && (
          <Text color="$color" opacity={0.5} fos="$1">
            {episode.air_date}
          </Text>
        )}
      </YStack>
      <Button
        size="$2.5"
        circular
        bg={watched ? "$purple9" : "rgba(0,0,0,0.5)"}
        color="white"
        onPress={(event: any) => {
          event?.stopPropagation?.();
          onToggle();
        }}
      >
        {watched ? "✓" : "+"}
      </Button>
    </XStack>
  );
}
