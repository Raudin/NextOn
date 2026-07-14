import { useFocusEffect, useRouter } from "expo-router";
import { Image } from "expo-image";
import { useCallback, useState } from "react";
import { SafeAreaView } from "react-native-safe-area-context";
import { Button, ScrollView, Spinner, Text, XStack, YStack } from "tamagui";

import {
  fetchWatchlist,
  imageUrl,
  mediaTitle,
  releaseYear,
  removeFromWatchlist,
  type TMDBMedia,
} from "@/lib/media-api";

type Tab = "movies" | "tv";

export default function WatchlistScreen() {
  const router = useRouter();
  const [items, setItems] = useState<TMDBMedia[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<Tab>("movies");

  const loadWatchlist = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setItems(await fetchWatchlist({ filterWatched: true }));
    } catch (err: any) {
      setError(err.message || String(err));
    } finally {
      setLoading(false);
    }
  }, []);

  useFocusEffect(
    useCallback(() => {
      loadWatchlist();
    }, [loadWatchlist]),
  );

  const removeItem = async (id: number) => {
    const previous = items;
    setItems((current) => current.filter((item) => item.id !== id));
    try {
      await removeFromWatchlist(id);
    } catch (err: any) {
      setItems(previous);
      setError(err.message || String(err));
    }
  };

  const openDetails = (item: TMDBMedia) => {
    const type = item.media_type || (item.title ? "movie" : "tv");
    router.push({
      pathname: "/media/[type]/[id]",
      params: { type, id: String(item.id) },
    } as any);
  };

  const movies = items.filter(
    (item) => (item.media_type || "movie") === "movie",
  );
  const shows = items.filter((item) => item.media_type === "tv");
  const activeItems = activeTab === "movies" ? movies : shows;

  return (
    <YStack f={1} bg="$background">
      <SafeAreaView style={{ flex: 1 }} edges={["top"]}>
        <YStack f={1} px="$4">
          <XStack mt="$2" mb="$4" ai="center" jc="space-between">
            <YStack>
              <Text fow="900" fos="$9" color="$color">
                Watchlist
              </Text>
              <Text color="$color" opacity={0.5} fos="$2">
                Movies and shows saved for later
              </Text>
            </YStack>
            <Button size="$3" circular chromeless onPress={loadWatchlist}>
              ↻
            </Button>
          </XStack>

          <WatchlistTabs activeTab={activeTab} onChange={setActiveTab} />

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
                Add movies and TV shows from Discover and they will land here.
              </Text>
            </YStack>
          ) : (
            <ScrollView
              showsVerticalScrollIndicator={false}
              contentContainerStyle={{ paddingBottom: 120 }}
            >
              <WatchlistGroup
                title={activeTab === "movies" ? "Movies" : "TV Shows"}
                items={activeItems}
                onOpen={openDetails}
                onRemove={removeItem}
              />
            </ScrollView>
          )}
        </YStack>
      </SafeAreaView>
    </YStack>
  );
}

function WatchlistTabs({
  activeTab,
  onChange,
}: {
  activeTab: Tab;
  onChange: (tab: Tab) => void;
}) {
  return (
    <XStack bg="$backgroundElement" p="$1" borderRadius="$4" mb="$4">
      {(["movies", "tv"] as const).map((tab) => {
        const active = activeTab === tab;
        return (
          <Button
            key={tab}
            flex={1}
            borderRadius="$3"
            bg={active ? "$background" : "transparent"}
            color="$color"
            opacity={active ? 1 : 0.6}
            onPress={() => onChange(tab)}
          >
            {tab === "movies" ? "Movies" : "TV Shows"}
          </Button>
        );
      })}
    </XStack>
  );
}

function WatchlistGroup({
  title,
  items,
  onOpen,
  onRemove,
}: {
  title: string;
  items: TMDBMedia[];
  onOpen: (item: TMDBMedia) => void;
  onRemove: (id: number) => void;
}) {
  return (
    <YStack gap="$3">
      <XStack ai="center" jc="space-between">
        <Text color="$color" fow="800" fos="$6">
          {title}
        </Text>
        <Text color="$color" opacity={0.45} fos="$1">
          {items.length} items
        </Text>
      </XStack>

      {items.length === 0 ? (
        <YStack py="$5" ai="center" bg="$backgroundElement" borderRadius="$4">
          <Text color="$color" opacity={0.5}>
            No {title.toLowerCase()} saved yet
          </Text>
        </YStack>
      ) : (
        <YStack gap="$3">
          {items.map((item) => (
            <WatchlistRow
              key={`${item.media_type}-${item.id}`}
              item={item}
              onOpen={() => onOpen(item)}
              onRemove={() => onRemove(item.id)}
            />
          ))}
        </YStack>
      )}
    </YStack>
  );
}

function WatchlistRow({
  item,
  onOpen,
  onRemove,
}: {
  item: TMDBMedia;
  onOpen: () => void;
  onRemove: () => void;
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
      onPress={onOpen}
    >
      <YStack
        w={86}
        h={126}
        borderRadius="$3"
        overflow="hidden"
        bg="$background"
      >
        {item.poster_path ? (
          <Image
            source={{ uri: imageUrl(item.poster_path) }}
            style={{ width: "100%", height: "100%" }}
            contentFit="cover"
          />
        ) : (
          <YStack f={1} ai="center" jc="center">
            <Text color="$color" opacity={0.45}>
              No art
            </Text>
          </YStack>
        )}
      </YStack>

      <YStack f={1} jc="space-between" py="$1">
        <YStack gap="$1">
          <Text color="$color" fow="800" fos="$4" numberOfLines={2}>
            {mediaTitle(item)}
          </Text>
          <Text color="$color" opacity={0.5} fos="$2" tt="uppercase">
            {item.media_type || "movie"} {releaseYear(item)}
          </Text>
        </YStack>
        <XStack ai="center" jc="space-between">
          <Rating value={item.vote_average} />
          <Button
            size="$2.5"
            circular
            chromeless
            color="$red10"
            onPress={(event: any) => {
              event?.stopPropagation?.();
              onRemove();
            }}
          >
            ×
          </Button>
        </XStack>
      </YStack>
    </XStack>
  );
}

function Rating({ value }: { value: number }) {
  const full = Math.max(0, Math.min(5, Math.round(value / 2)));
  const empty = 5 - full;
  return (
    <XStack ai="center" gap="$1">
      <Text color="$yellow9" fos="$2">
        {"★".repeat(full)}
        {"☆".repeat(empty)}
      </Text>
      <Text color="$color" opacity={0.65} fos="$2">
        {value.toFixed(1)}
      </Text>
    </XStack>
  );
}
