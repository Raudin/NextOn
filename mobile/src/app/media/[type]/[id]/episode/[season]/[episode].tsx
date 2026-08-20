import { Image } from "expo-image";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useEffect, useState, useMemo } from "react";
import { StyleSheet, TouchableOpacity } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Button, ScrollView, Spinner, Text, XStack, YStack } from "tamagui";
import { useAuth } from "@/context/AuthContext";
import { cache } from "@/lib/cache";

import {
  BACKDROP_IMAGE_BASE_URL,
  IMAGE_BASE_URL,
  fetchEpisodeDetails,
  fetchMediaDetails,
  fetchWatchedStatus,
  imageUrl,
  markWatched,
  unmarkWatched,
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
    ]);
  } catch (err) {
    console.warn("Failed to invalidate media caches:", err);
  }
};

export default function EpisodeDetailScreen() {
  const router = useRouter();
  const { token } = useAuth();
  const params = useLocalSearchParams<{
    type: string;
    id: string;
    season: string;
    episode: string;
  }>();
  const [episode, setEpisode] = useState<Episode | null>(null);
  const [showDetails, setShowDetails] = useState<MediaDetails | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [watched, setWatched] = useState(false);
  const [toggling, setToggling] = useState(false);

  const isEpisodeUnreleased = useMemo(() => {
    if (!episode?.air_date) return false;
    const parts = episode.air_date.split("-");
    if (parts.length !== 3) return false;
    const airDate = new Date(Number(parts[0]), Number(parts[1]) - 1, Number(parts[2]));
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    return airDate > today;
  }, [episode]);

  useEffect(() => {
    let mounted = true;
    const load = async () => {
      if (!params.id || !params.season || !params.episode) {
        return;
      }
      setLoading(true);
      setError(null);
      try {
        const fetchShowDetailsPromise = fetchMediaDetails("tv", params.id);
        const fetchEpisodeDetailsPromise = fetchEpisodeDetails(
          params.id,
          Number(params.season),
          Number(params.episode),
        );

        if (token) {
          const [episodeData, showData, status] = await Promise.all([
            fetchEpisodeDetailsPromise,
            fetchShowDetailsPromise,
            fetchWatchedStatus(params.id, "tv"),
          ]);
          if (mounted) {
            setEpisode(episodeData);
            setShowDetails(showData);
            const key = `${params.season}:${params.episode}`;
            setWatched(
              status.episodes?.some(
                (ep) => `${ep.season}:${ep.episode}` === key,
              ) ?? false,
            );
          }
        } else {
          const [episodeData, showData] = await Promise.all([
            fetchEpisodeDetailsPromise,
            fetchShowDetailsPromise,
          ]);
          if (mounted) {
            setEpisode(episodeData);
            setShowDetails(showData);
            setWatched(false);
          }
        }
      } catch (err: any) {
        if (mounted) {
          setError(err.message || String(err));
        }
      } finally {
        if (mounted) {
          setLoading(false);
        }
      }
    };
    load();
    return () => {
      mounted = false;
    };
  }, [params.id, params.season, params.episode, token]);

  const toggleWatched = async () => {
    if (!token) {
      router.push("/auth");
      return;
    }
    if (!episode || toggling) {
      return;
    }
    const next = !watched;
    const payload = {
      media_id: Number(params.id),
      media_type: "tv" as const,
      season_number: Number(params.season),
      episode_number: Number(params.episode),
    };
    setWatched(next);
    setToggling(true);
    try {
      if (next) {
        await markWatched(payload);
      } else {
        await unmarkWatched(payload);
      }
      await invalidateMediaCaches();
    } catch (err: any) {
      setWatched(!next);
      setError(err.message || String(err));
    } finally {
      setToggling(false);
    }
  };

  const formattedSeasonEpisode = useMemo(() => {
    if (!episode) return "";
    const s = String(episode.season_number).padStart(2, "0");
    const e = String(episode.episode_number).padStart(2, "0");
    return `S${s}E${e}`;
  }, [episode]);

  return (
    <YStack f={1} bg="$background">
      <SafeAreaView style={{ flex: 1 }} edges={["top"]}>
        {loading ? (
          <YStack f={1} ai="center" jc="center" gap="$3">
            <Spinner size="large" color="$color" />
            <Text color="$color" opacity={0.55}>
              Loading episode...
            </Text>
          </YStack>
        ) : error ? (
          <YStack f={1} ai="center" jc="center" gap="$4" px="$4">
            <Text color="$red10" fow="700" ta="center">
              {error}
            </Text>
            <Button onPress={() => router.back()}>Back</Button>
          </YStack>
        ) : episode ? (
          <ScrollView
            showsVerticalScrollIndicator={false}
            contentContainerStyle={{ paddingBottom: 120 }}
          >
            {/* Hero Backdrop - 420px height like [id].tsx */}
            <YStack h={420} bg="#151515">
              {episode.still_path ? (
                <Image
                  source={{
                    uri: imageUrl(episode.still_path, BACKDROP_IMAGE_BASE_URL),
                  }}
                  style={{ width: "100%", height: "100%" }}
                  contentFit="cover"
                />
              ) : showDetails?.backdrop_path ? (
                <Image
                  source={{
                    uri: imageUrl(showDetails.backdrop_path, BACKDROP_IMAGE_BASE_URL),
                  }}
                  style={{ width: "100%", height: "100%" }}
                  contentFit="cover"
                />
              ) : showDetails?.poster_path ? (
                <Image
                  source={{
                    uri: imageUrl(showDetails.poster_path, IMAGE_BASE_URL),
                  }}
                  style={{ width: "100%", height: "100%" }}
                  contentFit="cover"
                />
              ) : (
                <YStack f={1} ai="center" jc="center">
                  <Text color="$color" opacity={0.5}>
                    No image available
                  </Text>
                </YStack>
              )}

              {/* Gradient Overlay */}
              <YStack style={styles.gradientOverlay} />

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

                {/* Bottom of hero: Title & Metadata & Action Button */}
                <YStack gap="$3" ai="center" w="100%">
                  {/* Episode Title */}
                  <Text
                    color="white"
                    fow="900"
                    fos="$9"
                    numberOfLines={3}
                    ta="center"
                    style={styles.titleText}
                  >
                    {episode.name}
                  </Text>

                  {/* Metadata subtitle */}
                  <XStack ai="center" jc="center" gap="$2" flexWrap="wrap" w="100%">
                    <Text color="white" opacity={0.85} fow="500" fos="$3">
                      {formattedSeasonEpisode}
                    </Text>
                    {episode.runtime ? (
                      <XStack ai="center" gap="$2">
                        <YStack
                          w={3}
                          h={3}
                          borderRadius={999}
                          bg="rgba(255,255,255,0.5)"
                        />
                        <Text color="white" opacity={0.7} fow="500" fos="$3">
                          {episode.runtime} min
                        </Text>
                      </XStack>
                    ) : null}
                    {episode.air_date ? (
                      <XStack ai="center" gap="$2">
                        <YStack
                          w={3}
                          h={3}
                          borderRadius={999}
                          bg="rgba(255,255,255,0.5)"
                        />
                        <Text color="white" opacity={0.7} fow="500" fos="$3">
                          {episode.air_date}
                        </Text>
                      </XStack>
                    ) : null}
                  </XStack>

                  {/* Mark as Watched action button styled exactly like Watchlist button on show details page */}
                  <XStack gap="$3" ai="center" jc="center" mt="$2" w="100%">
                    <Button
                      f={1}
                      size="$4"
                      borderRadius="$10"
                      bg={watched ? "rgba(255,255,255,0.15)" : "transparent"}
                      color="white"
                      borderWidth={1}
                      borderColor={watched ? "rgba(255,255,255,0.2)" : "rgba(255,255,255,0.4)"}
                      disabled={toggling || isEpisodeUnreleased}
                      onPress={toggleWatched}
                      iconAfter={toggling ? <Spinner size="small" color="white" /> : undefined}
                      h={44}
                    >
                      {isEpisodeUnreleased ? "Unreleased" : watched ? "✓ Watched" : "+ Mark as Watched"}
                    </Button>
                  </XStack>
                </YStack>
              </YStack>
            </YStack>

            {/* Episode Content: Just the Overview section directly below the hero banner */}
            <YStack px="$4" pt="$5" gap="$6">
              <YStack gap="$2">
                <Text color="$color" fow="800" fos="$6">
                  Overview
                </Text>
                <Text color="$color" opacity={0.72} fos="$4" lh="$5">
                  {episode.overview || "No overview available."}
                </Text>
              </YStack>
            </YStack>
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
    backgroundColor: "transparent",
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
  titleText: {
    textShadowColor: "rgba(0,0,0,0.8)",
    textShadowOffset: { width: 0, height: 2 },
    textShadowRadius: 8,
  },
});
