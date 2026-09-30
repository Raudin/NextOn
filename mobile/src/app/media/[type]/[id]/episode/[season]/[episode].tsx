import { Image } from "expo-image";
import { useLocalSearchParams, useRouter } from "expo-router";
import { Check, Lock } from "lucide-react-native";
import { useEffect, useState, useMemo } from "react";
import { Platform } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import {
  Button,
  ScrollView,
  Spinner,
  Text,
  useTheme,
  XStack,
  YStack,
} from "tamagui";
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

/**
 * Episode stills are 16:9 on TMDB, so the hero is sized by that ratio rather
 * than a fixed height. A fixed height has to be tall enough for a portrait phone
 * with copy overlaid on it, and `cover` then crops most of the frame away to
 * fill it; letting the width drive the height keeps the whole still visible and
 * adapts to tablets and landscape on its own.
 */
const STILL_ASPECT_RATIO = 16 / 9;

export default function EpisodeDetailScreen() {
  const { back, push } = useRouter();
  const { token } = useAuth();
  const insets = useSafeAreaInsets();
  /**
   * Android ignores `contentInsetAdjustmentBehavior` (the prop is iOS-only), so
   * the status-bar inset is applied as padding there. On iOS the scroll view
   * handles it and this stays 0, so the still can scroll under the status bar
   * rather than being clipped below it. Same pattern as `(tabs)/profile.tsx`.
   */
  const topInset = Platform.OS === "android" ? insets.top : 0;
  /**
   * Lucide icons take a resolved colour rather than a theme token, so the two
   * states of the watched button's check read the active theme here — the same
   * way `useProgressTheme` resolves its tier colours.
   */
  const theme = useTheme();
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
      push("/auth");
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

  /**
   * Artwork for the hero, in preference order: the episode's own still, the
   * show's backdrop, then its poster.
   *
   * The role follows the rendered size rather than the data type — a still drawn
   * full-bleed needs the same bucket as a backdrop, and a poster stretched over a
   * 16:9 frame is still a card-sized image. Collapsing the three call sites into
   * one also means the cache policy and transition stay in step with the role.
   *
   * The dependency list holds the whole objects rather than the three paths: the
   * React Compiler lint rule rejects a manual list narrower than its inferred
   * one.
   */
  const heroImage = useMemo(() => {
    if (episode?.still_path) {
      return { path: episode.still_path, role: "backdrop" as const };
    }
    if (showDetails?.backdrop_path) {
      return { path: showDetails.backdrop_path, role: "backdrop" as const };
    }
    if (showDetails?.poster_path) {
      return { path: showDetails.poster_path, role: "posterCard" as const };
    }
    return null;
  }, [episode, showDetails]);

  return (
    <YStack f={1} bg="$background">
      <YStack f={1} pt={topInset}>
        {showLoadingUI ? (
          <LoadingOrb label="Loading episode..." />
        ) : error ? (
          <YStack f={1} ai="center" jc="center" gap="$4" px="$4">
            <Text color="$red10" fow="700" ta="center">
              {error}
            </Text>
            <Button onPress={() => back()}>Back</Button>
          </YStack>
        ) : episode ? (
          <ScrollView
            showsVerticalScrollIndicator={false}
            // Replaces the SafeAreaView wrapper; see `(tabs)/profile.tsx`.
            contentInsetAdjustmentBehavior="automatic"
            contentContainerStyle={{ paddingBottom: 120 }}
          >
            {/*
              Hero: the episode still.

              Only the back affordance sits on the artwork now, which is why
              there is no scrim: everything that used to be layered on top of the
              image moved below it.
            */}
            <YStack aspectRatio={STILL_ASPECT_RATIO} bg="#151515">
              {heroImage ? (
                <Image
                  source={{ uri: imageUrl(heroImage.path, heroImage.role) }}
                  style={{ width: "100%", height: "100%" }}
                  contentFit="cover"
                  cachePolicy={imageCachePolicy(heroImage.role)}
                  transition={imageTransitionMs(heroImage.role)}
                  recyclingKey={heroImage.path}
                />
              ) : (
                <YStack f={1} ai="center" jc="center">
                  <Text color="$color" opacity={0.5}>
                    No image available
                  </Text>
                </YStack>
              )}

              <YStack pos="absolute" t={0} l={0} r={0} p="$4">
                <BackButton onPress={() => back()} />
              </YStack>
            </YStack>

            {/*
              Title, metadata and the watched action, on the page background
              rather than over the artwork: a 16:9 still is too short to carry a
              three-line title, a metadata row and a 46pt button, and white copy
              over an unscrimmed frame is legible only on the dark ones.
            */}
            <YStack px="$4" pt="$5" gap="$4">
              <YStack gap="$2">
                <Text color="$color" fow="900" fos="$9" numberOfLines={3}>
                  {episode.name}
                </Text>

                {/* Metadata row: dot separated like the media-detail screen's
                    genre line, in theme colour because it sits on the page. */}
                <XStack ai="center" gap="$2" flexWrap="wrap" w="100%">
                  <Text color="$color" opacity={0.75} fow="500" fos="$3">
                    {formattedSeasonEpisode}
                  </Text>
                  {episode.runtime ? (
                    <XStack ai="center" gap="$2">
                      <YStack
                        w={3}
                        h={3}
                        borderRadius={999}
                        bg="$color"
                        opacity={0.35}
                      />
                      <Text color="$color" opacity={0.75} fow="500" fos="$3">
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
                        bg="$color"
                        opacity={0.35}
                      />
                      <Text color="$color" opacity={0.75} fow="500" fos="$3">
                        {episode.air_date}
                      </Text>
                    </XStack>
                  ) : null}
                </XStack>
              </YStack>

              {/*
                Mark as Watched, off the artwork. The theme surface and hairline
                border replace the translucent artwork pill it used to be: the
                white label and washed-out green it used for the watched state
                were only legible against a dark frame.
              */}
              <Button
                size="$4"
                borderRadius="$10"
                bg={watched ? "$green10" : "$backgroundElement"}
                color={watched ? "white" : "$color"}
                borderWidth={1}
                borderColor={watched ? "$green10" : "$borderColor"}
                disabled={toggling || isEpisodeUnreleased}
                onPress={toggleWatched}
                icon={
                  toggling ? (
                    <Spinner size="small" color={watched ? "white" : "$color"} />
                  ) : isEpisodeUnreleased ? (
                    <Lock
                      size={16}
                      color={theme.color10?.val ?? "#9BA1A6"}
                      strokeWidth={2.4}
                    />
                  ) : (
                    <Check
                      size={17}
                      color={watched ? "#FFFFFF" : (theme.color?.val ?? "#000000")}
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
      </YStack>
    </YStack>
  );
}
