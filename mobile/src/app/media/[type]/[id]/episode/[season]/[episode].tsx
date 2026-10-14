import { Image } from "expo-image";
import { useLocalSearchParams, useRouter } from "expo-router";
// Per-icon entry points (`./icons/*` in the package's exports map): the root
// barrel re-exports every icon and Metro does not tree-shake.
import Check from "lucide-react-native/icons/check";
import Lock from "lucide-react-native/icons/lock";
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
  fetchWatchedStatus,
  markWatched,
  unmarkWatched,
  type Episode,
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
   * How far the back button has to stay clear of the status bar, with a floor on
   * Android where an edge-to-edge window can report no inset at all.
   *
   * The still above it is full-bleed: the scroll view no longer insets its
   * content (`contentInsetAdjustmentBehavior="never"` below), so the artwork
   * starts at y=0 with the camera cutout over it, and this value is the *only*
   * thing keeping the button out from under the status bar. Same pattern as
   * `(tabs)/profile.tsx` and the media-detail screen.
   */
  const topInset = Math.max(insets.top, Platform.OS === "android" ? 16 : 0);
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
    /**
     * The show's artwork, carried in as route params by whoever pushed this
     * route.
     *
     * This screen used to fetch the entire show record just to reach two
     * paths on it, which meant every episode opened paid for a details
     * request whose other ~20 fields were thrown away. Every call site already
     * holds the `TMDBMedia` it navigated from, so the two paths travel with
     * the navigation instead. Both are optional: a deep link arrives without
     * them, and the hero then falls back to the episode's own still.
     */
    showBackdropPath?: string;
    showPosterPath?: string;
  }>();
  const { showBackdropPath, showPosterPath } = params;
  const [episode, setEpisode] = useState<Episode | null>(null);
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
        const fetchEpisodeDetailsPromise = fetchEpisodeDetails(
          params.id,
          Number(params.season),
          Number(params.episode),
        );

        if (token) {
          const [episodeData, status] = await Promise.all([
            fetchEpisodeDetailsPromise,
            fetchWatchedStatus(params.id, "tv"),
          ]);
          if (mounted) {
            setEpisode(episodeData);
            const key = `${params.season}:${params.episode}`;
            setWatched(
              status.episodes?.some(
                (ep) => `${ep.season}:${ep.episode}` === key,
              ) ?? false,
            );
          }
        } else {
          const episodeData = await fetchEpisodeDetailsPromise;
          if (mounted) {
            setEpisode(episodeData);
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
   * The show's two paths arrive as route params; see the note on `params` above.
   */
  const heroImage = useMemo(() => {
    if (episode?.still_path) {
      return { path: episode.still_path, role: "backdrop" as const };
    }
    if (showBackdropPath) {
      return { path: showBackdropPath, role: "backdrop" as const };
    }
    if (showPosterPath) {
      return { path: showPosterPath, role: "posterCard" as const };
    }
    return null;
  }, [episode, showBackdropPath, showPosterPath]);

  return (
    <YStack f={1} bg="$background">
      <YStack f={1}>
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
            // `never`, not `automatic`: the still has to start at the very top of
            // the screen so the camera cutout sits over it. iOS would otherwise
            // inset the scroll content around the status bar, which is what used
            // to push the artwork down; the back button carries that inset
            // instead — see `topInset`.
            contentInsetAdjustmentBehavior="never"
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

              {/*
                The still is drawn from y=0, so the button takes the inset the
                screen-wide padding used to apply for it; `p="$4"` still supplies
                its usual gap below it.
              */}
              <YStack pos="absolute" t={topInset} l={0} r={0} p="$4">
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
