import React, { useCallback, useState, useEffect, useMemo } from "react";
import { Platform, StyleSheet } from "react-native";
import { useFocusEffect, useRouter } from "expo-router";
import { SafeAreaView } from "react-native-safe-area-context";
import { Button, ScrollView, Spinner, Text, XStack, YStack } from "tamagui";
import { useAuth } from "@/context/AuthContext";

import ProfileSummary from "@/components/Home/ProfileSummary";
import UpNextCard from "@/components/Home/UpNextCard";

import {
  fetchWatchlist,
  fetchWatchedHistory,
  type TMDBMedia,
  type WatchedItem,
} from "@/lib/media-api";

function getLevelTitle(level: number): string {
  if (level < 3) return "Binge Novice";
  if (level < 6) return "Screen Cadet";
  if (level < 10) return "Episode Enthusiast";
  if (level < 15) return "Serial Streamer";
  if (level < 21) return "Binge Commander";
  if (level < 31) return "Showmaster";
  return "Couch Emperor";
}

function calculateStreak(watchedItems: WatchedItem[]): number {
  if (!watchedItems || watchedItems.length === 0) return 0;

  const uniqueDates = Array.from(
    new Set(
      watchedItems
        .map((item) => {
          if (!item.watched_at) return null;
          const date = new Date(item.watched_at);
          const year = date.getFullYear();
          const month = String(date.getMonth() + 1).padStart(2, "0");
          const day = String(date.getDate()).padStart(2, "0");
          return `${year}-${month}-${day}`;
        })
        .filter((d): d is string => d !== null)
    )
  ).sort((a, b) => b.localeCompare(a));

  if (uniqueDates.length === 0) return 0;

  const getLocalDateString = (date: Date) => {
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, "0");
    const day = String(date.getDate()).padStart(2, "0");
    return `${year}-${month}-${day}`;
  };

  const todayStr = getLocalDateString(new Date());
  const yesterday = new Date();
  yesterday.setDate(yesterday.getDate() - 1);
  const yesterdayStr = getLocalDateString(yesterday);

  const mostRecent = uniqueDates[0];
  if (mostRecent !== todayStr && mostRecent !== yesterdayStr) {
    return 0;
  }

  let streak = 1;
  let currentDate = new Date(mostRecent);

  for (let i = 1; i < uniqueDates.length; i++) {
    const nextDate = new Date(uniqueDates[i]);
    const diffTime = Math.abs(currentDate.getTime() - nextDate.getTime());
    const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));

    if (diffDays === 1) {
      streak++;
      currentDate = nextDate;
    } else if (diffDays > 1) {
      break;
    }
  }

  return streak;
}

export default function HomeScreen() {
  const router = useRouter();
  const { token, isLoading: authLoading } = useAuth();
  const [watchlistItems, setWatchlistItems] = useState<TMDBMedia[]>([]);
  const [watchedHistory, setWatchedHistory] = useState<WatchedItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!authLoading && !token) {
      router.replace("/auth");
    }
  }, [authLoading, token, router]);

  const loadData = useCallback(async () => {
    if (!token) return;
    setLoading(true);
    setError(null);
    try {
      const [watchlist, watched] = await Promise.all([
        fetchWatchlist({ filterWatched: true }),
        fetchWatchedHistory(),
      ]);
      setWatchlistItems(watchlist);
      setWatchedHistory(watched);
    } catch (err: any) {
      setError(err.message || String(err));
    } finally {
      setLoading(false);
    }
  }, [token]);

  useFocusEffect(
    useCallback(() => {
      if (token) {
        loadData();
      }
    }, [loadData, token])
  );

  const handleFullyWatched = useCallback((id: number) => {
    setWatchlistItems((current) => current.filter((item) => item.id !== id));
  }, []);

  const refreshProfileStats = useCallback(async () => {
    try {
      const watched = await fetchWatchedHistory();
      setWatchedHistory(watched);
    } catch {
      // ignore non-critical refresh failures
    }
  }, []);

  const shows = useMemo(() => {
    return watchlistItems.filter((item) => item.media_type === "tv");
  }, [watchlistItems]);

  const profileStats = useMemo(() => {
    let movies = 0;
    let episodes = 0;
    for (const item of watchedHistory) {
      if (item.media_type === "movie") {
        movies++;
      } else if (item.media_type === "tv") {
        episodes++;
      }
    }
    const xp = (movies * 120) + (episodes * 45);
    const level = Math.floor(xp / 1000);
    const xpInLevel = xp % 1000;
    const percentage = xpInLevel / 1000;
    const title = getLevelTitle(level);
    const streak = calculateStreak(watchedHistory);

    return {
      level,
      title,
      xpInLevel,
      percentage,
      streak,
    };
  }, [watchedHistory]);

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
      <SafeAreaView style={styles.safeArea} edges={["top"]}>
        <YStack f={1} px="$4" gap="$4">
          {/* Top Header: Profile Summary */}
          <ProfileSummary
            level={profileStats.level}
            title={profileStats.title}
            xpInLevel={profileStats.xpInLevel}
            streak={profileStats.streak}
            percentage={profileStats.percentage}
          />

          {/* Main Section: Up Next */}
          <XStack ai="center" jc="space-between">
            <YStack>
              <Text fow="900" fos="$7" color="$color">
                Up Next
              </Text>
              <Text color="$color" opacity={0.5} fos="$2">
                Continue watching your tracked shows
              </Text>
            </YStack>
            <Button size="$3" circular chromeless onPress={loadData}>
              ↻
            </Button>
          </XStack>

          {loading ? (
            <YStack f={1} ai="center" jc="center" gap="$3">
              <Spinner size="large" color="$color" />
              <Text color="$color" opacity={0.5}>
                Loading Dashboard...
              </Text>
            </YStack>
          ) : error ? (
            <YStack f={1} ai="center" jc="center" gap="$4">
              <Text color="$red10" ta="center" fow="700">
                {error}
              </Text>
              <Button onPress={loadData}>Retry</Button>
            </YStack>
          ) : shows.length === 0 ? (
            <YStack f={1} ai="center" jc="center" gap="$3" px="$5">
              <Text fow="800" fos="$6" color="$color" ta="center">
                No shows in your watchlist
              </Text>
              <Text color="$color" opacity={0.55} ta="center">
                Track TV shows by saving them to your watchlist, and the next episodes will appear here.
              </Text>
            </YStack>
          ) : (
            <ScrollView
              showsVerticalScrollIndicator={false}
              contentContainerStyle={styles.scrollContent}
            >
              <YStack gap="$3">
                {shows.map((show) => (
                  <UpNextCard
                    key={`up-next-${show.id}`}
                    show={show}
                    onFullyWatched={handleFullyWatched}
                    onWatchedMarked={refreshProfileStats}
                  />
                ))}
              </YStack>
            </ScrollView>
          )}
        </YStack>
      </SafeAreaView>
    </YStack>
  );
}

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
  },
  scrollContent: {
    paddingBottom: Platform.OS === "web" ? 40 : 120,
  },
});
