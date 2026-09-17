import { useAuth } from "@/context/AuthContext";
import { useFocusEffect, useRouter } from "expo-router";
import {
  EllipsisVertical,
  PartyPopper,
  type LucideIcon,
} from "lucide-react-native";
import { useCallback, useEffect, useMemo, useState } from "react";
import type { ReactNode } from "react";
import { Pressable, useWindowDimensions } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Button, ScrollView, Spinner, Text, useTheme, XStack, YStack } from "tamagui";

import SearchField from "@/components/SearchField";
import WatchlistMenu, {
  type WatchlistLayoutMode,
  type WatchlistSortMode,
} from "@/components/Watchlist/WatchlistMenu";
import WatchlistPosterCard from "@/components/Watchlist/WatchlistPosterCard";
import WatchlistRow from "@/components/Watchlist/WatchlistRow";
import WatchlistStatusFilter, {
  STATUS_FILTER_META,
  type WatchlistStatus,
} from "@/components/Watchlist/WatchlistStatusFilter";
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

// Versioned so entries cached before ShowProgress gained `caughtUp` are ignored
// instead of silently classifying everything as "not caught up".
const SHOW_PROGRESS_CACHE_KEY = "watchlist_show_progress_v2";

interface ShowProgress {
  watchedEpisodes: number;
  totalEpisodes: number;
  progress: number;
  /** Whether the show has started airing. */
  released: boolean;
  /**
   * Every episode watched while the show is still returning. The backend drops
   * fully watched shows that have ended, so these stay on the watchlist only
   * because more episodes are coming.
   */
  caughtUp: boolean;
}

const ENDED_STATUSES = ["ended", "canceled", "cancelled"];

function isFutureDate(value?: string | null) {
  if (!value) return false;
  const parts = value.split("-");
  if (parts.length !== 3) return false;
  const date = new Date(
    Number(parts[0]),
    Number(parts[1]) - 1,
    Number(parts[2]),
  );
  if (Number.isNaN(date.getTime())) return false;
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  return date > today;
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
  const [statusFilter, setStatusFilter] = useState<WatchlistStatus | null>(null);
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
    const cachedProgress =
      await cache.get<Record<number, ShowProgress>>(SHOW_PROGRESS_CACHE_KEY);

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

          // A show counts as watchable once it has started airing; TMDB's
          // status catches the ones with a stale or missing air date.
          const normalizedStatus = details.status?.toLowerCase() ?? "";
          const notYetReleased =
            isFutureDate(details.first_air_date || show.first_air_date) ||
            normalizedStatus.includes("planned") ||
            normalizedStatus.includes("in production") ||
            normalizedStatus.includes("rumored");

          // "Caught up" = the whole show watched but still returning. Unknown
          // statuses count as returning so a details hiccup does not hide these.
          const fullyWatched =
            totalEpisodes > 0 && watchedEpisodes >= totalEpisodes;
          const hasEnded = ENDED_STATUSES.some((status) =>
            normalizedStatus.includes(status),
          );

          return [
            show.id,
            {
              watchedEpisodes,
              totalEpisodes,
              progress,
              released: !notYetReleased,
              caughtUp: !notYetReleased && fullyWatched && !hasEnded,
            },
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

      await cache.set(SHOW_PROGRESS_CACHE_KEY, nextProgress);
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

  /** Watching status of a single item, used by the filter pills. */
  const statusOf = useCallback(
    (item: TMDBMedia): WatchlistStatus => {
      if (item.media_type !== "tv") {
        // Movies carry no per-episode data: a future release date is the only
        // "not watchable yet" signal, matching the Home screen schedule.
        return isFutureDate(item.release_date) ? "upcoming" : "available";
      }

      const progress = showProgress[item.id];
      if (progress?.released === false) {
        return "upcoming";
      }
      return progress?.caughtUp ? "caughtUp" : "available";
    },
    [showProgress],
  );

  const statusCounts = useMemo(() => {
    const counts: Record<WatchlistStatus, number> = {
      available: 0,
      caughtUp: 0,
      upcoming: 0,
    };
    for (const item of filteredItems) {
      counts[statusOf(item)] += 1;
    }
    return counts;
  }, [filteredItems, statusOf]);

  /** Items left after the active status pill, if any. */
  const visibleItems = useMemo(
    () =>
      statusFilter
        ? filteredItems.filter((item) => statusOf(item) === statusFilter)
        : filteredItems,
    [filteredItems, statusFilter, statusOf],
  );

  /** Shows are split into what can be watched now and what is still pending. */
  const availableItems = useMemo(
    () => visibleItems.filter((item) => showProgress[item.id]?.released !== false),
    [visibleItems, showProgress],
  );
  const unreleasedItems = useMemo(
    () => visibleItems.filter((item) => showProgress[item.id]?.released === false),
    [visibleItems, showProgress],
  );

  const handleItemPress = useCallback(
    (item: TMDBMedia) => {
      openDetails(item);
    },
    [openDetails],
  );

  const subtitleFor = useCallback(
    (item: TMDBMedia, long: boolean) => {
      if (item.media_type !== "tv") {
        return releaseYear(item) || (long ? "Saved movie" : "Movie");
      }
      const progress = showProgress[item.id];
      if (progress?.totalEpisodes) {
        return long
          ? `${progress.watchedEpisodes}/${progress.totalEpisodes} episodes watched`
          : `${progress.watchedEpisodes}/${progress.totalEpisodes} episodes`;
      }
      return long ? "Tracking watch progress" : "Tracking progress";
    },
    [showProgress],
  );

  const progressFor = useCallback(
    (item: TMDBMedia) =>
      item.media_type === "tv" ? showProgress[item.id]?.progress : undefined,
    [showProgress],
  );

  const renderGrid = useCallback(
    (list: TMDBMedia[]) => (
      <XStack flexWrap="wrap" gap="$3">
        {list.map((item) => (
          <WatchlistPosterCard
            key={`${item.media_type || "media"}-${item.id}`}
            item={item}
            width={posterWidth}
            subtitle={subtitleFor(item, false)}
            progress={progressFor(item)}
            selected={false}
            selectionMode={false}
            onPress={() => handleItemPress(item)}
          />
        ))}
      </XStack>
    ),
    [handleItemPress, posterWidth, progressFor, subtitleFor],
  );

  const renderRows = useCallback(
    (list: TMDBMedia[]) => (
      <YStack gap="$3">
        {list.map((item) => (
          <WatchlistRow
            key={`${item.media_type || "media"}-${item.id}`}
            item={item}
            subtitle={subtitleFor(item, true)}
            progress={progressFor(item)}
            selected={false}
            selectionMode={false}
            onOpen={() => handleItemPress(item)}
          />
        ))}
      </YStack>
    ),
    [handleItemPress, progressFor, subtitleFor],
  );

  const renderList = useCallback(
    (list: TMDBMedia[]) =>
      layoutMode === "posters" ? renderGrid(list) : renderRows(list),
    [layoutMode, renderGrid, renderRows],
  );

  const activeStatusFilter = statusFilter ? STATUS_FILTER_META[statusFilter] : null;

  const sectionTitle = searchQuery.trim()
    ? `Results for "${searchQuery.trim()}"`
    : activeStatusFilter
      ? activeStatusFilter.title
      : "Ready to Watch";
  const sectionMeta = `${visibleItems.length} items`;

  const statusOptions: WatchlistStatus[] =
    activeTab === "tv"
      ? ["available", "caughtUp", "upcoming"]
      : ["available", "upcoming"];

  const emptyMessage = searchQuery.trim()
    ? "No saved titles match that search."
    : activeStatusFilter
      ? activeStatusFilter.empty
      : `No ${activeTab === "tv" ? "shows" : "movies"} saved yet.`;

  const menuIsCustomized = layoutMode !== "posters" || sortMode !== "recent";

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
              <WatchlistTabs
                activeTab={activeTab}
                onChange={(tab) => {
                  setActiveTab(tab);
                  // Movies and shows expose different statuses, so a stale
                  // filter would silently hide everything after switching.
                  setStatusFilter(null);
                }}
              />
              {backgroundRefreshing && (
                <Spinner size="small" color="$color" opacity={0.6} />
              )}
            </XStack>
            <XStack gap="$2" ai="center">
              <HeaderIconButton
                icon={EllipsisVertical}
                label="Watchlist options"
                active={menuOpen || menuIsCustomized}
                onPress={() => setMenuOpen((current) => !current)}
              />
            </XStack>
          </XStack>

          <YStack mt="$3" mb="$3">
            <SearchField
              value={searchQuery}
              onChangeText={setSearchQuery}
              placeholder={`Search your ${activeTab === "tv" ? "shows" : "movies"}`}
            />
          </YStack>

          {!loading && !error && items.length > 0 ? (
            <YStack mb="$3">
              <WatchlistStatusFilter
                options={statusOptions}
                value={statusFilter}
                counts={statusCounts}
                onChange={setStatusFilter}
              />
            </YStack>
          ) : null}

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
              <YStack gap="$4">
                <XStack ai="center" jc="space-between">
                  <Text color="$color" fow="900" fos="$8">
                    {sectionTitle}
                  </Text>
                  <Text color="$color" opacity={0.45} fos="$2">
                    {sectionMeta}
                  </Text>
                </XStack>

                {visibleItems.length === 0 ? (
                  <YStack py="$8" gap="$2">
                    <Text color="$color" opacity={0.55} ta="center">
                      {emptyMessage}
                    </Text>
                  </YStack>
                ) : statusFilter ? (
                  // A status pill narrows the list to one bucket, so the
                  // available/unreleased section split no longer applies.
                  renderList(visibleItems)
                ) : activeTab === "tv" ? (
                  <>
                    {availableItems.length > 0 ? (
                      <WatchlistSection
                        title="Available now"
                        count={availableItems.length}
                      >
                        {renderList(availableItems)}
                      </WatchlistSection>
                    ) : null}

                    {unreleasedItems.length > 0 ? (
                      <WatchlistSection
                        title="Not yet released"
                        count={unreleasedItems.length}
                        muted
                      >
                        {renderList(unreleasedItems)}
                      </WatchlistSection>
                    ) : null}
                  </>
                ) : (
                  renderList(visibleItems)
                )}
              </YStack>
            </ScrollView>
          )}
        </YStack>
      </SafeAreaView>
    </YStack>
  );
}

/** Small translucent header affordance with a vector icon and hit feedback. */
function HeaderIconButton({
  icon: Icon,
  label,
  onPress,
  active,
}: {
  icon: LucideIcon;
  label: string;
  onPress: () => void;
  active?: boolean;
}) {
  const theme = useTheme();
  // `$color` flips with the theme (near-white on dark, near-black on light), so
  // surfaces derived from it stay visible in both modes. The `??` values only
  // apply if a token is missing from the active theme.
  const iconColor = theme.color?.val ?? "#FFFFFF";
  const subtleSurface = theme.color3?.val ?? "rgba(128,128,128,0.14)";
  const backgroundHover = theme.color5?.val ?? "rgba(128,128,128,0.24)";
  const subtleBorder = theme.borderColor?.val ?? "rgba(128,128,128,0.32)";
  const borderColorStrong =
    theme.borderColorHover?.val ?? theme.color8?.val ?? subtleBorder;

  return (
    <Pressable
      onPress={onPress}
      hitSlop={6}
      accessibilityRole="button"
      accessibilityLabel={label}
      style={({ pressed }) => [
        {
          width: 38,
          height: 38,
          borderRadius: 19,
          alignItems: "center",
          justifyContent: "center",
          // Theme tokens so the affordance stays legible in both light and
          // dark mode (a hardcoded white surface vanished on light).
          backgroundColor: active ? backgroundHover : subtleSurface,
          borderWidth: 1,
          borderColor: active ? borderColorStrong : subtleBorder,
        },
        pressed && { opacity: 0.65 },
      ]}
    >
      <Icon size={18} color={iconColor} strokeWidth={2.4} />
    </Pressable>
  );
}

/** Titled group used to separate watchable shows from unreleased ones. */
function WatchlistSection({
  title,
  count,
  muted,
  children,
}: {
  title: string;
  count: number;
  muted?: boolean;
  children: ReactNode;
}) {
  const theme = useTheme();
  return (
    <YStack gap="$3">
      <XStack ai="center" jc="space-between" gap="$2">
        <XStack ai="center" gap="$2">
          {muted ? (
            <PartyPopper
              size={15}
              color={theme.color?.val ?? "#FFFFFF"}
              strokeWidth={2.2}
              opacity={0.55}
            />
          ) : null}
          <Text
            color="$color"
            fow="800"
            fos="$5"
            opacity={muted ? 0.6 : 1}
          >
            {title}
          </Text>
        </XStack>
        <Text color="$color" opacity={0.4} fos="$2" fow="700">
          {count}
        </Text>
      </XStack>
      {children}
    </YStack>
  );
}
