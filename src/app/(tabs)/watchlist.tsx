import { useFocusEffect, useRouter } from "expo-router";
import { Image } from "expo-image";
import { useCallback, useState, useEffect, useMemo } from "react";
import { SafeAreaView } from "react-native-safe-area-context";
import { Platform } from "react-native";
import { Button, ScrollView, Spinner, Text, XStack, YStack, Input } from "tamagui";
import { useAuth } from "@/context/AuthContext";

import {
  fetchMediaDetails,
  fetchSeasonEpisodes,
  fetchWatchedStatus,
  fetchWatchlist,
  imageUrl,
  mediaTitle,
  type Episode,
  type MediaDetails,
  type TMDBMedia,
} from "@/lib/media-api";

type Tab = "movies" | "tv";
type SortOption = "alphabetical" | "recently_watched" | "recently_added";

export default function WatchlistScreen() {
  const router = useRouter();
  const { token, isLoading: authLoading } = useAuth();
  const [items, setItems] = useState<TMDBMedia[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<Tab>("tv");
  const [searchQuery, setSearchQuery] = useState("");
  const [sortBy, setSortBy] = useState<SortOption>("recently_added");
  const [showSortMenu, setShowSortMenu] = useState(false);

  useEffect(() => {
    if (!authLoading && !token) {
      router.replace("/auth");
    }
  }, [authLoading, token]);

  const loadWatchlist = useCallback(async () => {
    if (!token) return;
    setLoading(true);
    setError(null);
    try {
      setItems(await fetchWatchlist({ filterWatched: true }));
    } catch (err: any) {
      setError(err.message || String(err));
    } finally {
      setLoading(false);
    }
  }, [token]);

  useFocusEffect(
    useCallback(() => {
      if (token) {
        loadWatchlist();
      }
    }, [loadWatchlist, token]),
  );

  const openDetails = (item: TMDBMedia) => {
    const type = item.media_type || (item.title ? "movie" : "tv");
    router.push({
      pathname: "/media/[type]/[id]",
      params: { type, id: String(item.id) },
    } as any);
  };

  const moviesCount = useMemo(() => items.filter(i => (i.media_type || "movie") === "movie").length, [items]);
  const showsCount = useMemo(() => items.filter(i => i.media_type === "tv").length, [items]);

  // 3. Filter and Sort Watchlist items
  const filteredAndSortedItems = useMemo(() => {
    let filtered = items.filter((item) => {
      const type = item.media_type || (item.title ? "movie" : "tv");
      return type === (activeTab === "movies" ? "movie" : "tv");
    });

    if (searchQuery.trim() !== "") {
      const q = searchQuery.toLowerCase();
      filtered = filtered.filter((item) => {
        const title = (item.title || item.name || "").toLowerCase();
        return title.includes(q);
      });
    }

    return [...filtered].sort((a, b) => {
      if (sortBy === "alphabetical") {
        const titleA = (a.title || a.name || "").toLowerCase();
        const titleB = (b.title || b.name || "").toLowerCase();
        return titleA.localeCompare(titleB);
      } else if (sortBy === "recently_watched") {
        const timeA = a.last_watched_at ? new Date(a.last_watched_at).getTime() : 0;
        const timeB = b.last_watched_at ? new Date(b.last_watched_at).getTime() : 0;
        if (timeA !== timeB) {
          return timeB - timeA;
        }
        const addA = a.added_at ? new Date(a.added_at).getTime() : 0;
        const addB = b.added_at ? new Date(b.added_at).getTime() : 0;
        return addB - addA;
      } else if (sortBy === "recently_added") {
        const timeA = a.added_at ? new Date(a.added_at).getTime() : 0;
        const timeB = b.added_at ? new Date(b.added_at).getTime() : 0;
        return timeB - timeA;
      }
      return 0;
    });
  }, [items, activeTab, searchQuery, sortBy]);

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
      <SafeAreaView style={{ flex: 1, paddingTop: Platform.OS === 'web' ? 70 : 0 }} edges={["top"]}>
        <YStack f={1} px="$4" pos="relative">
          {/* Header Row: Text headers and Ellipsis Menu */}
          <XStack mt="$2" mb="$3" ai="center" jc="space-between" pos="relative" zIndex={2000}>
            {/* Side-by-side text-style headers */}
            <XStack gap="$4" ai="flex-end">
              <YStack onPress={() => setActiveTab("tv")} style={{ cursor: "pointer" }}>
                <Text
                  fow={activeTab === "tv" ? "900" : "700"}
                  fos={activeTab === "tv" ? "$8" : "$6"}
                  color="$color"
                  opacity={activeTab === "tv" ? 1 : 0.4}
                >
                  Shows
                </Text>
              </YStack>
              <YStack onPress={() => setActiveTab("movies")} style={{ cursor: "pointer" }}>
                <Text
                  fow={activeTab === "movies" ? "900" : "700"}
                  fos={activeTab === "movies" ? "$8" : "$6"}
                  color="$color"
                  opacity={activeTab === "movies" ? 1 : 0.4}
                >
                  Movies
                </Text>
              </YStack>
            </XStack>

            <XStack gap="$1" ai="center">
              <Button size="$3" circular chromeless onPress={loadWatchlist}>
                ↻
              </Button>
              {/* Sorting Ellipsis Menu Button */}
              <Button
                id="sort-ellipsis-button"
                size="$3"
                circular
                chromeless
                onPress={() => setShowSortMenu(!showSortMenu)}
              >
                <Text fos={18} color="$color" fow="bold" letterSpacing={0.5}>•••</Text>
              </Button>
            </XStack>

            {/* Floating Dropdown Sorting Menu */}
            {showSortMenu && (
              <YStack
                pos="absolute"
                top={44}
                right={0}
                bg="$backgroundElement"
                borderRadius="$4"
                borderWidth={1}
                borderColor="$borderColor"
                p="$2"
                zIndex={3000}
                elevation={5}
                shadowColor="black"
                shadowOffset={{ width: 0, height: 4 }}
                shadowOpacity={0.25}
                shadowRadius={8}
                gap="$1"
                w={180}
              >
                <Text px="$3" py="$1.5" fos="$1" fow="bold" color="$color" opacity={0.4} tt="uppercase">Sort By</Text>
                <Button
                  size="$3"
                  chromeless
                  bg={sortBy === "alphabetical" ? "$background" : "transparent"}
                  onPress={() => { setSortBy("alphabetical"); setShowSortMenu(false); }}
                  ai="center"
                  jc="flex-start"
                  p="$2"
                >
                  <Text color="$color" fow={sortBy === "alphabetical" ? "700" : "400"}>Alphabetically</Text>
                </Button>
                <Button
                  size="$3"
                  chromeless
                  bg={sortBy === "recently_watched" ? "$background" : "transparent"}
                  onPress={() => { setSortBy("recently_watched"); setShowSortMenu(false); }}
                  ai="center"
                  jc="flex-start"
                  p="$2"
                >
                  <Text color="$color" fow={sortBy === "recently_watched" ? "700" : "400"}>Recently Watched</Text>
                </Button>
                <Button
                  size="$3"
                  chromeless
                  bg={sortBy === "recently_added" ? "$background" : "transparent"}
                  onPress={() => { setSortBy("recently_added"); setShowSortMenu(false); }}
                  ai="center"
                  jc="flex-start"
                  p="$2"
                >
                  <Text color="$color" fow={sortBy === "recently_added" ? "700" : "400"}>Recently Added</Text>
                </Button>
              </YStack>
            )}
          </XStack>

          {/* Capsule/Pill style Search Bar */}
          <XStack
            bg="$backgroundElement"
            borderRadius="$10"
            borderWidth={1}
            borderColor="$borderColor"
            px="$3.5"
            ai="center"
            gap="$2"
            h={44}
            mb="$3"
            zIndex={100}
          >
            <Text fos="$4" opacity={0.5}>🔍</Text>
            <Input
              f={1}
              h={38}
              p={0}
              bg="transparent"
              borderWidth={0}
              placeholder={activeTab === "tv" ? "Search your shows" : "Search your movies"}
              placeholderTextColor="$color10"
              value={searchQuery}
              onChangeText={setSearchQuery}
              unstyled
              style={{
                color: "white",
                fontSize: 14,
              }}
            />
            {searchQuery !== "" && (
              <Button
                size="$2"
                circular
                chromeless
                onPress={() => setSearchQuery("")}
                p={0}
                h={24}
                w={24}
              >
                <Text color="$color" opacity={0.5}>✕</Text>
              </Button>
            )}
          </XStack>

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
              <Button onPress={loadWatchlist}>Retry</Button>
            </YStack>
          ) : items.length === 0 ? (
            <YStack f={1} ai="center" jc="center" gap="$2" px="$5">
              <Text fow="800" fos="$6" color="$color" ta="center">
                Your watchlist is empty
              </Text>
              <Text color="$color" opacity={0.55} ta="center">
                Add items from Discover and they will land here.
              </Text>
            </YStack>
          ) : (activeTab === "tv" ? showsCount === 0 : moviesCount === 0) ? (
            <YStack f={1} ai="center" jc="center" gap="$2" px="$5">
              <Text fow="800" fos="$5" color="$color" ta="center">
                No {activeTab === "tv" ? "shows" : "movies"} saved yet
              </Text>
              <Text color="$color" opacity={0.4} ta="center">
                Add {activeTab === "tv" ? "TV shows" : "movies"} from Discover to see them here.
              </Text>
            </YStack>
          ) : filteredAndSortedItems.length === 0 ? (
            <YStack f={1} ai="center" jc="center" gap="$2" px="$5">
              <Text fow="800" fos="$5" color="$color" ta="center">
                No items found
              </Text>
              <Text color="$color" opacity={0.4} ta="center">
                Try searching for something else.
              </Text>
            </YStack>
          ) : (
            <ScrollView
              showsVerticalScrollIndicator={false}
              contentContainerStyle={{ paddingBottom: 120 }}
            >
              {/* 3-Column Poster Grid */}
              <XStack flexWrap="wrap" gap="$3" jc="flex-start" mt="$2">
                {filteredAndSortedItems.map((item) => (
                  activeTab === "tv" ? (
                    <TVShowGridCard key={item.id} show={item} onOpen={openDetails} />
                  ) : (
                    <MovieGridCard key={item.id} movie={item} onOpen={openDetails} />
                  )
                ))}
              </XStack>
            </ScrollView>
          )}
        </YStack>
      </SafeAreaView>
    </YStack>
  );
}

function CircularProgress({ percent }: { percent: number }) {
  const activeColor = percent === 100 ? "#4ade80" : "#a855f7"; // green-400 or purple-500
  const inactiveColor = "rgba(255, 255, 255, 0.25)";

  return (
    <YStack
      pos="absolute"
      bottom={6}
      right={6}
      w={28}
      h={28}
      borderRadius={14}
      borderWidth={2.5}
      borderColor={activeColor}
      borderTopColor={percent >= 25 ? activeColor : inactiveColor}
      borderRightColor={percent >= 50 ? activeColor : inactiveColor}
      borderBottomColor={percent >= 75 ? activeColor : inactiveColor}
      bg="rgba(0,0,0,0.85)"
      ai="center"
      jc="center"
      elevation={3}
      shadowColor="black"
      shadowOffset={{ width: 0, height: 1 }}
      shadowOpacity={0.4}
      shadowRadius={2}
    >
      <Text color="white" fos={8} fow="bold" ta="center">
        {Math.round(percent)}
      </Text>
    </YStack>
  );
}

function TVShowGridCard({
  show,
  onOpen,
}: {
  show: TMDBMedia;
  onOpen: (item: TMDBMedia) => void;
}) {
  const [percentage, setPercentage] = useState<number | null>(null);

  useEffect(() => {
    let active = true;
    const getProgress = async () => {
      try {
        const [watchedStatus, detailsData] = await Promise.all([
          fetchWatchedStatus(show.id, "tv"),
          fetchMediaDetails("tv", show.id),
        ]);
        if (!active) return;

        const watchedEpisodes = watchedStatus.episodes || [];
        const regularWatched = watchedEpisodes.filter(ep => ep.season >= 1).length;

        const regularSeasons = (detailsData.seasons || [])
          .filter((s) => s.season_number >= 1);
        const totalEpisodes = regularSeasons.reduce((sum, s) => sum + s.episode_count, 0);

        if (totalEpisodes > 0) {
          const pct = (regularWatched / totalEpisodes) * 100;
          setPercentage(pct);
        } else {
          setPercentage(0);
        }
      } catch {
        if (active) setPercentage(0);
      }
    };
    getProgress();
    return () => { active = false; };
  }, [show.id]);

  return (
    <YStack
      w="30.5%"
      mb="$3"
      borderRadius="$3"
      overflow="hidden"
      pressStyle={{ opacity: 0.85 }}
      onPress={() => onOpen(show)}
      style={{ cursor: "pointer" }}
    >
      <YStack aspectRatio={2 / 3} bg="$backgroundElement" borderRadius="$3" overflow="hidden" elevation={2} pos="relative">
        {show.poster_path ? (
          <Image
            source={{ uri: imageUrl(show.poster_path) }}
            style={{ width: "100%", height: "100%" }}
            contentFit="cover"
          />
        ) : (
          <YStack f={1} ai="center" jc="center" p="$1">
            <Text color="$color" opacity={0.45} fos="$1" ta="center">
              {mediaTitle(show)}
            </Text>
          </YStack>
        )}

        {percentage !== null && percentage > 0 && (
          <CircularProgress percent={percentage} />
        )}
      </YStack>
      <Text mt="$1.5" color="$color" fow="600" fos="$1" numberOfLines={1} ta="center">
        {mediaTitle(show)}
      </Text>
    </YStack>
  );
}

function MovieGridCard({
  movie,
  onOpen,
}: {
  movie: TMDBMedia;
  onOpen: (item: TMDBMedia) => void;
}) {
  return (
    <YStack
      w="30.5%"
      mb="$3"
      borderRadius="$3"
      overflow="hidden"
      pressStyle={{ opacity: 0.85 }}
      onPress={() => onOpen(movie)}
      style={{ cursor: "pointer" }}
    >
      <YStack aspectRatio={2 / 3} bg="$backgroundElement" borderRadius="$3" overflow="hidden" elevation={2}>
        {movie.poster_path ? (
          <Image
            source={{ uri: imageUrl(movie.poster_path) }}
            style={{ width: "100%", height: "100%" }}
            contentFit="cover"
          />
        ) : (
          <YStack f={1} ai="center" jc="center" p="$1">
            <Text color="$color" opacity={0.45} fos="$1" ta="center">
              {mediaTitle(movie)}
            </Text>
          </YStack>
        )}
      </YStack>
      <Text mt="$1.5" color="$color" fow="600" fos="$1" numberOfLines={1} ta="center">
        {mediaTitle(movie)}
      </Text>
    </YStack>
  );
}
