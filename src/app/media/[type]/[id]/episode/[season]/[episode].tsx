import { Image } from "expo-image";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useEffect, useState } from "react";
import { SafeAreaView } from "react-native-safe-area-context";
import { Button, ScrollView, Spinner, Text, YStack } from "tamagui";
import { useAuth } from "@/context/AuthContext";
import { cache } from "@/lib/cache";

import {
  BACKDROP_IMAGE_BASE_URL,
  fetchEpisodeDetails,
  fetchWatchedStatus,
  imageUrl,
  markWatched,
  unmarkWatched,
  type Episode,
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
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [watched, setWatched] = useState(false);
  const [toggling, setToggling] = useState(false);

  useEffect(() => {
    let mounted = true;
    const load = async () => {
      if (!params.id || !params.season || !params.episode) {
        return;
      }
      setLoading(true);
      setError(null);
      try {
        if (token) {
          const [data, status] = await Promise.all([
            fetchEpisodeDetails(
              params.id,
              Number(params.season),
              Number(params.episode),
            ),
            fetchWatchedStatus(params.id, "tv"),
          ]);
          if (mounted) {
            setEpisode(data);
            const key = `${params.season}:${params.episode}`;
            setWatched(
              status.episodes?.some(
                (ep) => `${ep.season}:${ep.episode}` === key,
              ) ?? false,
            );
          }
        } else {
          const data = await fetchEpisodeDetails(
            params.id,
            Number(params.season),
            Number(params.episode),
          );
          if (mounted) {
            setEpisode(data);
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
            <YStack h={300} bg="$backgroundElement">
              {episode.still_path ? (
                <Image
                  source={{
                    uri: imageUrl(episode.still_path, BACKDROP_IMAGE_BASE_URL),
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

              <YStack pos="absolute" t={0} l={0} r={0} p="$4">
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
              </YStack>
            </YStack>

            <YStack px="$4" pt="$5" gap="$6">
              <YStack gap="$2">
                <Text color="$color" fow="900" fos="$8">
                  {episode.name}
                </Text>
                <Text color="$color" opacity={0.6} fos="$3">
                  Season {episode.season_number}, Episode{" "}
                  {episode.episode_number}
                  {episode.air_date ? ` • ${episode.air_date}` : ""}
                  {episode.runtime ? ` • ${episode.runtime}m` : ""}
                </Text>
              </YStack>

              <Button
                size="$5"
                borderRadius="$4"
                bg={watched ? "$purple9" : "$backgroundElement"}
                color={watched ? "white" : "$color"}
                borderWidth={1}
                borderColor={watched ? "$purple7" : "$borderColor"}
                onPress={toggleWatched}
                disabled={toggling}
              >
                {watched ? "✓ Watched" : "+ Mark as Watched"}
              </Button>

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
