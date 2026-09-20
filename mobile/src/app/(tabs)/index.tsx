import { FlashList } from "@shopify/flash-list";
import { useFocusEffect, useRouter } from "expo-router";
import React, { useCallback, useEffect, useMemo, useState } from "react";
import { Platform, StyleSheet } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Button, Spinner, Text, XStack, YStack } from "tamagui";

import { useAuth } from "@/context/AuthContext";
import LoadingOrb from "@/components/LoadingOrb";
import {
  NewSeasonCard,
  ReadyCard,
  UpcomingGroup,
} from "@/components/Home/ScheduleSections";

import { invalidateMediaCaches } from "@/lib/cache";
import { fetchHomeSchedule, markWatched } from "@/lib/media-api";
import { watchedKey } from "@/lib/db/reconcile";
import { useDeferredLoading } from "@/hooks/use-deferred-loading";
import { usePendingOverlay } from "@/hooks/use-pending-overlay";
import {
  groupUpcoming,
  toResolvedMovie,
  toResolvedShow,
  type ResolvedMovieItem,
  type ResolvedScheduleItem,
  type ResolvedShowItem,
} from "@/lib/schedule";
import { setTelemetryScreen } from "@/lib/telemetry";

/**
 * One section of the schedule.
 *
 * Virtualization happens at *section* granularity rather than per row, because
 * each section is an enclosed card: its tinted surface and border wrap the
 * whole group, so splitting rows into individual list items would mean either
 * dropping that container or redrawing it piecewise across items. Sections are
 * the unit that keeps the design intact, and it is still enough to keep
 * far-off month groups in the upcoming schedule from mounting at all.
 */
type ScheduleListItem =
  | { type: "newSeason"; key: string; items: ResolvedShowItem[] }
  | { type: "ready"; key: string; items: ResolvedScheduleItem[] }
  | { type: "upcoming"; key: string; header: string; items: ResolvedScheduleItem[] };

/**
 * Home schedule.
 *
 * The screen used to assemble itself: it fetched the watchlist, then issued a
 * watched-status and a media-details request per title, and for TV shows paged
 * through seasons looking for the next episode. That is now one request to
 * `/api/home/schedule`, with freshness and conditional revalidation handled by
 * the shared HTTP layer.
 */
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

  const pendingOverlay = usePendingOverlay();

  /**
   * What the screen renders instead of raw `loading`/`authLoading`.
   *
   * Both flags are deferred: held back for 150ms, then held for at least 500ms
   * once shown so the orb cannot blink. The debounce is what actually fixes
   * this tab — `loadData` runs non-silently on every focus, so a schedule
   * answered from cache (or by a 304) used to replace itself with a spinner
   * each time the user came back here.
   */
  const showAuthLoading = useDeferredLoading(authLoading);
  const showLoadingUI = useDeferredLoading(loading);

  useEffect(() => {
    if (!authLoading && !token) {
      router.replace("/auth");
    }
  }, [authLoading, token, router]);

  /**
   * Loads the whole schedule in one request.
   *
   * There is no client-side staleness throttle any more: `requestJsonCached`
   * owns freshness and conditional revalidation, and a failed revalidation
   * serves the last good schedule rather than blanking the screen.
   */
  const loadData = useCallback(async (options?: { silent?: boolean }) => {
    const silent = options?.silent ?? false;
    if (silent) {
      setBackgroundRefreshing(true);
    } else {
      setLoading(true);
    }
    setError(null);

    try {
      const schedule = await fetchHomeSchedule();
      setShowsReady(schedule.shows_ready.map(toResolvedShow));
      setShowsUpcoming(schedule.shows_upcoming.map(toResolvedShow));
      setMoviesReady(schedule.movies_ready.map(toResolvedMovie));
      setMoviesUpcoming(schedule.movies_upcoming.map(toResolvedMovie));
    } catch (err: any) {
      setError(err.message || String(err));
    } finally {
      setLoading(false);
      setBackgroundRefreshing(false);
    }
  }, []);

  /**
   * Retry after a failed load.
   *
   * Clears the cache first: a plain reload would be answered from a
   * still-fresh entry instead of going back to the network.
   */
  const handleRetry = useCallback(async () => {
    await invalidateMediaCaches();
    await loadData();
  }, [loadData]);

  useFocusEffect(
    useCallback(() => {
      setTelemetryScreen("home");
      if (token) {
        loadData();
      }
    }, [loadData, token]),
  );

  const openDetails = useCallback(
    (item: ResolvedScheduleItem) => {
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
          params: { type: "movie", id: String(item.movie.id) },
        } as any);
      }
    },
    [router],
  );

  /**
   * Marks the current episode (or movie) watched.
   *
   * The schedule is reloaded afterwards so the *server* decides what comes
   * next; the client used to work that out itself by paging through every
   * season.
   *
   * Memoized so `renderSection` (which depends on it) keeps a stable identity
   * between renders — otherwise every section would re-render on each tap.
   */
  const handleMarkWatched = useCallback(
    async (item: ResolvedScheduleItem) => {
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
          setShowsReady((prev) => prev.filter((s) => s.id !== item.id));
        } else {
          await markWatched({ media_id: item.movie.id, media_type: "movie" });
          setMoviesReady((prev) => prev.filter((m) => m.id !== item.id));
        }

        // The mutation advanced the user's server-side version, so the cached
        // payload is retired and the next fetch gets fresh (or 304-validated)
        // data in a single request.
        await invalidateMediaCaches();
        await loadData({ silent: true });
      } catch (err: any) {
        setError(err.message || "Failed to mark as watched");
      } finally {
        setMarkingId(null);
      }
    },
    [loadData, markingId],
  );

  /**
   * The server's schedule with any offline mutations layered on top.
   *
   * Without this, a mutation made offline is reflected only in this screen's own
   * state: restart the app while still offline and the cached payload is served
   * again, so an episode the user marked watched reappears as unwatched and a
   * removed title comes back. The overlay is exactly the set of changes the
   * server has not been told about yet.
   */
  const { visibleShowsReady, visibleShowsUpcoming, visibleMoviesReady, visibleMoviesUpcoming } =
    useMemo(() => {
      const hidden = pendingOverlay.watchlistRemovedIds;
      const alreadyWatched = pendingOverlay.watchedAdded;

      const showWasWatchedOffline = (item: ResolvedShowItem) =>
        alreadyWatched.has(
          watchedKey(
            "tv",
            item.show.id,
            item.episode.season_number,
            item.episode.episode_number,
          ),
        );

      const movieWasWatchedOffline = (item: ResolvedMovieItem) =>
        alreadyWatched.has(watchedKey("movie", item.movie.id));

      const keepShow = (item: ResolvedShowItem) =>
        !hidden.has(item.show.id) && !showWasWatchedOffline(item);
      const keepMovie = (item: ResolvedMovieItem) =>
        !hidden.has(item.movie.id) && !movieWasWatchedOffline(item);

      return {
        visibleShowsReady: showsReady.filter(keepShow),
        visibleShowsUpcoming: showsUpcoming.filter(keepShow),
        visibleMoviesReady: moviesReady.filter(keepMovie),
        visibleMoviesUpcoming: moviesUpcoming.filter(keepMovie),
      };
    }, [moviesReady, moviesUpcoming, pendingOverlay, showsReady, showsUpcoming]);

  const readyNewSeasonList = useMemo(
    () =>
      activeTab === "tv"
        ? visibleShowsReady.filter((item) => item.isNewSeason)
        : [],
    [activeTab, visibleShowsReady],
  );

  const readyRegularList = useMemo<ResolvedScheduleItem[]>(
    () =>
      activeTab === "tv"
        ? visibleShowsReady.filter((item) => !item.isNewSeason)
        : visibleMoviesReady,
    [activeTab, visibleMoviesReady, visibleShowsReady],
  );

  const activeUpcomingGroups = useMemo(
    () =>
      activeTab === "tv"
        ? groupUpcoming(visibleShowsUpcoming)
        : groupUpcoming(visibleMoviesUpcoming),
    [activeTab, visibleMoviesUpcoming, visibleShowsUpcoming],
  );

  const listData = useMemo<ScheduleListItem[]>(() => {
    const out: ScheduleListItem[] = [];

    if (readyNewSeasonList.length > 0) {
      out.push({ type: "newSeason", key: "new-season", items: readyNewSeasonList });
    }
    if (readyRegularList.length > 0) {
      out.push({ type: "ready", key: "ready", items: readyRegularList });
    }
    for (const [header, items] of Object.entries(activeUpcomingGroups)) {
      out.push({ type: "upcoming", key: `upcoming-${header}`, header, items });
    }

    return out;
  }, [activeUpcomingGroups, readyNewSeasonList, readyRegularList]);

  const renderSection = useCallback(
    ({ item }: { item: ScheduleListItem }) => {
      switch (item.type) {
        case "newSeason":
          return (
            <NewSeasonCard
              items={item.items}
              markingId={markingId}
              onOpen={openDetails}
              onMarkWatched={handleMarkWatched}
            />
          );
        case "ready":
          return (
            <ReadyCard
              items={item.items}
              markingId={markingId}
              onOpen={openDetails}
              onMarkWatched={handleMarkWatched}
            />
          );
        case "upcoming":
          return (
            <UpcomingGroup
              header={item.header}
              items={item.items}
              onOpen={openDetails}
            />
          );
        default:
          return null;
      }
    },
    [handleMarkWatched, markingId, openDetails],
  );

  if (showAuthLoading) {
    return (
      <YStack f={1} ai="center" jc="center" bg="$background">
        {/* No caption: this is the session restore, and the schedule's own
            caption follows it immediately. */}
        <LoadingOrb />
      </YStack>
    );
  }

  if (!token) {
    return null;
  }

  const hasNothingToShow = listData.length === 0;

  return (
    <YStack f={1} bg="$background">
      <SafeAreaView style={styles.safeArea} edges={["top"]}>
        <YStack f={1} px="$4" gap="$4">
          {/* Top Tabs Toggle: Shows vs Movies */}
          <XStack mt="$2" gap="$3" ai="center">
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

          {showLoadingUI ? (
            <LoadingOrb label="Loading Schedule..." />
          ) : error ? (
            <YStack f={1} ai="center" jc="center" gap="$4">
              <Text color="$red10" ta="center" fow="700">
                {error}
              </Text>
              <Button onPress={handleRetry}>Retry</Button>
            </YStack>
          ) : hasNothingToShow ? (
            <YStack f={1} ai="center" jc="center" gap="$3" px="$5">
              <Text fow="800" fos="$6" color="$color" ta="center">
                No tracked {activeTab === "tv" ? "shows" : "movies"} in your watchlist
              </Text>
              <Text color="$color" opacity={0.55} ta="center">
                Track {activeTab === "tv" ? "TV shows" : "movies"} by saving them
                to your watchlist, and they will appear here.
              </Text>
            </YStack>
          ) : (
            <FlashList
              data={listData}
              renderItem={renderSection}
              keyExtractor={(section) => section.key}
              getItemType={(section) => section.type}
              ItemSeparatorComponent={SectionSeparator}
              showsVerticalScrollIndicator={false}
              // FlashList v2 sizes itself and manages the render window
              // internally, so `initialNumToRender`/`windowSize` (v1 and
              // FlatList) no longer exist. `drawDistance` is the remaining
              // knob; one screenful of look-ahead avoids mounting month groups
              // the user has not scrolled to.
              drawDistance={800}
              contentContainerStyle={styles.listContent}
            />
          )}
        </YStack>
      </SafeAreaView>
    </YStack>
  );
}

/** Replaces the outer stack's `gap` now that sections are separate list items. */
function SectionSeparator() {
  return <YStack h={20} />;
}

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
    paddingTop: Platform.OS === "web" ? 60 : 0,
  },
  listContent: {
    paddingBottom: Platform.OS === "web" ? 40 : 120,
  },
});
