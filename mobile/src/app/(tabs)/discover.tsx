import { useAuth } from "@/context/AuthContext";
import { useFocusEffect, useRouter } from "expo-router";
import React, { useEffect, useMemo, useState } from "react";
import { SafeAreaView } from "react-native-safe-area-context";
import { Button, ScrollView, Spinner, Text, XStack, YStack } from "tamagui";

import MediaCarousel from "@/components/Discover/MediaCarousel";
import SearchRow from "@/components/Discover/SearchRow";
import EmptyState from "@/components/EmptyState";
import SearchField from "@/components/SearchField";
import { cache } from "@/lib/cache";

import {
  addToWatchlist,
  fetchDiscover,
  fetchWatchlist,
  removeFromWatchlist,
  searchMedia,
  type DiscoverResponse,
  type TMDBMedia,
} from "@/lib/media-api";

export default function DiscoverScreen() {
  const router = useRouter();
  const { token } = useAuth();
  const [data, setData] = useState<DiscoverResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [backgroundRefreshing, setBackgroundRefreshing] = useState(false);
  const [searching, setSearching] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [searchResults, setSearchResults] = useState<TMDBMedia[]>([]);
  const [watchlistIds, setWatchlistIds] = useState<Set<number>>(new Set());

  const hasQuery = searchQuery.trim().length > 0;

  const loadDiscover = React.useCallback(async (forceRefresh = false) => {
    setError(null);
    const cachedData = await cache.get<DiscoverResponse>("discover_data");
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

    try {
      let discover: DiscoverResponse;
      let watchlistIdsArr: number[] = [];

      if (token) {
        const [disc, wl] = await Promise.all([
          fetchDiscover(),
          fetchWatchlist(),
        ]);
        discover = disc;
        watchlistIdsArr = wl.map((item) => item.id);
      } else {
        discover = await fetchDiscover();
      }

      // 2 hours TTL for discover cache
      const TTL_2_HOURS = 2 * 60 * 60 * 1000;
      await cache.set("discover_data", discover, TTL_2_HOURS);
      if (token) {
        await cache.set("discover_watchlist_ids", watchlistIdsArr, TTL_2_HOURS);
      }

      setData(discover);
      setWatchlistIds(new Set(watchlistIdsArr));
      setError(null);
    } catch (err: any) {
      // Only show full screen error if we don't have cached data to show
      if (!cachedData) {
        setError(
          `${err.message || String(err)}. Check your connection and try again.`,
        );
      } else {
        console.warn("Silent discover background revalidation failed:", err);
      }
    } finally {
      setLoading(false);
      setBackgroundRefreshing(false);
    }
  }, [token]);

  useFocusEffect(
    React.useCallback(() => {
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
      try {
        const results = await searchMedia(query, controller.signal);
        setSearchResults(results);
      } catch (err: any) {
        const isAbort =
          err.name === "AbortError" ||
          err.name === "CanceledError" ||
          err.message?.toLowerCase().includes("aborted") ||
          err.message?.toLowerCase().includes("cancel");

        if (!isAbort) {
          setError(err.message || String(err));
        }
      } finally {
        setSearching(false);
      }
    }, 300);

    return () => {
      clearTimeout(timeout);
      controller.abort();
    };
  }, [searchQuery]);

  const toggleWatchlist = async (item: TMDBMedia) => {
    if (!token) {
      router.push("/auth");
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
    await cache.set("discover_watchlist_ids", Array.from(updatedIds));

    try {
      if (exists) {
        await removeFromWatchlist(item.id);
      } else {
        await addToWatchlist(item);
      }
      // Invalidate dependent caches
      await cache.delete("watchlist_items");
      await cache.delete("home_data");
    } catch {
      // Revert on error
      const revertedIds = new Set(watchlistIds);
      setWatchlistIds(revertedIds);
      await cache.set("discover_watchlist_ids", Array.from(revertedIds));
    }
  };

  const openDetails = (item: TMDBMedia) => {
    const type = item.media_type || (item.title ? "movie" : "tv");
    router.push({
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

  return (
    <YStack f={1} bg="$background">
      <SafeAreaView style={{ flex: 1 }} edges={["top"]}>
        <YStack f={1} px="$4">
          <YStack mt="$2" mb="$3">
            <XStack ai="center" jc="space-between">
              <YStack f={1}>
                <XStack ai="center" gap="$2">
                  <Text color="$color" fow="900" fos="$9">
                    Discover
                  </Text>
                  {backgroundRefreshing && (
                    <Spinner size="small" color="$color" opacity={0.6} />
                  )}
                </XStack>
                <Text color="$color" opacity={0.5} fos="$2">
                  Find your next favourite movie or show
                </Text>
              </YStack>
              {!loading && (
                <Button size="$3" circular chromeless onPress={() => loadDiscover(true)}>
                  ↻
                </Button>
              )}
            </XStack>

            <YStack mt="$3">
              <SearchField
                value={searchQuery}
                onChangeText={setSearchQuery}
                placeholder="Search movies and TV shows"
              />
            </YStack>
          </YStack>

          {loading && (
            <YStack f={1} ai="center" jc="center" gap="$3">
              <Spinner size="large" color="$color" />
              <Text color="$color" opacity={0.5} fos="$2">
                Loading media...
              </Text>
            </YStack>
          )}

          {!loading && error && (
            <YStack f={1} ai="center" jc="center" gap="$4">
              <Text color="$red10" fow="600" ta="center" fos="$4">
                {error}
              </Text>
              <Button onPress={() => loadDiscover(true)} size="$4" borderRadius="$4">
                Retry
              </Button>
            </YStack>
          )}

          {!loading && !error && (
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
                    <YStack gap="$3">
                      {uniqueSearchResults.map((item) => (
                        <SearchRow
                          key={`${item.media_type || "media"}-${item.id}`}
                          item={item}
                          added={watchlistIds.has(item.id)}
                          onPress={() => openDetails(item)}
                          onToggle={() => toggleWatchlist(item)}
                        />
                      ))}
                    </YStack>
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
