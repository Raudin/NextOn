import { useRouter } from "expo-router";
import { Image } from "expo-image";
import { useEffect, useMemo, useState } from "react";
import { SafeAreaView } from "react-native-safe-area-context";
import {
  Button,
  Input,
  ScrollView,
  Spinner,
  Text,
  XStack,
  YStack,
} from "tamagui";
import { useAuth } from "@/context/AuthContext";

import {
  addToWatchlist,
  fetchDiscover,
  fetchWatchlist,
  imageUrl,
  mediaTitle,
  releaseYear,
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

  const loadDiscover = async () => {
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
  };

  useEffect(() => {
    loadDiscover();
  }, [token]);

  useEffect(() => {
    const query = searchQuery.trim();
    if (!query) {
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
    } catch (err) {
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

            <XStack
              mt="$3"
              ai="center"
              bg="$backgroundElement"
              borderRadius="$5"
              px="$3"
              borderWidth={1}
              borderColor="$borderColor"
            >
              <Text fos="$3" color="$color" opacity={0.5} mr="$2">
                Search
              </Text>
              <Input
                unstyled
                f={1}
                py="$3"
                color="$color"
                placeholder="Search movies and TV shows"
                placeholderTextColor="$color10"
                value={searchQuery}
                onChangeText={setSearchQuery}
                keyboardAppearance="dark"
              />
            </XStack>
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
                      {searching ? "Searching" : `${uniqueSearchResults.length} items`}
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

function MediaCarousel({
  title,
  items,
  wide,
  watchlistIds,
  onOpen,
  onToggle,
}: {
  title: string;
  items: TMDBMedia[];
  wide?: boolean;
  watchlistIds: Set<number>;
  onOpen: (item: TMDBMedia) => void;
  onToggle: (item: TMDBMedia) => void;
}) {
  return (
    <YStack gap="$3">
      <XStack ai="center" jc="space-between">
        <Text color="$color" fow="700" fos="$6">
          {title}
        </Text>
        <Text color="$color" opacity={0.4} fos="$1">
          {items.length} items
        </Text>
      </XStack>

      {items.length === 0 ? (
        <EmptyState text="Nothing to show yet" />
      ) : (
        <ScrollView horizontal showsHorizontalScrollIndicator={false}>
          <XStack gap="$3">
            {items.map((item) => (
              <MediaCard
                key={`${title}-${item.id}`}
                item={item}
                wide={wide}
                added={watchlistIds.has(item.id)}
                onPress={() => onOpen(item)}
                onToggle={() => onToggle(item)}
              />
            ))}
          </XStack>
        </ScrollView>
      )}
    </YStack>
  );
}

function MediaCard({
  item,
  wide,
  added,
  onPress,
  onToggle,
}: {
  item: TMDBMedia;
  wide?: boolean;
  added: boolean;
  onPress: () => void;
  onToggle: () => void;
}) {
  const width = wide ? 260 : 130;
  const height = wide ? 146 : 195;
  const artPath = wide ? item.backdrop_path || item.poster_path : item.poster_path;

  return (
    <YStack w={width} gap="$2" pressStyle={{ opacity: 0.85, scale: 0.98 }} onPress={onPress}>
      <YStack
        w={width}
        h={height}
        borderRadius="$4"
        overflow="hidden"
        bg="$backgroundElement"
        borderWidth={1}
        borderColor="$borderColor"
      >
        {artPath ? (
          <Image
            source={{ uri: imageUrl(artPath) }}
            style={{ width: "100%", height: "100%" }}
            contentFit="cover"
            transition={250}
          />
        ) : (
          <YStack f={1} ai="center" jc="center">
            <Text fos="$7">Film</Text>
          </YStack>
        )}

        <RatingBadge rating={item.vote_average} />
        <WatchlistButton added={added} onPress={onToggle} />
      </YStack>

      <Text fontFamily="$body" fos="$2" fow="700" color="$color" numberOfLines={1}>
        {mediaTitle(item)}
      </Text>
      {releaseYear(item) !== "" && (
        <Text color="$color" opacity={0.5} fos="$1" mt={-6}>
          {releaseYear(item)}
        </Text>
      )}
    </YStack>
  );
}

function SearchRow({
  item,
  added,
  onPress,
  onToggle,
}: {
  item: TMDBMedia;
  added: boolean;
  onPress: () => void;
  onToggle: () => void;
}) {
  return (
    <XStack
      gap="$3"
      p="$2"
      borderRadius="$4"
      bg="$backgroundElement"
      borderWidth={1}
      borderColor="$borderColor"
      pressStyle={{ opacity: 0.88 }}
      onPress={onPress}
    >
      <YStack w={76} h={112} borderRadius="$3" overflow="hidden" bg="$background">
        {item.poster_path ? (
          <Image
            source={{ uri: imageUrl(item.poster_path) }}
            style={{ width: "100%", height: "100%" }}
            contentFit="cover"
          />
        ) : (
          <YStack f={1} ai="center" jc="center">
            <Text fos="$2">No art</Text>
          </YStack>
        )}
      </YStack>
      <YStack f={1} jc="space-between" py="$1">
        <YStack gap="$1">
          <Text color="$color" fow="800" fos="$4" numberOfLines={2}>
            {mediaTitle(item)}
          </Text>
          <Text color="$color" opacity={0.5} fos="$2" tt="uppercase">
            {item.media_type || "media"} {releaseYear(item)}
          </Text>
        </YStack>
        <XStack ai="center" jc="space-between">
          <RatingPill rating={item.vote_average} />
          <WatchlistButton added={added} onPress={onToggle} />
        </XStack>
      </YStack>
    </XStack>
  );
}

function WatchlistButton({ added, onPress }: { added: boolean; onPress: () => void }) {
  return (
    <Button
      pos="absolute"
      bottom="$2"
      right="$2"
      size="$2.5"
      circular
      bg={added ? "$purple9" : "rgba(0,0,0,0.72)"}
      color="white"
      borderWidth={1}
      borderColor={added ? "$purple7" : "rgba(255,255,255,0.2)"}
      onPress={(event: any) => {
        event?.stopPropagation?.();
        onPress();
      }}
    >
      {added ? "✓" : "+"}
    </Button>
  );
}

function RatingBadge({ rating }: { rating: number }) {
  return (
    <XStack
      pos="absolute"
      top="$1.5"
      right="$1.5"
      bg="rgba(0,0,0,0.72)"
      px="$1.5"
      py="$0.5"
      borderRadius="$2"
      ai="center"
      gap="$1"
    >
      <Text fos="$1" color="#FFD700">
        ★
      </Text>
      <Text color="white" fos="$1" fow="bold">
        {rating.toFixed(1)}
      </Text>
    </XStack>
  );
}

function RatingPill({ rating }: { rating: number }) {
  return (
    <XStack bg="$background" px="$2" py="$1" borderRadius="$3" ai="center" gap="$1">
      <Text fos="$1" color="#B88900">
        ★
      </Text>
      <Text color="$color" fos="$1" fow="800">
        {rating.toFixed(1)}
      </Text>
    </XStack>
  );
}

function EmptyState({ text }: { text: string }) {
  return (
    <YStack py="$5" ai="center" bg="$backgroundElement" borderRadius="$4">
      <Text color="$color" opacity={0.5} fos="$2">
        {text}
      </Text>
    </YStack>
  );
}
