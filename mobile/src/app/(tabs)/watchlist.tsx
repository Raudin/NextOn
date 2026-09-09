import { useAuth } from "@/context/AuthContext";
import { useFocusEffect, useRouter } from "expo-router";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useWindowDimensions } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Button, ScrollView, Spinner, Text, XStack, YStack } from "tamagui";

import SearchField from "@/components/SearchField";
import WatchlistMenu, {
  type WatchlistLayoutMode,
  type WatchlistSortMode,
} from "@/components/Watchlist/WatchlistMenu";
import WatchlistPosterCard from "@/components/Watchlist/WatchlistPosterCard";
import WatchlistRow from "@/components/Watchlist/WatchlistRow";
import WatchlistTabs, {
  type WatchlistTab,
} from "@/components/Watchlist/WatchlistTabs";
import { cache } from "@/lib/cache";

import {
  fetchMediaDetails,
  fetchWatchedStatus,
  fetchWatchlist,
  mediaTitle,
  releaseYear,
  type TMDBMedia,
} from "@/lib/media-api";

// Revalidation throttle: re-fetching the full watchlist on every screen focus
// (which triggers expensive server-side "fully watched" filtering) hammered the
// backend. Within this window the cached list is shown as-is and the network
// revalidation is skipped.
const WATCHLIST_REVALIDATE_INTERVAL_MS = 5 * 60 * 1000;
let lastWatchlistFetchAt = 0;

interface ShowProgress {
  watchedEpisodes: number;
  totalEpisodes: number;
  progress: number;
}

export default function WatchlistScreen() {
  const router = useRouter();
  const { width } = useWindowDimensions();
  const { token, isLoading: authLoading } = useAuth();
  const [items, setItems] = useState<TMDBMedia[]>([]);
  const [loading, setLoading] = useState(true);
  const [backgroundRefreshing, setBackgroundRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<WatchlistTab>("tv");
  const [searchQuery, setSearchQuery] = useState("");
  const [menuOpen, setMenuOpen] = useState(false);
  const [layoutMode, setLayoutMode] = useState<WatchlistLayoutMode>("posters");
  const [sortMode, setSortMode] = useState<WatchlistSortMode>("recent");
  const [showProgress, setShowProgress] = useState<
    Record<number, ShowProgress>
  >({});

  useEffect(() => {
    if (!authLoading && !token) {
      router.replace("/auth");
    }
  }, [authLoading, router, token]);

  const loadWatchlist = useCallback(async (forceRefresh = false) => {
    if (!token) return;
    setError(null);

    const cachedItems = await cache.get<TMDBMedia[]>("watchlist_items");
    const cachedProgress = await cache.get<Record<number, ShowProgress>>("watchlist_show_progress");

    if (cachedItems) {
      setItems(cachedItems);
      if (cachedProgress) {
        setShowProgress(cachedProgress);
      }
      setLoading(false);

      const isStale =
        Date.now() - lastWatchlistFetchAt >= WATCHLIST_REVALIDATE_INTERVAL_MS;
      if (!forceRefresh && !isStale) {
        // Cache is fresh: skip the network revalidation entirely.
        setBackgroundRefreshing(false);
        return;
      }
      setBackgroundRefreshing(true);
    } else {
      setLoading(true);
    }

    try {
      const fetchedItems = await fetchWatchlist({ filterWatched: true });
      await cache.set("watchlist_items", fetchedItems);
      lastWatchlistFetchAt = Date.now();
      setItems(fetchedItems);
      setError(null);
    } catch (err: any) {
      if (!cachedItems) {
        setError(err.message || String(err));
      } else {
        console.warn("Silent watchlist background revalidation failed:", err);
      }
    } finally {
      setLoading(false);
      setBackgroundRefreshing(false);
    }
  }, [token]);

  useFocusEffect(
    useCallback(() => {
      if (token) {
        loadWatchlist(false);
      }
    }, [loadWatchlist, token]),
  );

  const openDetails = useCallback(
    (item: TMDBMedia) => {
      const type = item.media_type || (item.title ? "movie" : "tv");
      router.push({
        pathname: "/media/[type]/[id]",
        params: { type, id: String(item.id) },
      } as any);
    },
    [router],
  );

  const movies = useMemo(
    () => items.filter((item) => (item.media_type || "movie") === "movie"),
    [items],
  );
  const shows = useMemo(
    () => items.filter((item) => item.media_type === "tv"),
    [items],
  );
  const gridGap = 16;
  const posterWidth = Math.max(
    96,
    Math.min(180, Math.floor((width - 32 - gridGap * 2) / 3)),
  );

  useEffect(() => {
    let cancelled = false;

    const loadShowProgress = async () => {
      if (shows.length === 0) {
        setShowProgress({});
        return;
      }

      const entries = await Promise.allSettled(
        shows.map(async (show) => {
          const [watchedStatus, details] = await Promise.all([
            fetchWatchedStatus(show.id, "tv"),
            fetchMediaDetails("tv", show.id),
          ]);

          const watchedEpisodes = watchedStatus.episodes?.length || 0;
          const totalEpisodes = (details.seasons || [])
            .filter((season) => season.season_number >= 1)
            .reduce((sum, season) => sum + season.episode_count, 0);

          const progress =
            totalEpisodes > 0 ? watchedEpisodes / totalEpisodes : 0;

          return [
            show.id,
            { watchedEpisodes, totalEpisodes, progress },
          ] as const;
        }),
      );

      if (cancelled) {
        return;
      }

      const nextProgress: Record<number, ShowProgress> = {};
      for (const entry of entries) {
        if (entry.status === "fulfilled") {
          const [id, value] = entry.value;
          nextProgress[id] = value;
        }
      }

      await cache.set("watchlist_show_progress", nextProgress);
      setShowProgress(nextProgress);
    };

    loadShowProgress();

    return () => {
      cancelled = true;
    };
  }, [shows]);

  const filteredItems = useMemo(() => {
    const baseItems = activeTab === "movies" ? movies : shows;
    const query = searchQuery.trim().toLowerCase();

    const nextItems = query
      ? baseItems.filter((item) =>
          mediaTitle(item).toLowerCase().includes(query),
        )
      : [...baseItems];

    nextItems.sort((left, right) => {
      if (sortMode === "alphabetical") {
        return mediaTitle(left).localeCompare(mediaTitle(right));
      }

      const leftTime = left.created_at
        ? new Date(left.created_at).getTime()
        : 0;
      const rightTime = right.created_at
        ? new Date(right.created_at).getTime()
        : 0;

      if (leftTime !== rightTime) {
        return rightTime - leftTime;
      }

      return mediaTitle(left).localeCompare(mediaTitle(right));
    });

    return nextItems;
  }, [activeTab, movies, searchQuery, shows, sortMode]);

  const handleItemPress = useCallback(
    (item: TMDBMedia) => {
      openDetails(item);
    },
    [openDetails],
  );

  const sectionTitle = searchQuery.trim()
    ? `Results for "${searchQuery.trim()}"`
    : "Ready to Watch";
  const sectionMeta = `${filteredItems.length} items`;

  if (authLoading) {
    return (
      <YStack f={1} ai="center" jc="center" bg="$background">
        <Spinner size="large" color="$color" />
      </YStack>
    );
  }

  if (!token) {
    return null;
  }

  return (
    <YStack f={1} bg="$background">
      <SafeAreaView style={{ flex: 1 }} edges={["top"]}>
        <YStack f={1} px="$4" position="relative">
          <XStack mt="$2" ai="center" jc="space-between">
            <XStack ai="center" gap="$2">
              <WatchlistTabs activeTab={activeTab} onChange={setActiveTab} />
              {backgroundRefreshing && (
                <Spinner size="small" color="$color" opacity={0.6} />
              )}
            </XStack>
            <XStack gap="$2" ai="center">
              <Button
                size="$3"
                circular
                bg="$backgroundElement"
                borderWidth={1}
                borderColor="rgba(255,255,255,0.06)"
                onPress={() => loadWatchlist(true)}
              >
                ↻
              </Button>
              <Button
                size="$3"
                circular
                bg="$backgroundElement"
                borderWidth={1}
                borderColor="rgba(255,255,255,0.06)"
                onPress={() => setMenuOpen((current) => !current)}
              >
                ...
              </Button>
            </XStack>
          </XStack>

          <YStack mt="$3" mb="$4">
            <SearchField
              value={searchQuery}
              onChangeText={setSearchQuery}
              placeholder={`Search your ${activeTab === "tv" ? "shows" : "movies"}`}
            />
          </YStack>

          <WatchlistMenu
            visible={menuOpen}
            layoutMode={layoutMode}
            sortMode={sortMode}
            onClose={() => setMenuOpen(false)}
            onLayoutChange={setLayoutMode}
            onSortChange={setSortMode}
          />

          {loading ? (
            <YStack f={1} ai="center" jc="center" gap="$3">
              <Spinner size="large" color="$color" />
              <Text color="$color" opacity={0.5}>
                Loading watchlist...
              </Text>
            </YStack>
          ) : error ? (
            <YStack f={1} ai="center" jc="center" gap="$4">
              <Text color="$red10" ta="center" fow="700">
                {error}
              </Text>
              <Button onPress={() => loadWatchlist(true)}>Retry</Button>
            </YStack>
          ) : items.length === 0 ? (
            <YStack f={1} ai="center" jc="center" gap="$2" px="$5">
              <Text fow="800" fos="$6" color="$color" ta="center">
                Your watchlist is empty
              </Text>
              <Text color="$color" opacity={0.55} ta="center">
                Add movies and TV shows from Discover and they will land here.
              </Text>
            </YStack>
          ) : (
            <ScrollView
              showsVerticalScrollIndicator={false}
              contentContainerStyle={{ paddingBottom: 120 }}
            >
              <YStack gap="$3">
                <XStack ai="center" jc="space-between">
                  <Text color="$color" fow="900" fos="$8">
                    {sectionTitle}
                  </Text>
                  <Text color="$color" opacity={0.45} fos="$2">
                    {sectionMeta}
                  </Text>
                </XStack>

                {filteredItems.length === 0 ? (
                  <YStack py="$8">
                    <Text color="$color" opacity={0.55} ta="center">
                      {searchQuery.trim()
                        ? "No saved titles match that search."
                        : `No ${activeTab === "tv" ? "shows" : "movies"} saved yet.`}
                    </Text>
                  </YStack>
                ) : layoutMode === "posters" ? (
                  <XStack flexWrap="wrap" gap="$3">
                    {filteredItems.map((item) => {
                      const progress =
                        item.media_type === "tv"
                          ? showProgress[item.id]?.progress
                          : undefined;
                      const subtitle =
                        item.media_type === "tv"
                          ? showProgress[item.id]?.totalEpisodes
                            ? `${showProgress[item.id].watchedEpisodes}/${showProgress[item.id].totalEpisodes} episodes`
                            : "Tracking progress"
                          : releaseYear(item) || "Movie";

                      return (
                        <WatchlistPosterCard
                          key={`${item.media_type || "media"}-${item.id}`}
                          item={item}
                          width={posterWidth}
                          subtitle={subtitle}
                          progress={progress}
                          selected={false}
                          selectionMode={false}
                          onPress={() => handleItemPress(item)}
                        />
                      );
                    })}
                  </XStack>
                ) : (
                  <YStack gap="$3">
                    {filteredItems.map((item) => {
                      const progress =
                        item.media_type === "tv"
                          ? showProgress[item.id]?.progress
                          : undefined;
                      const subtitle =
                        item.media_type === "tv"
                          ? showProgress[item.id]?.totalEpisodes
                            ? `${showProgress[item.id].watchedEpisodes}/${showProgress[item.id].totalEpisodes} episodes watched`
                            : "Tracking watch progress"
                          : releaseYear(item) || "Saved movie";

                      return (
                        <WatchlistRow
                          key={`${item.media_type || "media"}-${item.id}`}
                          item={item}
                          subtitle={subtitle}
                          progress={progress}
                          selected={false}
                          selectionMode={false}
                          onOpen={() => handleItemPress(item)}
                        />
                      );
                    })}
                  </YStack>
                )}
              </YStack>
            </ScrollView>
          )}
        </YStack>
      </SafeAreaView>
    </YStack>
  );
}
