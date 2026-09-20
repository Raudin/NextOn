import { Image } from "expo-image";
import { useLocalSearchParams, useRouter } from "expo-router";
import { Check, Lock } from "lucide-react-native";
import { useEffect, useState, useMemo } from "react";
import { StyleSheet } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Button, ScrollView, Spinner, Text, XStack, YStack } from "tamagui";
import BackButton from "@/components/BackButton";
import LoadingOrb from "@/components/LoadingOrb";
import { useAuth } from "@/context/AuthContext";
import { useDeferredLoading } from "@/hooks/use-deferred-loading";
import { invalidateMediaCaches } from "@/lib/cache";
import { imageCachePolicy, imageTransitionMs, imageUrl } from "@/lib/images";
import { setTelemetryScreen } from "@/lib/telemetry";

import {
  fetchEpisodeDetails,
  fetchMediaDetails,
  fetchWatchedStatus,
  markWatched,
  unmarkWatched,
  type Episode,
  type MediaDetails,
} from "@/lib/media-api";

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

  // What the screen should render, rather than raw `loading`: the orb is held
  // back for 150ms so a cached payload never flashes it for two frames, and
  // held for at least 500ms once shown so it cannot blink.
  const showLoadingUI = useDeferredLoading(loading);

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
    setTelemetryScreen("episode");
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
        {showLoadingUI ? (
          <LoadingOrb label="Loading episode..." />
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
            {/* Hero Backdrop */}
            <YStack h={520} bg="#151515">
              {episode.still_path ? (
                <Image
                  source={{ uri: imageUrl(episode.still_path, "backdrop") }}
                  style={{ width: "100%", height: "100%" }}
                  contentFit="cover"
                  cachePolicy={imageCachePolicy("backdrop")}
                  transition={imageTransitionMs("backdrop")}
                  recyclingKey={episode.still_path}
                />
              ) : showDetails?.backdrop_path ? (
                <Image
                  source={{ uri: imageUrl(showDetails.backdrop_path, "backdrop") }}
                  style={{ width: "100%", height: "100%" }}
                  contentFit="cover"
                  cachePolicy={imageCachePolicy("backdrop")}
                  transition={imageTransitionMs("backdrop")}
                  recyclingKey={showDetails.backdrop_path}
                />
              ) : showDetails?.poster_path ? (
                <Image
                  source={{ uri: imageUrl(showDetails.poster_path, "posterCard") }}
                  style={{ width: "100%", height: "100%" }}
                  contentFit="cover"
                  cachePolicy={imageCachePolicy("posterCard")}
                  transition={imageTransitionMs("posterCard")}
                  recyclingKey={showDetails.poster_path}
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
                <BackButton onPress={() => router.back()} />

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
                      bg={
                        watched
                          ? "rgba(34, 165, 89, 0.42)"
                          : "rgba(20,20,24,0.55)"
                      }
                      color="white"
                      borderWidth={1}
                      borderColor={
                        watched
                          ? "rgba(120, 235, 165, 0.65)"
                          : "rgba(255,255,255,0.28)"
                      }
                      style={styles.actionButtonShadow}
                      disabled={toggling || isEpisodeUnreleased}
                      onPress={toggleWatched}
                      icon={
                        toggling ? (
                          <Spinner size="small" color="white" />
                        ) : isEpisodeUnreleased ? (
                          <Lock
                            size={16}
                            color="rgba(255,255,255,0.7)"
                            strokeWidth={2.4}
                          />
                        ) : (
                          <Check
                            size={17}
                            color="#FFFFFF"
                            strokeWidth={3}
                          />
                        )
                      }
                      h={46}
                      px="$3"
                    >
                      {isEpisodeUnreleased
                        ? "Unreleased"
                        : watched
                          ? "Watched"
                          : "Mark as Watched"}
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
  // Translucent, always-legible action button that sits on top of the backdrop.
  actionButtonShadow: {
    shadowColor: "#000000",
    shadowOffset: { width: 0, height: 3 },
    shadowOpacity: 0.45,
    shadowRadius: 8,
    elevation: 6,
  },
  titleText: {
    textShadowColor: "rgba(0,0,0,0.8)",
    textShadowOffset: { width: 0, height: 2 },
    textShadowRadius: 8,
  },
});
