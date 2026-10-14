import { useAuth } from "@/context/AuthContext";
import { useFocusEffect, useIsFocused, useRouter } from "expo-router";
import React, { useEffect, useMemo, useState } from "react";
import { useWindowDimensions } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Button, ScrollView, Spinner, Text, XStack, YStack, useThemeName } from "tamagui";

import MediaCard from "@/components/Discover/MediaCard";
import MediaCarousel from "@/components/Discover/MediaCarousel";
import EmptyState from "@/components/EmptyState";
import LoadingOrb from "@/components/LoadingOrb";
import SearchField from "@/components/SearchField";
import { BorderBeam } from 'border-beam-native';
import { useDeferredLoading } from "@/hooks/use-deferred-loading";
import { useTypingActivity } from "@/hooks/use-typing-activity";
import { cache, invalidateMediaCaches } from "@/lib/cache";
import { setTelemetryScreen } from "@/lib/telemetry";

import {
  addToWatchlist,
  fetchDiscover,
  fetchWatchlistIds,
  rememberWatchlistIds,
  releaseYear,
  removeFromWatchlist,
  searchMedia,
  type DiscoverResponse,
  type TMDBMedia,
} from "@/lib/media-api";

// Search results reuse the watchlist poster grid: 3 cards per row with the same
// 16pt gutters. The available width is measured with onLayout rather than derived
// from the window, because the `$4` screen padding token resolves to 18pt (not
// 16), which silently pushed the third card onto the next row.
const SEARCH_COLUMNS = 3;
const SEARCH_GRID_GAP = 16;
const SCREEN_PADDING_X = 18;

/**
 * Runs the Discover search and classifies the outcome.
 *
 * Module-level so the `try`/`catch` is not inside the component: React
 * Compiler's `BuildHIR` rejects any function containing a `try` with a
 * `finally` clause, and then skips the ENTIRE component. The abort predicate
 * lives here because it is part of deciding what the outcome *is*; keeping it
 * out of the component also stops the effect's callback from carrying a
 * `finally`.
 *
 * An aborted search is not an error — it means the query changed again before
 * this one answered — so it is reported distinctly rather than as a failure.
 */
type DiscoverSearchOutcome =
  | { status: "results"; results: TMDBMedia[] }
  | { status: "aborted" }
  | { status: "error"; message: string };

const isSearchAbort = (err: any): boolean => {
  const message = String(err?.message ?? "").toLowerCase();
  return (
    err?.name === "AbortError" ||
    err?.name === "CanceledError" ||
    message.includes("aborted") ||
    message.includes("cancel")
  );
};

async function runDiscoverSearch(
  query: string,
  signal: AbortSignal,
): Promise<DiscoverSearchOutcome> {
  try {
    return { status: "results", results: await searchMedia(query, signal) };
  } catch (err: any) {
    if (isSearchAbort(err)) {
      return { status: "aborted" };
    }
    return { status: "error", message: err?.message || String(err) };
  }
}

/**
 * Reads the Discover feed (and, when signed in, the watchlist ids).
 *
 * Same reasoning as `runDiscoverSearch`: the component must not contain a
 * `try`/`finally`. Errors are returned so the caller needs no `try`, and the
 * caller decides whether a failure is worth showing — a background
 * revalidation failure with cached data on screen is not.
 */
type DiscoverFetchOutcome =
  | { status: "ok"; discover: DiscoverResponse; watchlistIds: number[] }
  | { status: "error"; message: string };

async function fetchDiscoverForScreen(
  token: string | null,
): Promise<DiscoverFetchOutcome> {
  try {
    let discover: DiscoverResponse;
    let watchlistIds: number[] = [];

    if (token) {
      // Two independent requests, run together. The watchlist is fetched for
      // its ids only, and `fetchWatchlistIds` answers from cache once any
      // screen has loaded the list — so this is usually one request, not two.
      const [disc, wlIds] = await Promise.all([
        fetchDiscover(),
        fetchWatchlistIds(),
      ]);
      discover = disc;
      watchlistIds = wlIds;
    } else {
      discover = await fetchDiscover();
    }

    return { status: "ok", discover, watchlistIds };
  } catch (err: any) {
    return { status: "error", message: err?.message || String(err) };
  }
}

export default function DiscoverScreen() {
  const { push } = useRouter();
  const { token } = useAuth();
  const { width } = useWindowDimensions();
  const [data, setData] = useState<DiscoverResponse | null>(null);
  /**
   * Starts false, not true.
   *
   * The tab navigator mounts every tab at launch, so an initial `true` claimed
   * a load that had not started on screens the user had never opened — and the
   * orb, which is gated on this flag, animated from startup on all of them.
   * The flag is now claimed by the focus effect below, which is where the load
   * actually begins; a slow load still shows the orb, and the branches under
   * the orb account for the debounce window that opens up as a result.
   */
  const [loading, setLoading] = useState(false);
  const [backgroundRefreshing, setBackgroundRefreshing] = useState(false);
  const [searching, setSearching] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [searchResults, setSearchResults] = useState<TMDBMedia[]>([]);
  const [watchlistIds, setWatchlistIds] = useState<Set<number>>(new Set());
  const isLight = useThemeName() === "light";

  // Drives the search field's beam: lit while typing and while the request the
  // typing triggered is still in flight, dark otherwise. `searching` is only
  // true between the 300ms debounce firing and the response landing, so the
  // beam covers the whole search without any extra state.
  const { typing, markTyping, stopTyping } = useTypingActivity();

  // The tab stays mounted after the user leaves it, and the beam's clock is a
  // real per-frame loop, so it has to be told when the screen is off-screen.
  // Same signal `LoadingOrb` uses for the same reason.
  const isFocused = useIsFocused();

  // What the screen should render, rather than raw `loading`: the orb is held
  // back for 150ms so a cached payload never flashes it for two frames, and
  // held for at least 500ms once shown so it cannot blink.
  const showLoadingUI = useDeferredLoading(loading);

  const hasQuery = searchQuery.trim().length > 0;

  const loadDiscover = React.useCallback(async (forceRefresh = false) => {
    setError(null);
    const cachedData = await cache.get<DiscoverResponse>("public_discover_data");
    const cachedWatchlistIds = await cache.get<number[]>("discover_watchlist_ids");

    if (cachedData) {
      setData(cachedData);
      if (cachedWatchlistIds) {
        setWatchlistIds(new Set(cachedWatchlistIds));
      }
      setLoading(false);
      setBackgroundRefreshing(true);
    } else {
      setLoading(true);
    }

    // No try/finally in the component: see `fetchDiscoverForScreen`.
    const outcome = await fetchDiscoverForScreen(token);

    if (outcome.status === "ok") {
      // 2 hours TTL for discover cache
      const TTL_2_HOURS = 2 * 60 * 60 * 1000;
      await cache.set("public_discover_data", outcome.discover, TTL_2_HOURS);
      if (token) {
        await cache.set(
          "discover_watchlist_ids",
          outcome.watchlistIds,
          TTL_2_HOURS,
        );
      }

      setData(outcome.discover);
      setWatchlistIds(new Set(outcome.watchlistIds));
      setError(null);
    } else if (!cachedData) {
      // Only worth surfacing when there is nothing on screen to keep showing.
      setError(`${outcome.message}. Check your connection and try again.`);
    } else {
      console.warn(
        "Silent discover background revalidation failed:",
        outcome.message,
      );
    }

    setLoading(false);
    setBackgroundRefreshing(false);
  }, [token]);

  useFocusEffect(
    React.useCallback(() => {
      setTelemetryScreen("discover");
      // Claim the load here, synchronously, so the orb's 150ms debounce starts
      // when the user actually reaches the tab rather than after the cache
      // read resolves. A genuinely slow load still shows the orb; the cache
      // read below releases the flag as soon as it produces something to draw.
      setLoading(true);
      loadDiscover(false);
    }, [loadDiscover]),
  );

  useEffect(() => {
    const query = searchQuery.trim();
    if (!query) {
      setTimeout(() => {
        setSearchResults([]);
        setSearching(false);
      }, 0);
      return;
    }

    const controller = new AbortController();
    const timeout = setTimeout(async () => {
      setSearching(true);

      const outcome = await runDiscoverSearch(query, controller.signal);

      if (outcome.status === "results") {
        setSearchResults(outcome.results);
      } else if (outcome.status === "error") {
        setError(outcome.message);
      }
      // An aborted search is silent by design: the query changed again, so this
      // answer was already superseded.

      setSearching(false);
    }, 300);

    return () => {
      clearTimeout(timeout);
      controller.abort();
    };
  }, [searchQuery]);

  const toggleWatchlist = async (item: TMDBMedia) => {
    if (!token) {
      push("/auth");
      return;
    }
    const exists = watchlistIds.has(item.id);
    const updatedIds = new Set(watchlistIds);
    if (exists) {
      updatedIds.delete(item.id);
    } else {
      updatedIds.add(item.id);
    }
    setWatchlistIds(updatedIds);
    await rememberWatchlistIds(Array.from(updatedIds));

    try {
      if (exists) {
        await removeFromWatchlist(item.id);
      } else {
        await addToWatchlist(item);
      }
      // Invalidate dependent caches (Home schedule, Watchlist, Discover badges).
      await invalidateMediaCaches();
      // The invalidation clears the derived id set too; restore the
      // already-updated one so badge state stays correct for this session
      // without another request.
      await rememberWatchlistIds(Array.from(updatedIds));
    } catch {
      // Revert on error
      const revertedIds = new Set(watchlistIds);
      setWatchlistIds(revertedIds);
      await rememberWatchlistIds(Array.from(revertedIds));
    }
  };

  const openDetails = (item: TMDBMedia) => {
    const type = item.media_type || (item.title ? "movie" : "tv");
    push({
      pathname: "/media/[type]/[id]",
      params: { type, id: String(item.id) },
    } as any);
  };

  const uniqueSearchResults = useMemo(() => {
    const seen = new Set<number>();
    return searchResults.filter((item) => {
      if (seen.has(item.id)) {
        return false;
      }
      seen.add(item.id);
      return true;
    });
  }, [searchResults]);

  // Measured width of the results grid; falls back to the window minus the
  // screen padding for the first frame.
  const [searchGridWidth, setSearchGridWidth] = useState(0);

  // Exactly SEARCH_COLUMNS cards per row, sized like the watchlist posters.
  const searchCardWidth = useMemo(() => {
    const available = searchGridWidth || width - SCREEN_PADDING_X * 2;
    const raw = Math.floor(
      (available - SEARCH_GRID_GAP * (SEARCH_COLUMNS - 1)) / SEARCH_COLUMNS,
    );
    return Math.max(1, Math.min(180, raw));
  }, [searchGridWidth, width]);

  const searchSubtitle = (item: TMDBMedia) => {
    const year = releaseYear(item);
    const type = (item.media_type || "media").toUpperCase();
    return year ? `${type} · ${year}` : type;
  };

  return (
    <YStack f={1} bg="$background">
      {/*
        The top safe inset is owned by this container rather than delegated to
        `contentInsetAdjustmentBehavior` on the ScrollView below. The
        `ui-safe-area-scroll` rule assumes the scroller is the screen's root
        scroller; this screen deliberately pins the title and search field above
        it, so the ScrollView can never be a direct child. See
        `(tabs)/profile.tsx` for the migrated form.
      */}
      <SafeAreaView style={{ flex: 1 }} edges={["top"]}>
        <YStack
          f={1}
          px="$4"
          // Required for the native tab bar's tap-to-scroll-to-top; see the
          // native tabs guide on wrapping a ScrollView.
          collapsable={false}
        >
          <YStack mt="$2" mb="$3">
            <XStack ai="center" jc="space-between">
              <YStack f={1}>
                <XStack ai="center" gap="$2">
                  <Text color="$color" fow="900" fos="$9">
                    Discover
                  </Text>
                  {backgroundRefreshing ? <Spinner size="small" color="$color" opacity={0.6} /> : null}
                </XStack>
                <Text color="$color" opacity={0.5} fos="$2">
                  Find your next favourite movie or show
                </Text>
              </YStack>
            </XStack>

            <YStack mt="$3">
              <BorderBeam
                theme={isLight ? "light" : "dark"}
                borderRadius={25}
                active={typing || searching}
                visible={isFocused}
              >
                <SearchField
                  value={searchQuery}
                  onChangeText={(value) => {
                    setSearchQuery(value);
                    if (value.trim()) {
                      markTyping();
                    } else {
                      stopTyping();
                    }
                  }}
                  placeholder="Search movies and TV shows"
                />
              </BorderBeam>
            </YStack>
          </YStack>

          {/*
            All three branches below gate on `showLoadingUI`, not `loading`:
            while the deferred flag is down they must agree, or the error or
            content branch would paint underneath the orb.

            The content branch also requires `!loading`, because the deferred
            flag is down for the first 150ms of every load. Without it, the
            three carousels would paint empty for that window on a tab whose
            first load had not finished — a flash of "nothing to show" that the
            screen never used to produce, when `loading` was true from launch.
          */}
          {showLoadingUI ? <LoadingOrb label="Loading media..." /> : null}

          {!showLoadingUI && error ? <YStack f={1} ai="center" jc="center" gap="$4">
              <Text color="$red10" fow="600" ta="center" fos="$4">
                {error}
              </Text>
              <Button onPress={() => loadDiscover(true)} size="$4" borderRadius="$4">
                Retry
              </Button>
            </YStack> : null}

          {!showLoadingUI && !loading && !error && (
            /**
             * A plain vertical ScrollView, deliberately.
             *
             * Both modes here are bounded, so virtualizing the page itself would
             * buy nothing: browsing renders exactly three carousels, and search
             * renders at most the ~20 results TMDB returns. The unbounded cost
             * on this screen was the carousels mounting every card at once,
             * which each `MediaCarousel` now avoids by recycling horizontally.
             *
             * This also keeps exactly one vertical scroll owner, which is what
             * matters: a vertical list nested in a vertical ScrollView would
             * break both.
             */
            <ScrollView
              showsVerticalScrollIndicator={false}
              contentContainerStyle={{ paddingBottom: 120, gap: 28 }}
            >
              {hasQuery ? (
                <YStack gap="$3">
                  <XStack ai="center" jc="space-between">
                    <Text color="$color" fow="700" fos="$6">
                      Search Results
                    </Text>
                    <Text color="$color" opacity={0.45} fos="$1">
                      {searching
                        ? "Searching"
                        : `${uniqueSearchResults.length} items`}
                    </Text>
                  </XStack>

                  {searching && uniqueSearchResults.length === 0 ? (
                    <YStack py="$6" ai="center" gap="$2">
                      <Spinner color="$color" />
                      <Text color="$color" opacity={0.5}>
                        Searching...
                      </Text>
                    </YStack>
                  ) : uniqueSearchResults.length === 0 ? (
                    <EmptyState text={`No results for "${searchQuery}"`} />
                  ) : (
                    <XStack
                      w="100%"
                      flexWrap="wrap"
                      gap={SEARCH_GRID_GAP}
                      ai="flex-start"
                      onLayout={(event) => {
                        const measured = Math.round(
                          event.nativeEvent.layout.width,
                        );
                        setSearchGridWidth((current) =>
                          current === measured ? current : measured,
                        );
                      }}
                    >
                      {uniqueSearchResults.map((item) => (
                        <MediaCard
                          key={`${item.media_type || "media"}-${item.id}`}
                          item={item}
                          width={searchCardWidth}
                          subtitle={searchSubtitle(item)}
                          added={watchlistIds.has(item.id)}
                          onPress={() => openDetails(item)}
                          onToggle={() => toggleWatchlist(item)}
                        />
                      ))}
                    </XStack>
                  )}
                </YStack>
              ) : (
                <>
                  <MediaCarousel
                    title="Trending Today"
                    items={data?.trending ?? []}
                    watchlistIds={watchlistIds}
                    onOpen={openDetails}
                    onToggle={toggleWatchlist}
                  />
                  <MediaCarousel
                    title="Popular Movies"
                    items={data?.popular ?? []}
                    wide
                    watchlistIds={watchlistIds}
                    onOpen={openDetails}
                    onToggle={toggleWatchlist}
                  />
                  <MediaCarousel
                    title="Popular Series"
                    items={data?.popular_series ?? []}
                    wide
                    watchlistIds={watchlistIds}
                    onOpen={openDetails}
                    onToggle={toggleWatchlist}
                  />
                </>
              )}
            </ScrollView>
          )}
        </YStack>
      </SafeAreaView>
    </YStack>
  );
}
