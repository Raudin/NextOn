import { useAuth } from "@/context/AuthContext";
import { useDeferredLoading } from "@/hooks/use-deferred-loading";
import { invalidateMediaCaches } from "@/lib/cache";
import { imageCachePolicy, imageTransitionMs, imageUrl } from "@/lib/images";
import { getNextAirLabel } from "@/lib/schedule";
import { setTelemetryScreen } from "@/lib/telemetry";
import { Image } from "expo-image";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Calendar,
  Check,
  ChevronDown,
  ChevronUp,
  Clapperboard,
  Heart,
  Lock,
  Plus,
} from "lucide-react-native";
import {
  Linking,
  Platform,
  Pressable,
  StyleSheet,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Button, ScrollView, Spinner, Text, useTheme, XStack, YStack } from "tamagui";

import MediaCarousel from "@/components/Discover/MediaCarousel";
import ConfirmDialog from "@/components/ui/ConfirmDialog";
import { useConfirmDialog } from "@/components/ui/use-confirm-dialog";

import {
  addToFavorites,
  addToWatchlist,
  fetchCollection,
  fetchFavoriteStatus,
  fetchMediaDetails,
  fetchSeasonEpisodes,
  fetchWatchedStatus,
  fetchWatchlist,
  markWatched,
  markWatchedBulk,
  mediaTitle,
  removeFromFavorites,
  removeFromWatchlist,
  unmarkWatched,
  unmarkWatchedBulk,
  type CollectionDetails,
  type Episode,
  type MediaDetails,
  type Season,
  type TMDBMedia,
  type TvProgress,
} from "@/lib/media-api";
import BackButton from "@/components/BackButton";
import HeroIconButton from "@/components/HeroIconButton";
import LoadingOrb from "@/components/LoadingOrb";
import MediaToggleBadge from "@/components/MediaToggleBadge";
import WatchProgressBar from "@/components/Watchlist/WatchProgressBar";

export default function MediaDetailScreen() {
  const { back, push } = useRouter();
  const insets = useSafeAreaInsets();
  /**
   * Android ignores `contentInsetAdjustmentBehavior` (the prop is iOS-only), so
   * the status-bar inset is applied as padding there. On iOS the scroll view
   * handles it and this stays 0, which is what lets the hero scroll under the
   * status bar rather than being clipped below it. Same pattern as
   * `(tabs)/profile.tsx`.
   */
  const topInset = Platform.OS === "android" ? insets.top : 0;
  const { token } = useAuth();
  const params = useLocalSearchParams<{ type: string; id: string }>();
  const [details, setDetails] = useState<MediaDetails | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [inWatchlist, setInWatchlist] = useState(false);
  const [watchlistLoading, setWatchlistLoading] = useState(false);
  const [watched, setWatched] = useState(false);
  const [watchedLoading, setWatchedLoading] = useState(false);
  const [favorited, setFavorited] = useState(false);
  const [favoriteLoading, setFavoriteLoading] = useState(false);
  /**
   * Watchlist membership as a set of ids, rather than the single boolean the
   * hero needs: the related and collection rows render list cards whose
   * bookmark buttons each need their own state. Filled from the same
   * `fetchWatchlist` call the hero already makes, so the rows cost no extra
   * request.
   */
  const [watchlistIds, setWatchlistIds] = useState<Set<number>>(new Set());
  /**
   * The franchise's films, for the collection row. Only ever fetched when the
   * details report a `collection`, and kept with the id it was loaded for so a
   * response for a previously-opened title cannot render under the current one.
   */
  const [collection, setCollection] = useState<CollectionDetails | null>(null);
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
  /**
   * Whole-show progress for the hero, straight from the server so the bar and
   * the Watchlist screen cannot disagree. Null for movies, logged-out viewers,
   * and titles whose season lookup failed.
   */
  const [tvProgress, setTvProgress] = useState<TvProgress | null>(null);

  /**
   * The one confirmation dialog this screen shows: marking every earlier
   * episode watched. Declarative because Android renders it with Jetpack
   * Compose, which needs the dialog mounted inside a `Host`.
   */
  const { confirm, dialogProps } = useConfirmDialog();

  const isMovie = params.type === "movie";
  const isTv = params.type === "tv";

  // What the screen should render, rather than raw `loading`: the orb is held
  // back for 150ms so a cached payload does not flash it for two frames, and
  // once shown it stays for at least 500ms so it never blinks. A re-load while
  // details are already on screen therefore keeps the content up instead of
  // swapping in the orb.
  const showLoadingUI = useDeferredLoading(loading);

  const isUnreleased = useMemo(() => {
    if (!details) return false;
    const dateStr = details.release_date || details.first_air_date;
    if (!dateStr) return false;
    const parts = dateStr.split("-");
    if (parts.length !== 3) return false;
    const releaseDate = new Date(
      Number(parts[0]),
      Number(parts[1]) - 1,
      Number(parts[2]),
    );
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    return releaseDate > today;
  }, [details]);

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

  // Poster for the hero. List cards all draw `poster_path`, so an alternate
  // variant is preferred when TMDB has one: that keeps the detail screen from
  // repeating the exact artwork the user just tapped. Falls back to the list
  // poster for older cached payloads and titles with no extra artwork.
  const heroPosterPath = useMemo(() => {
    if (!details) return null;
    const alternate = (details.posters ?? []).find(
      (poster) => poster.file_path && poster.file_path !== details.poster_path,
    );
    return alternate?.file_path || details.poster_path || null;
  }, [details]);

  /**
   * "Next: 3 days" copy. Null whenever the date is unusable, which hides the
   * pill rather than rendering a broken label.
   */
  const nextAirLabel = useMemo(
    () => getNextAirLabel(tvProgress?.next_episode?.air_date),
    [tvProgress],
  );

  const loadAll = useCallback(async () => {
    if (!params.type || !params.id) {
      return;
    }
    setLoading(true);
    setError(null);
    try {
      if (token) {
        const [detailsData, watchlist, watchedStatus, favoriteStatus] =
          await Promise.all([
            fetchMediaDetails(params.type, params.id),
            fetchWatchlist(),
            fetchWatchedStatus(params.id, params.type, {
              includeTvProgress: isTv,
            }),
            fetchFavoriteStatus(params.id),
          ]);
        setDetails(detailsData);
        setInWatchlist(watchlist.some((item) => item.id === detailsData.id));
        setWatchlistIds(new Set(watchlist.map((item) => item.id)));
        setFavorited(favoriteStatus.favorited ?? false);
        setTvProgress(watchedStatus.tv_progress ?? null);
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
        setWatchlistIds(new Set());
        setWatched(false);
        setFavorited(false);
        setWatchedEpisodes(new Set());
        setTvProgress(null);
      }
    } catch (err: any) {
      setError(err.message || String(err));
    } finally {
      setLoading(false);
    }
  }, [params.type, params.id, isMovie, isTv, token]);

  /**
   * Re-reads watched state and hero progress after a toggle.
   *
   * The server owns the "caught up / next episode" verdict, so this keeps the
   * bar and the countdown pill honest instead of re-deriving them from the
   * local watched set. Failures are swallowed on purpose: progress is
   * decoration, and a metadata hiccup must not surface an error over a watch
   * action that already succeeded.
   */
  const statusRequestId = useRef(0);
  const refreshWatchedStatus = useCallback(async () => {
    if (!token || !params.id) return;
    const requestId = ++statusRequestId.current;
    try {
      const status = await fetchWatchedStatus(params.id, params.type, {
        includeTvProgress: isTv,
      });
      // A newer toggle already asked for fresher data; its answer wins.
      if (requestId !== statusRequestId.current) return;
      setTvProgress(status.tv_progress ?? null);
      if (isMovie) {
        setWatched(status.watched ?? false);
      } else if (status.episodes) {
        const next = new Set<string>();
        for (const ep of status.episodes) {
          next.add(`${ep.season}:${ep.episode}`);
        }
        setWatchedEpisodes(next);
      }
    } catch {
      // Keep the last good values.
    }
  }, [isMovie, isTv, params.id, params.type, token]);

  /**
   * Keeps the hero's progress pills honest after a watched mutation.
   *
   * Un-marking is reflected locally straight away: the user is demonstrably no
   * longer caught up, and a stale "Next: 3 days" would be a lie until the
   * server confirms it.
   */
  const syncTvProgress = useCallback(
    (removedSomething = false) => {
      if (!isTv) return;
      if (removedSomething) {
        setTvProgress((prev) => (prev ? { ...prev, caught_up: false } : prev));
      }
      void refreshWatchedStatus();
    },
    [isTv, refreshWatchedStatus],
  );

  useEffect(() => {
    setTelemetryScreen("media-detail");
    // eslint-disable-next-line react-hooks/set-state-in-effect
    loadAll();
  }, [loadAll, token]);

  /**
   * Loads the franchise's films, once the details report one.
   *
   * Keyed on the collection id rather than on `details`, so the request does not
   * repeat every time anything else about the title changes (a watched toggle
   * replaces the details object) while still refetching when the title belongs
   * to a different franchise.
   *
   * A failure is swallowed on purpose: the row is decoration, and replacing the
   * page with an error over it would be far worse than a missing row.
   */
  const collectionId = details?.collection?.id ?? null;
  useEffect(() => {
    if (collectionId === null) {
      return;
    }
    let cancelled = false;
    fetchCollection(collectionId)
      .then((data) => {
        if (!cancelled) {
          setCollection(data);
        }
      })
      .catch(() => {
        // Leave the row hidden.
      });
    return () => {
      cancelled = true;
    };
  }, [collectionId]);

  /** Opens a card from the collection or related rows. */
  const openRelated = useCallback(
    (item: TMDBMedia) => {
      // The same resolution the Discover grid uses: TMDB ids are per-namespace,
      // so an item that arrives without a media type must not be guessed as a
      // movie — that would open a completely different title.
      const type = item.media_type || (item.title ? "movie" : "tv");
      push({
        pathname: "/media/[type]/[id]",
        params: { type, id: String(item.id) },
      } as any);
    },
    [push],
  );

  /**
   * Watchlist toggle for a card in the collection or related rows.
   *
   * Optimistic, like the hero's button, but it deliberately avoids the screen's
   * `error` state: a failed bookmark on a card several rows down would replace
   * the whole page with an error message. The optimistic change is rolled back
   * and the failure logged instead.
   */
  const toggleRelatedWatchlist = useCallback(
    async (item: TMDBMedia) => {
      if (!token) {
        push("/auth");
        return;
      }
      const wasAdded = watchlistIds.has(item.id);
      const setMembership = (added: boolean) =>
        setWatchlistIds((prev) => {
          const next = new Set(prev);
          if (added) {
            next.add(item.id);
          } else {
            next.delete(item.id);
          }
          return next;
        });

      setMembership(!wasAdded);
      try {
        if (wasAdded) {
          await removeFromWatchlist(item.id);
        } else {
          await addToWatchlist(item);
        }
        await invalidateMediaCaches();
      } catch (err) {
        setMembership(wasAdded);
        if (__DEV__) {
          console.warn(
            "[media-detail] watchlist toggle failed for a row card:",
            err,
          );
        }
      }
    },
    [push, token, watchlistIds],
  );

  const toggleSeason = useCallback(
    async (seasonNumber: number) => {
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
        setSeasonEpisodes((prev) => ({
          ...prev,
          [seasonNumber]: data.episodes,
        }));
      } catch (err: any) {
        setError(err.message || String(err));
      } finally {
        setSeasonLoading((prev) => {
          const next = new Set(prev);
          next.delete(seasonNumber);
          return next;
        });
      }
    },
    [params.id, seasonEpisodes, seasonLoading],
  );

  const toggleWatchlist = async () => {
    if (!token) {
      push("/auth");
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
      push("/auth");
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

  const toggleFavorite = async () => {
    if (!token) {
      push("/auth");
      return;
    }
    if (!details || favoriteLoading) {
      return;
    }
    const next = !favorited;
    setFavorited(next);
    setFavoriteLoading(true);
    try {
      if (next) {
        await addToFavorites(details);
      } else {
        await removeFromFavorites(details.id);
      }
    } catch (err: any) {
      setFavorited(!next);
      setError(err.message || String(err));
    } finally {
      setFavoriteLoading(false);
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
          nextWatched.add(`${ep.season_number}:${ep.episode_number}`),
        );
        setWatchedEpisodes(nextWatched);
        await invalidateMediaCaches();
        syncTvProgress();
      } else {
        // One request replaces one DELETE per watched episode. Clearing a
        // ten-season show used to fire ~200 sequential requests, which was slow
        // enough to look broken and hammered the backend.
        const episodes = Array.from(watchedEpisodes).map((key) => {
          const [season, episode] = key.split(":").map(Number);
          return { season, episode };
        });

        await unmarkWatchedBulk({
          media_id: details.id,
          media_type: "tv",
          episodes,
        });
        setWatchedEpisodes(new Set());
        await invalidateMediaCaches();
        syncTvProgress(true);
      }
    } catch (err: any) {
      setError(err.message || String(err));
    } finally {
      setWatchedLoading(false);
    }
  };

  const handleWatchlistButtonPress = async () => {
    if (!token) {
      push("/auth");
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

  const watchlistAction = useMemo(() => {
    if (!inWatchlist) {
      return {
        label: "Watchlist",
        icon: "plus" as const,
        tone: "white" as const,
      };
    }
    if (isUnreleased) {
      return {
        label: "Unreleased",
        icon: "lock" as const,
        tone: "muted" as const,
      };
    }
    if (isSeen) {
      return {
        label: "Seen",
        icon: "check" as const,
        tone: "success" as const,
      };
    }
    return {
      label: "Mark as seen",
      icon: "check" as const,
      tone: "white" as const,
    };
  }, [inWatchlist, isUnreleased, isSeen]);

  const episodeKey = (season: number, episode: number) =>
    `${season}:${episode}`;

  const toggleEpisode = async (
    episode: Episode,
    seasonEpisodesList: Episode[],
  ) => {
    if (!token) {
      push("/auth");
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
          syncTvProgress(true);
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
          syncTvProgress();
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

    confirm({
      title: "Mark Previous Episodes?",
      message:
        "Would you like to mark all previous episodes of this show as watched too?",
      confirmLabel: "Yes",
      cancelLabel: "No",
      // "No" still records this episode; waving the dialog away does not, which
      // is why the decline is separate from the dismissal.
      onCancel: markSingle,
      onConfirm: async () => {
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
          syncTvProgress();
        } catch (err: any) {
          setError(err.message || String(err));
          loadAll();
        }
      },
    });
  };

  const openEpisode = (episode: Episode) => {
    push({
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

  /**
   * Whether the meta row leads with an age-rating badge. It also drives the
   * separators: with a badge in front, the first genre needs a dot before it
   * like every other item does.
   */
  const hasCertification = Boolean(details?.certification);

  return (
    <YStack f={1} bg="$background">
      <YStack f={1} pt={topInset}>
        {showLoadingUI ? (
          <LoadingOrb label="Loading details..." />
        ) : error ? (
          <YStack f={1} ai="center" jc="center" gap="$4" px="$4">
            <Text color="$red10" fow="700" ta="center">
              {error}
            </Text>
            <Button onPress={() => back()}>Back</Button>
          </YStack>
        ) : details ? (
          <ScrollView
            showsVerticalScrollIndicator={false}
            // Replaces the SafeAreaView wrapper: iOS insets the scroll content
            // around the status bar natively, so the hero can also scroll
            // *under* it instead of being clipped below it.
            contentInsetAdjustmentBehavior="automatic"
            contentContainerStyle={{ paddingBottom: 120 }}
          >
            {/* Hero Poster */}
            <YStack h={600} bg="#151515">
              {heroPosterPath ? (
                <Image
                  source={{ uri: imageUrl(heroPosterPath, "backdrop") }}
                  style={{ width: "100%", height: "100%" }}
                  contentFit="cover"
                  cachePolicy={imageCachePolicy("backdrop")}
                  transition={imageTransitionMs("backdrop")}
                  recyclingKey={heroPosterPath}
                />
              ) : (
                <YStack f={1} ai="center" jc="center">
                  <Text color="$color" opacity={0.5}>
                    No poster available
                  </Text>
                </YStack>
              )}

              {/*
                Top controls and the status pill only. Genres, runtime and the
                provider live below the artwork, so the hero needs no scrim
                dimming it: the back button, the trailer button and every pill
                here carry their own translucent surface.
              */}
              <YStack
                pos="absolute"
                t={0}
                l={0}
                r={0}
                b={0}
                jc="space-between"
                p="$4"
              >
                <YStack gap="$3" w="100%" ai="center">
                  <XStack w="100%" jc="space-between" ai="center">
                    <BackButton onPress={() => back()} />

                    {trailer ? (
                      <HeroIconButton
                        accessibilityLabel="Play trailer"
                        onPress={openTrailer}
                      >
                        <Clapperboard
                          size={19}
                          color="#FFFFFF"
                          strokeWidth={2.4}
                        />
                      </HeroIconButton>
                    ) : null}
                  </XStack>

                  {/* Status badge: stays over the artwork in its translucent pill. */}
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
                </YStack>

                {/* Bottom of hero: the progress pills, then the actions. */}
                <YStack gap="$3" w="100%">

                  {/* Logo or Title */}
                  {/* {logo ? (
                    <Image
                      source={{ uri: imageUrl(logo.file_path, "logo") }}
                      style={styles.logoImage}
                      contentFit="contain"
                      cachePolicy={imageCachePolicy("logo")}
                      transition={imageTransitionMs("logo")}
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
                  )} */}

                  {/*
                    The watch bar as a plain line on the artwork: a caption row
                    ("Watched" / "3 of 8"), then the bar itself. No pill, no
                    percentage — the count carries more information and the
                    translucent pill only competed with the action row.

                    The bar is still the Watchlist component so the two screens
                    cannot drift apart; it is the fill and track colours that
                    are overridden here, because the watchlist's tier colours
                    and page-background track are tuned for a card.
                  */}
                  

                  <XStack gap="$2" ai="center" jc="center" w="100%">
                    <Button
                      f={1}
                      size="$4"
                      borderRadius="$10"
                      bg="rgba(20,20,24,0.55)"
                      color="white"
                      borderWidth={1}
                      borderColor="rgba(255,255,255,0.28)"
                      style={styles.actionButtonShadow}
                      disabled={
                        watchlistLoading ||
                        watchedLoading ||
                        (inWatchlist && isUnreleased)
                      }
                      onPress={handleWatchlistButtonPress}
                      icon={
                        watchlistLoading || watchedLoading ? (
                          <Spinner size="small" color="white" />
                        ) : watchlistAction.icon === "plus" ? (
                          <Plus size={17} color="#FFFFFF" strokeWidth={2.6} />
                        ) : watchlistAction.icon === "lock" ? (
                          <Lock
                            size={16}
                            color="rgba(255,255,255,0.7)"
                            strokeWidth={2.4}
                          />
                        ) : (
                          <Check
                            size={17}
                            color={
                              watchlistAction.tone === "success"
                                ? "#4ADE80"
                                : "#FFFFFF"
                            }
                            strokeWidth={3}
                          />
                        )
                      }
                      h={46}
                      px="$3"
                    >
                      {watchlistAction.label}
                    </Button>

                    <Button
                      size="$4"
                      borderRadius="$10"
                      w={46}
                      h={46}
                      bg={
                        favorited
                          ? "rgba(255, 60, 60, 0.35)"
                          : "rgba(20,20,24,0.55)"
                      }
                      borderWidth={1}
                      borderColor={
                        favorited
                          ? "rgba(255, 110, 110, 0.75)"
                          : "rgba(255,255,255,0.28)"
                      }
                      style={styles.actionButtonShadow}
                      disabled={favoriteLoading}
                      onPress={toggleFavorite}
                      p="$0"
                      jc="center"
                      ai="center"
                      aria-label={
                        favorited ? "Remove from favorites" : "Add to favorites"
                      }
                    >
                      {favoriteLoading ? (
                        <Spinner size="small" color="#FF5A5A" />
                      ) : (
                        <Heart
                          size={20}
                          color={favorited ? "#FF5A5A" : "#FFFFFF"}
                          fill={favorited ? "#FF5A5A" : "transparent"}
                          strokeWidth={2.2}
                        />
                      )}
                    </Button>
                  </XStack>

                  
{isTv &&
                  tvProgress &&
                  tvProgress.total_episodes > 0 &&
                  tvProgress.released ? (
                    <YStack w="100%">
                      <XStack
                        w="100%"
                        jc="space-between"
                        ai="center"
                        mb="$1.5"
                      >
                        <Text
                          color="white"
                          opacity={0.85}
                          fow="600"
                          fos="$2"
                          style={styles.heroLabel}
                        >
                          Watched
                        </Text>
                        <Text
                          color="white"
                          opacity={0.85}
                          fow="600"
                          fos="$2"
                          style={styles.heroLabel}
                        >
                          {tvProgress.watched_episodes} of{" "}
                          {tvProgress.total_episodes}
                        </Text>
                      </XStack>

                      <WatchProgressBar
                        progress={tvProgress.progress}
                        showLabel={false}
                        trackColor="rgba(255,255,255,0.28)"
                        barColor="#FFFFFF"
                      />
                    </YStack>
                  ) : null}

                  {/*
                    Countdown to the next episode, centred under the action row.

                    Server-gated: `caught_up` means nothing that has already
                    aired is unwatched, and `next_episode` carries the air date,
                    so the client only formats it.
                  */}
                  {tvProgress?.caught_up && nextAirLabel ? (
                    <XStack ai="center" jc="center" gap="$1.5" mt="$1">
                      <Calendar
                        size={14}
                        color="rgba(255,255,255,0.85)"
                        strokeWidth={2.4}
                      />
                      <Text
                        color="white"
                        opacity={0.9}
                        fow="600"
                        fos="$2"
                        numberOfLines={1}
                        style={styles.heroLabel}
                      >
                        Next: {nextAirLabel}
                      </Text>
                    </XStack>
                  ) : null}
                </YStack>
              </YStack>
            </YStack>

            {/*
              Certification, genres, runtime and provider, on the page
              background rather than over the artwork. One wrapping row; the text
              follows the theme colour because the hardcoded white it used over
              the backdrop would be invisible on a light page.

              The OMDb score badges (IMDb, Metascore, Rotten Tomatoes) are still
              deliberately absent: the cards the user arrived from (Discover,
              search, watchlist) already carry them, so repeating them here was
              noise. The age rating is a different thing — it belongs nowhere
              else in the app, and it is what tells you whether the title is
              something you can watch with the kids.
            */}
            {(details.genres ?? []).length > 0 ||
            runtime ||
            hasCertification ||
            (isTv && details.network) ? (
              <XStack ai="center" gap="$2" flexWrap="wrap" mt="$4" mx="$4">
                {/*
                  Certification leads the row because it describes the whole
                  title rather than one of its facets, and it gets a hairline box
                  instead of a dot separator: a bare "PG-13" sitting between two
                  dots reads as just another genre.
                */}
                {details.certification ? (
                  <XStack
                    px="$2"
                    py={1}
                    borderRadius="$2"
                    borderWidth={1}
                    borderColor="$borderColor"
                    bg="$backgroundElement"
                  >
                    <Text color="$color" opacity={0.85} fow="800" fos="$2">
                      {details.certification}
                    </Text>
                  </XStack>
                ) : null}
                {(details.genres ?? []).map((genre, i) => (
                  <XStack key={genre.id} ai="center" gap="$2">
                    {(i > 0 || hasCertification) ? <YStack
                        w={3}
                        h={3}
                        borderRadius={999}
                        bg="$color"
                        opacity={0.35}
                      /> : null}
                    <Text color="$color" opacity={0.75} fow="500" fos="$3">
                      {genre.name}
                    </Text>
                  </XStack>
                ))}
                {runtime ? (
                  <XStack ai="center" gap="$2">
                    {((details.genres ?? []).length > 0 || hasCertification) ? <YStack
                        w={3}
                        h={3}
                        borderRadius={999}
                        bg="$color"
                        opacity={0.35}
                      /> : null}
                    <Text color="$color" opacity={0.75} fow="500" fos="$3">
                      {runtime}
                    </Text>
                  </XStack>
                ) : null}
                {isTv && details.network ? (
                  <XStack ai="center" gap="$2">
                    {((details.genres ?? []).length > 0 ||
                      runtime ||
                      hasCertification) ? <YStack
                        w={3}
                        h={3}
                        borderRadius={999}
                        bg="$color"
                        opacity={0.35}
                      /> : null}
                    <Text color="$color" opacity={0.75} fow="500" fos="$3">
                      {details.network}
                    </Text>
                  </XStack>
                ) : null}
              </XStack>
            ) : null}

            {/* TV Tab Switcher */}
            {isTv ? <XStack
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
              </XStack> : null}

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
                          <YStack key={member.id} w={100} ai="center" gap="$2">
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
                                  source={{ uri: imageUrl(member.profile_path, "profile") }}
                                  style={{ width: "100%", height: "100%" }}
                                  contentFit="cover"
                                  cachePolicy={imageCachePolicy("profile")}
                                  transition={imageTransitionMs("profile")}
                                  recyclingKey={member.profile_path}
                                />
                              ) : (
                                <YStack f={1} ai="center" jc="center">
                                  <Text color="$color" opacity={0.5} fos="$1">
                                    No photo
                                  </Text>
                                </YStack>
                              )}
                            </YStack>
                            <YStack ai="center" gap={2}>
                              <Text
                                color="$color"
                                fow="700"
                                fos="$2"
                                ta="center"
                                numberOfLines={2}
                              >
                                {member.name}
                              </Text>
                              {/*
                                The role, under the actor. Without it the row is a
                                list of names with no indication of who played
                                whom — the single most useful thing to know here.
                                Capped at two lines like the name, so a long
                                character ("Tyrion 'The Halfman' Lannister") does
                                not stretch one cell past its neighbours.
                              */}
                              {member.character ? (
                                <Text
                                  color="$color"
                                  opacity={0.5}
                                  fos="$1"
                                  ta="center"
                                  numberOfLines={2}
                                >
                                  {member.character}
                                </Text>
                              ) : null}
                            </YStack>
                          </YStack>
                        ))}
                      </XStack>
                    </ScrollView>
                  )}
                </YStack>

                {/*
                  Franchise, then related titles. Both reuse the Discover
                  carousel — a horizontal FlashList of MediaCards — so every row
                  in the app behaves identically: recycled cells, the same poster
                  sizes, and a working watchlist button.

                  The collection row exists only for movies that TMDB files under
                  a franchise (it does not model collections for TV), and only
                  once its parts have arrived; the related row renders straight
                  from the details payload.
                */}
                {collection && collection.id === details.collection?.id ? (
                  <MediaCarousel
                    title={collection.name}
                    items={collection.parts}
                    watchlistIds={watchlistIds}
                    onOpen={openRelated}
                    onToggle={toggleRelatedWatchlist}
                  />
                ) : null}

                {(details.recommendations ?? []).length > 0 ? (
                  <MediaCarousel
                    title={isMovie ? "Related Movies" : "Related Shows"}
                    items={details.recommendations ?? []}
                    watchlistIds={watchlistIds}
                    onOpen={openRelated}
                    onToggle={toggleRelatedWatchlist}
                  />
                ) : null}
              </YStack>
            )}
          </ScrollView>
        ) : null}
      </YStack>

      {/* Sibling of the scroll view, and rendered whether or not details have
          loaded, so the dialog is never unmounted out from under itself. */}
      {dialogProps ? <ConfirmDialog {...dialogProps} /> : null}
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
  // Translucent, always-legible action buttons that sit on top of the backdrop.
  actionButtonShadow: {
    // CSS box-shadow syntax replacing the legacy shadow* props plus Android
    // `elevation`, which had to be kept in step with them by hand.
    boxShadow: "0 3px 8px rgba(0, 0, 0, 0.45)",
  },
  // The watch bar's caption and the countdown sit directly on the artwork with
  // no pill behind them, so they get the same shadow treatment as hero copy.
  heroLabel: {
    textShadowColor: "rgba(0,0,0,0.85)",
    textShadowOffset: { width: 0, height: 1 },
    textShadowRadius: 6,
  },
  episodeThumb: {
    boxShadow: "0 2px 6px rgba(0, 0, 0, 0.35)",
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
  /**
   * Episode row's circular "seen" toggle, replacing the TouchableOpacity that
   * used to inline this geometry as an object literal on every render.
   */
  watchToggle: {
    width: 40,
    height: 40,
    alignItems: "center",
    justifyContent: "center",
  },
  /** Unreleased episodes are dimmed and inert. */
  watchToggleLocked: {
    opacity: 0.4,
  },
  /** Press feedback replacing TouchableOpacity's `activeOpacity`. */
  watchTogglePressed: {
    opacity: 0.7,
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
  /**
   * Lucide takes a resolved colour rather than a Tamagui token, so the icon
   * colour is read from the active theme here — the same way the episode screen
   * resolves the colours for its own icons.
   */
  const theme = useTheme();

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
        {/*
          Lucide chevrons rather than the ▲/▼ glyphs: those render as a
          different shape and weight in every platform's fallback font, they
          scale with the system font size instead of the layout, and they carry
          no accessibility semantics.
        */}
        {expanded ? (
          <ChevronUp
            size={20}
            color={theme.color?.val ?? "#000000"}
            strokeWidth={2.6}
          />
        ) : (
          <ChevronDown
            size={20}
            color={theme.color?.val ?? "#000000"}
            strokeWidth={2.6}
          />
        )}
      </XStack>

      {expanded ? <YStack px="$3" pb="$3" gap="$0">
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
        </YStack> : null}
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
          "Jan",
          "Feb",
          "Mar",
          "Apr",
          "May",
          "Jun",
          "Jul",
          "Aug",
          "Sep",
          "Oct",
          "Nov",
          "Dec",
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
        <View style={styles.episodeThumb}>
          <YStack
            w={120}
            h={84}
            borderRadius={10}
            overflow="hidden"
            bg="$backgroundElement"
          >
          {episode.still_path ? (
            <Image
              source={{ uri: imageUrl(episode.still_path, "still") }}
              style={{ width: "100%", height: "100%" }}
              contentFit="cover"
              cachePolicy={imageCachePolicy("still")}
              transition={imageTransitionMs("still")}
              recyclingKey={episode.still_path}
            />
          ) : showDetails.backdrop_path ? (
            <Image
              source={{ uri: imageUrl(showDetails.backdrop_path, "still") }}
              style={{ width: "100%", height: "100%" }}
              contentFit="cover"
              cachePolicy={imageCachePolicy("still")}
              transition={imageTransitionMs("still")}
              recyclingKey={showDetails.backdrop_path}
            />
          ) : showDetails.poster_path ? (
            <Image
              source={{ uri: imageUrl(showDetails.poster_path, "posterCell") }}
              style={{ width: "100%", height: "100%" }}
              contentFit="cover"
              cachePolicy={imageCachePolicy("posterCell")}
              transition={imageTransitionMs("posterCell")}
              recyclingKey={showDetails.poster_path}
            />
          ) : (
            <YStack f={1} ai="center" jc="center">
              <Text color="$color" opacity={0.4} fos="$1">
                No image
              </Text>
            </YStack>
          )}
          </YStack>
        </View>

        {/* Middle: Content Stack */}
        <YStack f={1} gap="$1">
          <Text
            color="$color"
            opacity={0.5}
            fos="$2"
            fow="600"
            letterSpacing={0.5}
          >
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
        {(() => {
          const epUnreleased = (() => {
            if (!episode.air_date) return false;
            const parts = episode.air_date.split("-");
            if (parts.length !== 3) return false;
            const airDate = new Date(
              Number(parts[0]),
              Number(parts[1]) - 1,
              Number(parts[2]),
            );
            const today = new Date();
            today.setHours(0, 0, 0, 0);
            return airDate > today;
          })();

          return (
            <Pressable
              onPress={(e) => {
                if (epUnreleased) return;
                e.stopPropagation();
                onToggle();
              }}
              hitSlop={8}
              accessibilityRole="button"
              accessibilityState={{ disabled: epUnreleased, selected: watched }}
              style={({ pressed }) => [
                styles.watchToggle,
                epUnreleased && styles.watchToggleLocked,
                pressed && !epUnreleased && styles.watchTogglePressed,
              ]}
            >
              <MediaToggleBadge
                state={epUnreleased ? "locked" : watched ? "active" : "idle"}
              />
            </Pressable>
          );
        })()}
      </XStack>

      {!isLast && <YStack height={1} bg="$borderColor" opacity={0.2} />}
    </YStack>
  );
}
