import React, { useState, useEffect, useCallback } from "react";
import {
  StyleSheet,
  ScrollView,
  Share,
  Platform,
  TouchableOpacity,
} from "react-native";
import { useRouter } from "expo-router";
import { YStack, XStack, Text } from "tamagui";
import { Image } from "expo-image";
import Play from "lucide-react-native/icons/play";
import Share2 from "lucide-react-native/icons/share-2";
import Clock from "lucide-react-native/icons/clock";
import ChevronRight from "lucide-react-native/icons/chevron-right";
import { useAuth } from "@/context/AuthContext";
import BackButton from "@/components/BackButton";
import LoadingOrb from "@/components/LoadingOrb";
import ReplayCreditCard from "@/components/ReplayCreditCard";
import ReplayStoryModal from "@/components/ReplayStoryModal";
import { imageUrl, imageCachePolicy } from "@/lib/images";
import {
  fetchReplaySummary,
  type ReplayPeriod,
  type ReplaySummary,
  type ReplayRow,
} from "@/lib/media-api";

const PERIODS: { key: ReplayPeriod; label: string }[] = [
  { key: "this_week", label: "This Week" },
  { key: "this_month", label: "This Month" },
  { key: "this_year", label: "This Year" },
  { key: "all_time", label: "All-Time" },
];

export default function ReplayScreen() {
  const router = useRouter();
  const { user } = useAuth();
  const [period, setPeriod] = useState<ReplayPeriod>("this_year");
  const [loading, setLoading] = useState(true);
  const [summary, setSummary] = useState<ReplaySummary | null>(null);
  const [storyOpen, setStoryOpen] = useState(false);

  const loadReplay = useCallback(async (selectedPeriod: ReplayPeriod) => {
    setLoading(true);
    try {
      const res = await fetchReplaySummary(selectedPeriod);
      setSummary(res);
    } catch (err) {
      console.warn("Failed to fetch replay:", err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadReplay(period);
  }, [period, loadReplay]);

  const handleShare = async () => {
    if (!summary) return;
    const topShowText =
      summary.top_shows.length > 0
        ? `\n#1 Show: ${summary.top_shows[0].title}`
        : "";
    const topGenreText =
      summary.top_genres.length > 0
        ? `\nFavorite Genre: ${summary.top_genres[0].title}`
        : "";
    const watchTimeCard = summary.cards.find((c) => c.id === "watch_time");
    const watchTimeText = watchTimeCard ? `\nWatch Time: ${watchTimeCard.value}` : "";

    const message = `🎬 My Nexton Replay (${summary.period_label}):${watchTimeText}${topShowText}${topGenreText}\n\nTrack your movies and TV shows on Nexton!`;

    try {
      await Share.share({ message });
    } catch (err) {
      console.warn("Share error:", err);
    }
  };

  return (
    <YStack f={1} bg="$background">
      <XStack
        pt={Platform.OS === "web" ? "$4" : "$6"}
        px="$4"
        pb="$2"
        ai="center"
        jc="space-between"
      >
        <BackButton />
        <Text color="$color" fos="$4" fow="800">
          Replay
        </Text>
        <YStack w={40} />
      </XStack>

      <ScrollView
        showsVerticalScrollIndicator={false}
        contentContainerStyle={styles.scrollContent}
      >
        <YStack px="$4" pt="$2" pb="$4" gap="$2">
          <Text color="$color" fos="$9" fow="900" letterSpacing={-0.5}>
            Replay
          </Text>
          <Text color="$color" opacity={0.6} fos="$4" fow="600">
            {summary?.period_label || "Your Viewing Stats"}
          </Text>

          <XStack
            bg="$backgroundElement"
            p="$1"
            br="$4"
            borderWidth={1}
            borderColor="$borderColor"
            mt="$3"
            gap="$1"
          >
            {PERIODS.map((p) => {
              const active = period === p.key;
              return (
                <TouchableOpacity
                  key={p.key}
                  onPress={() => setPeriod(p.key)}
                  style={[
                    styles.periodTab,
                    active && styles.periodTabActive,
                  ]}
                  activeOpacity={0.8}
                >
                  <Text
                    fos="$2"
                    fow={active ? "800" : "600"}
                    color={active ? "$background" : "$color"}
                    numberOfLines={1}
                    ta="center"
                  >
                    {p.label}
                  </Text>
                </TouchableOpacity>
              );
            })}
          </XStack>
        </YStack>

        {loading ? (
          <YStack py="$10" ai="center" jc="center">
            <LoadingOrb label="Loading your Replay..." />
          </YStack>
        ) : !summary || summary.is_empty ? (
          <YStack py="$10" px="$6" ai="center" gap="$3">
            <YStack
              w={64}
              h={64}
              br="$10"
              bg="$backgroundElement"
              ai="center"
              jc="center"
            >
              <Clock color="gray" size={32} />
            </YStack>
            <Text color="$color" fos="$6" fow="800" ta="center">
              Not enough viewing yet
            </Text>
            <Text color="$color" opacity={0.6} fos="$3" fow="500" ta="center">
              Watch movies and TV episodes during {PERIODS.find((p) => p.key === period)?.label || "this period"} to unlock your Replay.
            </Text>
          </YStack>
        ) : (
          <YStack gap="$5" pb="$8">
            {summary.cards.length > 0 ? (
              <ScrollView
                horizontal
                showsHorizontalScrollIndicator={false}
                contentContainerStyle={styles.cardRow}
              >
                {summary.cards.map((card) => (
                  <ReplayCreditCard
                    key={card.id}
                    card={card}
                    holder={user?.name || "Nexton User"}
                    memberSince={summary.member_since}
                  />
                ))}
              </ScrollView>
            ) : null}

            <YStack px="$4">
              <TouchableOpacity
                onPress={() => setStoryOpen(true)}
                activeOpacity={0.85}
              >
                <XStack
                  bg="$backgroundElement"
                  borderWidth={1}
                  borderColor="$borderColor"
                  p="$3.5"
                  br="$4"
                  ai="center"
                  jc="space-between"
                >
                  <XStack ai="center" gap="$3">
                    <YStack
                      w={40}
                      h={40}
                      br="$10"
                      bg="$color"
                      ai="center"
                      jc="center"
                    >
                      <Play color="#FFFFFF" size={18} fill="#FFFFFF" />
                    </YStack>
                    <YStack>
                      <Text color="$color" fos="$4" fow="800">
                        Play your Replay
                      </Text>
                      <Text color="$color" opacity={0.6} fos="$2" fow="500">
                        Interactive highlight story
                      </Text>
                    </YStack>
                  </XStack>
                  <ChevronRight color="gray" size={20} />
                </XStack>
              </TouchableOpacity>
            </YStack>

            <ChartSection title="Top TV Shows" rows={summary.top_shows} />
            <ChartSection title="Top Genres" rows={summary.top_genres} />
            <ChartSection title="Top Actors" rows={summary.top_actors} circularImage />
            <ChartSection title="Top Networks" rows={summary.top_networks} />

            <YStack px="$4" gap="$3">
              <Text color="$color" fos="$6" fow="900">
                Viewing Habits
              </Text>

              <XStack gap="$2.5">
                <HabitTile label="MOVIES" value={summary.habits.distinct_movies} />
                <HabitTile label="SHOWS" value={summary.habits.distinct_shows} />
                <HabitTile label="EPISODES" value={summary.habits.total_episodes} />
              </XStack>

              {summary.habits.peak_hour != null ? (
                <Text color="$color" opacity={0.7} fos="$3" fow="500">
                  🕒 You watch most around {formatHour(summary.habits.peak_hour)}.
                </Text>
              ) : null}

              {summary.habits.busiest_day ? (
                <Text color="$color" opacity={0.7} fos="$3" fow="500">
                  📅 Busiest binge day: {summary.habits.busiest_day} ({summary.habits.busiest_day_count} items watched).
                </Text>
              ) : null}
            </YStack>

            <YStack px="$4" pt="$2">
              <TouchableOpacity onPress={handleShare} activeOpacity={0.85}>
                <XStack
                  bg="$backgroundElement"
                  borderWidth={1}
                  borderColor="$borderColor"
                  p="$3.5"
                  br="$4"
                  ai="center"
                  jc="center"
                  gap="$2"
                >
                  <Share2 color="#3B82F6" size={18} />
                  <Text color="$color" fos="$4" fow="800">
                    Share my Replay
                  </Text>
                </XStack>
              </TouchableOpacity>
            </YStack>
          </YStack>
        )}
      </ScrollView>

      {summary && !summary.is_empty ? (
        <ReplayStoryModal
          visible={storyOpen}
          onClose={() => setStoryOpen(false)}
          summary={summary}
          userName={user?.name || "Nexton User"}
        />
      ) : null}
    </YStack>
  );
}

function ChartSection({
  title,
  rows,
  circularImage = false,
}: {
  title: string;
  rows: ReplayRow[];
  circularImage?: boolean;
}) {
  if (!rows || rows.length === 0) return null;

  return (
    <YStack px="$4" gap="$2.5">
      <Text color="$color" fos="$6" fow="900">
        {title}
      </Text>

      <YStack
        bg="$backgroundElement"
        borderWidth={1}
        borderColor="$borderColor"
        br="$4"
        overflow="hidden"
      >
        {rows.map((row, idx) => {
          const artworkUri = row.artwork_url
            ? row.artwork_url.startsWith("http")
              ? row.artwork_url
              : imageUrl(row.artwork_url, circularImage ? "profile" : "posterCell")
            : null;

          return (
            <XStack
              key={`${title}-${row.rank}-${row.title}`}
              ai="center"
              p="$3"
              borderBottomWidth={idx === rows.length - 1 ? 0 : 1}
              borderBottomColor="$borderColor"
              gap="$3"
            >
              <YStack
                w={28}
                h={28}
                br="$10"
                bg={row.rank === 1 ? "$red9" : "rgba(128,128,128,0.2)"}
                ai="center"
                jc="center"
              >
                <Text
                  color={row.rank === 1 ? "#FFFFFF" : "$color"}
                  fos="$2"
                  fow="800"
                >
                  {row.rank}
                </Text>
              </YStack>

              {artworkUri ? (
                <Image
                  source={{ uri: artworkUri }}
                  style={{
                    width: 44,
                    height: 44,
                    borderRadius: circularImage ? 22 : 6,
                  }}
                  contentFit="cover"
                  cachePolicy={imageCachePolicy(circularImage ? "profile" : "posterCell")}
                />
              ) : (
                <YStack
                  w={44}
                  h={44}
                  br={circularImage ? "$10" : "$2"}
                  bg="$borderColor"
                  ai="center"
                  jc="center"
                >
                  <Text color="$color" opacity={0.6} fow="800" fos="$3">
                    {row.title.slice(0, 1).toUpperCase()}
                  </Text>
                </YStack>
              )}

              <YStack f={1} gap="$0.5">
                <Text color="$color" fos="$3" fow="700" numberOfLines={1}>
                  {row.title}
                </Text>
                {row.subtitle ? (
                  <Text
                    color="$color"
                    opacity={0.6}
                    fos="$1"
                    fow="500"
                    numberOfLines={1}
                  >
                    {row.subtitle}
                  </Text>
                ) : null}
              </YStack>

              {row.count > 0 ? (
                <Text color="$color" opacity={0.5} fos="$2" fow="600">
                  {row.count}
                </Text>
              ) : null}
            </XStack>
          );
        })}
      </YStack>
    </YStack>
  );
}

function HabitTile({ label, value }: { label: string; value: number }) {
  return (
    <YStack
      f={1}
      bg="$backgroundElement"
      borderWidth={1}
      borderColor="$borderColor"
      br="$4"
      p="$3"
      ai="center"
      jc="center"
      gap="$1"
    >
      <Text color="$color" fos="$7" fow="900">
        {value}
      </Text>
      <Text color="$color" opacity={0.6} fos="$1" fow="700" letterSpacing={1}>
        {label}
      </Text>
    </YStack>
  );
}

function formatHour(hour: number): string {
  const period = hour >= 12 ? "PM" : "AM";
  const displayHour = hour % 12 === 0 ? 12 : hour % 12;
  return `${displayHour}:00 ${period}`;
}

const styles = StyleSheet.create({
  scrollContent: {
    paddingBottom: 60,
  },
  periodTab: {
    flex: 1,
    paddingVertical: 8,
    borderRadius: 8,
    alignItems: "center",
    justifyContent: "center",
  },
  periodTabActive: {
    backgroundColor: "#3B82F6",
  },
  cardRow: {
    paddingHorizontal: 16,
    gap: 12,
  },
});
