import { FlashList } from "@shopify/flash-list";
import { useFocusEffect, useRouter } from "expo-router";
import React, { useCallback, useEffect, useMemo, useState } from "react";
import { Platform, StyleSheet } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Button, Spinner, Text, XStack, YStack } from "tamagui";

import { useAuth } from "@/context/AuthContext";
import LoadingOrb from "@/components/LoadingOrb";
import {
  buildScheduleList,
  NewSeasonHeader,
  NewSeasonRow,
  ReadyHeader,
  ReadyRow,
  UpcomingHeader,
  UpcomingRow,
  type ScheduleListItem,
} from "@/components/Home/ScheduleSections";
import { getMarkingId, setMarkingId } from "@/components/Home/marking-store";

import { invalidateMediaCaches } from "@/lib/cache";
import { fetchHomeSchedule, markWatched, type HomeScheduleResponse } from "@/lib/media-api";
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
 * Reads the Home schedule.
 *
 * Module-level so this `try`/`catch` is not inside the component. React
 * Compiler's `BuildHIR` rejects any function containing a `try` with a
 * `finally` clause and then skips the ENTIRE component — which is why the Home
 * screen had zero automatic memoisation. Errors are returned rather than thrown
 * so the caller needs no `try` of its own.
 */
async function readHomeSchedule(): Promise<
  { schedule: HomeScheduleResponse } | { error: string }
> {
  try {
    return { schedule: await fetchHomeSchedule() };
  } catch (err: any) {
    return { error: err?.message || String(err) };
  }
}

/**
 * Marks one schedule entry watched.
 *
 * `onMarked` runs between the mutation and the cache work, which preserves the
 * original order: the optimistic list update happens before the refresh that
 * revalidates it.
 */
async function markScheduleItemWatched(
  item: ResolvedScheduleItem,
  onMarked: () => void,
): Promise<void> {
  if (item.isTv) {
    await markWatched({
      media_id: item.show.id,
      media_type: "tv",
      season_number: item.episode.season_number,
      episode_number: item.episode.episode_number,
    });
  } else {
    await markWatched({ media_id: item.movie.id, media_type: "movie" });
  }

  onMarked();
}

/**
 * Home schedule.
 *
 * The screen used to assemble itself: it fetched the watchlist, then issued a
 * watched-status and a media-details request per title, and for TV shows paged
 * through seasons looking for the next episode. That is now one request to
 * `/api/home/schedule`, with freshness and conditional revalidation handled by
 * the shared HTTP layer.
 *
 * The list it renders is flattened: one section used to be one list item, and
 * is now a heading item followed by one item per row, so FlashList can recycle
 * and window rows individually. See `ScheduleSections.tsx` for how the card
 * surface survives that split.
 */
export default function HomeScreen() {
  const { push, replace } = useRouter();
  const { token, isLoading: authLoading } = useAuth();

  const [showsReady, setShowsReady] = useState<ResolvedShowItem[]>([]);
  const [showsUpcoming, setShowsUpcoming] = useState<ResolvedShowItem[]>([]);
  const [moviesReady, setMoviesReady] = useState<ResolvedMovieItem[]>([]);
  const [moviesUpcoming, setMoviesUpcoming] = useState<ResolvedMovieItem[]>([]);

  const [loading, setLoading] = useState(true);
  const [backgroundRefreshing, setBackgroundRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<"tv" | "movies">("tv");

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
      replace("/auth");
    }
  }, [authLoading, token, replace]);

  useEffect(() => {
    // The marking store is a module singleton, so the in-flight row would
    // otherwise outlive this screen: background the app mid-mutation, come back
    // later, and a stale row would still be spinning. Releasing on unmount also
    // keeps a tab switch from carrying a spinner into the next visit.
    return () => setMarkingId(null);
  }, []);

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

    // No try/finally in the component: see `readHomeSchedule`. The flags are
    // cleared after the await on every path, which is what the `finally` did.
    const result = await readHomeSchedule();

    if ("error" in result) {
      setError(result.error);
    } else {
      setShowsReady(result.schedule.shows_ready.map(toResolvedShow));
      setShowsUpcoming(result.schedule.shows_upcoming.map(toResolvedShow));
      setMoviesReady(result.schedule.movies_ready.map(toResolvedMovie));
      setMoviesUpcoming(result.schedule.movies_upcoming.map(toResolvedMovie));
    }

    setLoading(false);
    setBackgroundRefreshing(false);
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
        push({
          pathname: "/media/[type]/[id]/episode/[season]/[episode]",
          params: {
            type: "tv",
            id: String(item.show.id),
            season: String(item.episode.season_number),
            episode: String(item.episode.episode_number),
            // Carried so the episode screen does not refetch the whole show
            // record just for its hero fallback. Falsy values are dropped by
            // the router, so an absent path costs nothing.
            showBackdropPath: item.show.backdrop_path || undefined,
            showPosterPath: item.show.poster_path || undefined,
          },
        } as any);
      } else {
        push({
          pathname: "/media/[type]/[id]",
          params: { type: "movie", id: String(item.movie.id) },
        } as any);
      }
    },
    [push],
  );

  /**
   * Marks the current episode (or movie) watched.
   *
   * The schedule is reloaded afterwards so the *server* decides what comes
   * next; the client used to work that out itself by paging through every
   * season.
   *
   * The in-flight row lives in `marking-store` rather than in state here. Held
   * in state it would be captured by `renderRow`, and every tap would hand
   * FlashList a new `renderItem` and re-render every row in the list; in the
   * store only the row that owns the spinner re-renders. The guard below reads
   * the store directly, which also keeps this callback free of the marking
   * value and so stable across taps.
   *
   * One consequence of not re-rendering the screen on a tap: the marked row can
   * be drawn un-spinning for the window between the mutation landing and
   * `loadData` removing it. The list is replaced immediately afterwards, so
   * nothing is left in that state.
   *
   * Memoised explicitly. This component is still worth being careful with:
   * `loadData` and this callback both used to carry a `try`/`finally`, and
   * `BuildHIR` rejects any function containing one — which skipped the whole
   * component. Those have since been extracted (see `readHomeSchedule` and
   * `markScheduleItemWatched`), so the compiler now compiles this screen, and
   * this `useCallback` is a belt-and-braces guarantee that `renderRow` keeps a
   * stable identity regardless.
   *
   * That identity is what matters: FlashList compares each cell's `renderItem`
   * prop by reference, so a `renderRow` that changed on every render would
   * re-render every mounted cell. `scripts/check-react-compiler-coverage.mjs`
   * reports whether this screen is currently compiled — check it before
   * assuming the compiler is covering any of this.
   */
  const handleMarkWatched = useCallback(
    async (item: ResolvedScheduleItem) => {
      if (getMarkingId() !== null) return;
      setMarkingId(item.id);

      // Optimistic list update, then the cache work the mutation implies. Both
      // live outside the component's control flow (see `markScheduleItemWatched`)
      // so the screen keeps its compiler memoisation.
      try {
        await markScheduleItemWatched(item, () => {
          if (item.isTv) {
            setShowsReady((prev) => prev.filter((s) => s.id !== item.id));
          } else {
            setMoviesReady((prev) => prev.filter((m) => m.id !== item.id));
          }
        });

        // The mutation advanced the user's server-side version, so the cached
        // payload is retired and the next fetch gets fresh (or 304-validated)
        // data in a single request.
        await invalidateMediaCaches();
        await loadData({ silent: true });
      } catch (err: any) {
        setError(err.message || "Failed to mark as watched");
      }

      setMarkingId(null);
    },
    [loadData],
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

  /**
   * The flattened list, as `FlashList` consumes it.
   *
   * One item per row rather than one per section, so FlashList's recycle pool
   * and render window work at row granularity. Built by a helper in
   * `ScheduleSections.tsx` so the item shape and the components that render it
   * stay together.
   */
  const listData = useMemo<ScheduleListItem[]>(
    () =>
      buildScheduleList({
        newSeason: readyNewSeasonList,
        ready: readyRegularList,
        upcoming: Object.entries(activeUpcomingGroups).map(([header, items]) => ({
          header,
          items,
        })),
      }),
    [activeUpcomingGroups, readyNewSeasonList, readyRegularList],
  );

  /**
   * Renders one flattened item.
   *
   * The 20pt *between* cards is padding on this wrapper rather than an
   * `ItemSeparatorComponent`: FlashList calls one separator component for every
   * boundary, and this gap applies only where one card ends and the next
   * begins. Padding on the cell also guarantees the gap is inside the box
   * FlashList measures, which a margin would not be. The spacing *within* a
   * card is not here at all — it belongs to the segments that draw the card,
   * see `CardShell`.
   *
   * Note what this function does *not* close over: the marking state. The two
   * callbacks it does close over are both stable, so this keeps one identity
   * across a whole mark-watched interaction and FlashList's cell memo can skip
   * every row whose own data has not changed.
   *
   * Memoised explicitly because React Compiler does not compile this component
   * (see `handleMarkWatched`), so this is the only thing keeping the identity
   * stable. `listData` legitimately changes whenever the schedule does, which
   * is exactly when re-rendering every row is the right answer anyway.
   *
   * This stays a plain render function rather than a component: it produces the
   * element FlashList mounts inside a cell, and an extra component layer per
   * row would be a boundary FlashList cannot recycle across.
   */
  const renderRow = useCallback(
    ({ item, index }: { item: ScheduleListItem; index: number }) => (
      <YStack pb={sectionGapAfter(listData, index)}>
        {item.type === "newSeasonHeader" ? (
          <NewSeasonHeader />
        ) : item.type === "newSeasonRow" ? (
          <NewSeasonRow
            item={item.item}
            edge={item.edge}
            onOpen={openDetails}
            onMarkWatched={handleMarkWatched}
          />
        ) : item.type === "readyHeader" ? (
          <ReadyHeader />
        ) : item.type === "readyRow" ? (
          <ReadyRow
            item={item.item}
            edge={item.edge}
            onOpen={openDetails}
            onMarkWatched={handleMarkWatched}
          />
        ) : item.type === "upcomingHeader" ? (
          <UpcomingHeader header={item.header} />
        ) : (
          <UpcomingRow item={item.item} edge={item.edge} onOpen={openDetails} />
        )}
      </YStack>
    ),
    [handleMarkWatched, listData, openDetails],
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
      {/*
        The top safe inset is owned by this container rather than delegated to
        `contentInsetAdjustmentBehavior` on the list below. The
        `ui-safe-area-scroll` rule assumes the scroller is the screen's root
        scroller; this screen deliberately pins the tabs toggle above it, so the
        FlashList can never be a direct child and the inset has to live here.
        See `(tabs)/profile.tsx` for the migrated form, where the ScrollView
        *is* the direct child.
      */}
      <SafeAreaView style={styles.safeArea} edges={["top"]}>
        <YStack
          f={1}
          px="$4"
          gap="$4"
          // The outermost guarantee that a card's outline stays on screen. The
          // cards are already pinned to the width of the list cell they are
          // drawn in (see `ScheduleSections.tsx`), which is this column's width;
          // this clip is what makes "inside the screen" unconditional rather
          // than a property of every card remembering to be `w="100%"`.
          overflow="hidden"
          // Required for the native tab bar's tap-to-scroll-to-top: the docs
          // state that when a screen wraps its ScrollView, the wrapper must opt
          // out of view flattening or the native tab bar cannot find the scroll
          // view to drive.
          collapsable={false}
        >
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
            {backgroundRefreshing ? <Spinner size="small" color="$color" opacity={0.6} /> : null}
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
              renderItem={renderRow}
              keyExtractor={(row) => row.key}
              getItemType={(row) => row.type}
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

/** Vertical gap between two schedule cards. Rows within a card have none. */
const SECTION_GAP = 20;

/**
 * Bottom spacing after the item at `index`: the card gap, or nothing.
 *
 * The boundary is a change of `sectionKey`, not of `type`. A section's rows all
 * share a type, but so do the rows of every other section of that kind, so
 * comparing types would put 20pt after every row.
 *
 * A function of the list rather than a value stored on each item, so
 * `buildScheduleList` stays a pure description of the schedule and the screen
 * owns how it is spaced.
 */
function sectionGapAfter(
  list: ScheduleListItem[],
  index: number,
): number | undefined {
  const next = list[index + 1];
  return !next || next.sectionKey !== list[index].sectionKey
    ? SECTION_GAP
    : undefined;
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
