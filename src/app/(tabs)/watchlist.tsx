import React, { useCallback, useState, useEffect } from "react";
import { useFocusEffect, useRouter } from "expo-router";
import { SafeAreaView } from "react-native-safe-area-context";
import { Button, ScrollView, Spinner, Text, XStack, YStack } from "tamagui";
import { useAuth } from "@/context/AuthContext";

import WatchlistTabs, { type WatchlistTab } from "@/components/Watchlist/WatchlistTabs";
import WatchlistGroup from "@/components/Watchlist/WatchlistGroup";
import WatchlistGroupTV from "@/components/Watchlist/WatchlistGroupTV";

import {
  fetchWatchlist,
  removeFromWatchlist,
  type TMDBMedia,
} from "@/lib/media-api";

export default function WatchlistScreen() {
  const router = useRouter();
  const { token, isLoading: authLoading } = useAuth();
  const [items, setItems] = useState<TMDBMedia[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<WatchlistTab>("movies");

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

  const handleFullyWatched = useCallback((id: number) => {
    setItems((current) => current.filter((item) => item.id !== id));
  }, []);

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
              {activeTab === "movies" ? (
                <WatchlistGroup
                  title="Movies"
                  items={movies}
                  onOpen={openDetails}
                  onRemove={removeItem}
                />
              ) : (
                <WatchlistGroupTV
                  title="TV Shows"
                  items={shows}
                  onFullyWatched={handleFullyWatched}
                />
              )}
            </ScrollView>
          )}
        </YStack>
      </SafeAreaView>
    </YStack>
  );
}
