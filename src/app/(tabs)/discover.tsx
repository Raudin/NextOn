import { useAuth } from "@/context/AuthContext";
import { useFocusEffect, useRouter } from "expo-router";
import React, { useEffect, useMemo, useState } from "react";
import { SafeAreaView } from "react-native-safe-area-context";
import { Button, ScrollView, Spinner, Text, XStack, YStack } from "tamagui";

import MediaCarousel from "@/components/Discover/MediaCarousel";
import SearchRow from "@/components/Discover/SearchRow";
import EmptyState from "@/components/EmptyState";
import SearchField from "@/components/SearchField";

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
  const [searching, setSearching] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [searchResults, setSearchResults] = useState<TMDBMedia[]>([]);
  const [watchlistIds, setWatchlistIds] = useState<Set<number>>(new Set());

  const hasQuery = searchQuery.trim().length > 0;

  const loadDiscover = React.useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      if (token) {
        const [discover, watchlist] = await Promise.all([
          fetchDiscover(),
          fetchWatchlist(),
        ]);
        setData(discover);
        setWatchlistIds(new Set(watchlist.map((item) => item.id)));
      } else {
        const discover = await fetchDiscover();
        setData(discover);
        setWatchlistIds(new Set());
      }
    } catch (err: any) {
      setError(
        `${err.message || String(err)}. Make sure the Go server is running on port 8080.`,
      );
    } finally {
      setLoading(false);
    }
  }, [token]);

  useFocusEffect(
    React.useCallback(() => {
      loadDiscover();
    }, [loadDiscover]),
  );

  useEffect(() => {
    const query = searchQuery.trim();
    if (!query) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setSearchResults([]);

      setSearching(false);
      return;
    }

    const controller = new AbortController();
    const timeout = setTimeout(async () => {
      setSearching(true);
      try {
        const results = await searchMedia(query, controller.signal);
        setSearchResults(results);
      } catch (err: any) {
        if (err.name !== "AbortError") {
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
    setWatchlistIds((current) => {
      const next = new Set(current);
      if (exists) {
        next.delete(item.id);
      } else {
        next.add(item.id);
      }
      return next;
    });

    try {
      if (exists) {
        await removeFromWatchlist(item.id);
      } else {
        await addToWatchlist(item);
      }
    } catch {
      setWatchlistIds((current) => {
        const next = new Set(current);
        if (exists) {
          next.add(item.id);
        } else {
          next.delete(item.id);
        }
        return next;
      });
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
                <Text color="$color" fow="900" fos="$9">
                  Discover
                </Text>
                <Text color="$color" opacity={0.5} fos="$2">
                  Find your next favourite movie or show
                </Text>
              </YStack>
              {!loading && (
                <Button size="$3" circular chromeless onPress={loadDiscover}>
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
              <Button onPress={loadDiscover} size="$4" borderRadius="$4">
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
                          key={`${item.media_type}-${item.id}`}
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
                </>
              )}
            </ScrollView>
          )}
        </YStack>
      </SafeAreaView>
    </YStack>
  );
}
