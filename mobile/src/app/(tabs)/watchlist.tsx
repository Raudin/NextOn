import { FlashList } from "@shopify/flash-list";
import { useAuth } from "@/context/AuthContext";
import { useFocusEffect, useRouter } from "expo-router";
import {
  EllipsisVertical,
  PartyPopper,
  type LucideIcon,
} from "lucide-react-native";
import { useCallback, useEffect, useMemo, useState } from "react";
import type { ReactNode } from "react";
import { Pressable, StyleSheet, useWindowDimensions } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Button, Spinner, Text, useTheme, useThemeName, XStack, YStack } from "tamagui";
import { useDeferredLoading } from "@/hooks/use-deferred-loading";
import { useTypingActivity } from "@/hooks/use-typing-activity";

import LoadingOrb from "@/components/LoadingOrb";
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
import { invalidateMediaCaches } from "@/lib/cache";
import { setTelemetryScreen } from "@/lib/telemetry";
import { usePendingOverlay } from "@/hooks/use-pending-overlay";
import { BorderBeam } from 'border-beam-native';

import { loadWatchlistWithFallback } from "@/lib/db/queries";
import {
  mediaTitle,
  releaseYear,
  type WatchlistEntry,
} from "@/lib/media-api";

/**
 * Posters per row in the grid layout. Rows are pre-chunked for FlashList (see
 * `listData`), so this is also the item-grouping size.
 */
const POSTER_COLUMNS = 3;

/**
 * One entry in the flattened FlashList model.
 *
 * `getItemType` keys off `type` so a recycled cell is never reused across a
 * section header, a poster row and a list row -- reusing a cell across
 * different shapes is how recycled lists end up showing the wrong artwork.
 */
type WatchlistListItem =
  | { type: "section"; key: string; title: string; count: number; muted?: boolean }
  | { type: "posters"; key: string; items: WatchlistEntry[] }
  | { type: "entryRow"; key: string; item: WatchlistEntry }
  | { type: "empty"; key: string; message: string };

/**
 * Progress now arrives with the watchlist itself (`include=progress`), so both
 * the old `watchlist_show_progress_v2` cache key and the 5-minute revalidation
 * throttle are gone. Freshness and conditional revalidation are owned by
 * `requestJsonCached`, and the server answers an unchanged list with a 304.
 */

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
  const { push, replace } = useRouter();
  const { width } = useWindowDimensions();
  const { token, isLoading: authLoading } = useAuth();
  // The app's effective appearance, for the effect ports: they default to
  // `theme="dark"`, and this app can pin either one independently of the OS.
  const isLight = useThemeName() === "light";
  const { typing, markTyping, stopTyping } = useTypingActivity();
  const [items, setItems] = useState<WatchlistEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [backgroundRefreshing, setBackgroundRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<WatchlistTab>("tv");
  const [searchQuery, setSearchQuery] = useState("");
  const [menuOpen, setMenuOpen] = useState(false);
  const [searching, setSearching] = useState(false);
  const [layoutMode, setLayoutMode] = useState<WatchlistLayoutMode>("posters");
  const [sortMode, setSortMode] = useState<WatchlistSortMode>("recent");
  const [statusFilter, setStatusFilter] = useState<WatchlistStatus | null>(null);
  /** True when the list came from the on-device mirror rather than the server. */
  const [showingLocalMirror, setShowingLocalMirror] = useState(false);

  const pendingOverlay = usePendingOverlay();

  /**
   * What the screen renders instead of raw `loading`/`authLoading`.
   *
   * Both flags are deferred — held back for 150ms, then held for at least
   * 500ms once shown — so an orb only ever appears for a load long enough to
   * warrant one, and never blinks.
   */
  const showAuthLoading = useDeferredLoading(authLoading);
  const showLoadingUI = useDeferredLoading(loading);

  useEffect(() => {
    if (!authLoading && !token) {
      replace("/auth");
    }
  }, [authLoading, replace, token]);

  /**
   * Loads the watchlist with progress included.
   *
   * One request. Previously this screen fetched the list and then issued two
   * more requests per TV show (watched status + media details) to derive
   * progress on the device -- and re-ran that whole batch whenever the list
   * identity changed, which happens twice on a cold start.
   *
   * Falls back to the local mirror when there is no cached payload and no
   * connection, so a cold start offline shows the watchlist rather than an
   * error. `source` is reported so the UI can be honest about it.
   */
  const loadWatchlist = useCallback(
    async (options?: { silent?: boolean }) => {
      if (!token) return;

      const silent = options?.silent ?? false;
      if (silent) {
        setBackgroundRefreshing(true);
      } else {
        setLoading(true);
      }
      setError(null);

      try {
        const { items: fetchedItems, source } = await loadWatchlistWithFallback();
        setItems(fetchedItems);
        setShowingLocalMirror(source === "local");
      } catch (err: any) {
        setError(err.message || String(err));
      } finally {
        setLoading(false);
        setBackgroundRefreshing(false);
      }
    },
    [token],
  );

  /** Retry after a failure: clear the cache so the request actually goes out. */
  const handleRetry = useCallback(async () => {
    await invalidateMediaCaches();
    await loadWatchlist();
  }, [loadWatchlist]);

  useFocusEffect(
    useCallback(() => {
      setTelemetryScreen("watchlist");
      if (token) {
        loadWatchlist();
      }
    }, [loadWatchlist, token]),
  );

  const openDetails = useCallback(
    (item: WatchlistEntry) => {
      const type = item.media_type || (item.title ? "movie" : "tv");
      push({
        pathname: "/media/[type]/[id]",
        params: { type, id: String(item.id) },
      } as any);
    },
    [push],
  );

  /**
   * The server's watchlist with offline mutations layered on top.
   *
   * A mutation made offline is queued and reflected in this screen's state, but
   * the cached payload still describes the world before it — so without this a
   * removal reappears after a restart while still offline, and a title added
   * offline disappears entirely (the server has never seen it, so no cached
   * payload can contain it).
   */
  const visibleSourceItems = useMemo<WatchlistEntry[]>(() => {
    const remaining = items.filter(
      (item) => !pendingOverlay.watchlistRemovedIds.has(item.id),
    );

    if (pendingOverlay.watchlistAdded.size === 0) {
      return remaining;
    }

    // Offline additions have no server progress yet, and must not duplicate a
    // row the payload already has (the queue is not drained yet, so both can be
    // true at once).
    const serverIds = new Set(remaining.map((item) => item.id));
    const additions: WatchlistEntry[] = [];
    for (const [id, media] of pendingOverlay.watchlistAdded) {
      if (!serverIds.has(id)) {
        additions.push(media as WatchlistEntry);
      }
    }

    return [...additions, ...remaining];
  }, [items, pendingOverlay.watchlistAdded, pendingOverlay.watchlistRemovedIds]);

  const movies = useMemo(
    () => visibleSourceItems.filter((item) => (item.media_type || "movie") === "movie"),
    [visibleSourceItems],
  );
  const shows = useMemo(
    () => visibleSourceItems.filter((item) => item.media_type === "tv"),
    [visibleSourceItems],
  );
  const gridGap = 16;
  const posterWidth = Math.max(
    96,
    Math.min(180, Math.floor((width - 32 - gridGap * 2) / 3)),
  );

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
  const statusOf = useCallback((item: WatchlistEntry): WatchlistStatus => {
    if (item.media_type !== "tv") {
      // Movies carry no per-episode data: a future release date is the only
      // "not watchable yet" signal, matching the Home screen schedule.
      return isFutureDate(item.release_date) ? "upcoming" : "available";
    }

    // Progress is computed server-side; the client only reads it.
    if (item.progress?.released === false) {
      return "upcoming";
    }
    return item.progress?.caught_up ? "caughtUp" : "available";
  }, []);

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
    () => visibleItems.filter((item) => item.progress?.released !== false),
    [visibleItems],
  );
  const unreleasedItems = useMemo(
    () => visibleItems.filter((item) => item.progress?.released === false),
    [visibleItems],
  );

  const handleItemPress = useCallback(
    (item: WatchlistEntry) => {
      openDetails(item);
    },
    [openDetails],
  );

  const subtitleFor = useCallback(
    (item: WatchlistEntry, long: boolean) => {
      if (item.media_type !== "tv") {
        return releaseYear(item) || (long ? "Saved movie" : "Movie");
      }
      const progress = item.progress;
      if (progress?.total_episodes) {
        return long
          ? `${progress.watched_episodes}/${progress.total_episodes} episodes watched`
          : `${progress.watched_episodes}/${progress.total_episodes} episodes`;
      }
      return long ? "Tracking watch progress" : "Tracking progress";
    },
    [],
  );

  const progressFor = useCallback(
    (item: WatchlistEntry) =>
      item.media_type === "tv" ? item.progress?.progress : undefined,
    [],
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

  /**
   * Flattened list model for FlashList.
   *
   * A watchlist has no upper bound -- a heavy user can accumulate hundreds of
   * titles -- and the previous `ScrollView` wrapped everything in `<YStack
   * gap>` children, which meant every card mounted and started downloading its
   * poster on first paint. FlashList recycles cells, so only what is near the
   * viewport costs anything.
   *
   * Poster mode emits *rows* of `POSTER_COLUMNS` cards rather than relying on
   * `numColumns`/`masonry`: our rows are mixed with section headers, and
   * FlashList's column modes assume a single uniform item. Chunking keeps the
   * existing wrap layout byte-for-byte identical.
   */
  const listData = useMemo<WatchlistListItem[]>(() => {
    const out: WatchlistListItem[] = [];

    if (visibleItems.length === 0) {
      out.push({ type: "empty", key: "empty", message: emptyMessage });
      return out;
    }

    const pushItems = (list: WatchlistEntry[], keyPrefix: string) => {
      if (layoutMode === "posters") {
        for (let i = 0; i < list.length; i += POSTER_COLUMNS) {
          out.push({
            type: "posters",
            key: `${keyPrefix}-row-${i}`,
            items: list.slice(i, i + POSTER_COLUMNS),
          });
        }
        return;
      }

      for (const item of list) {
        out.push({
          type: "entryRow",
          key: `${keyPrefix}-${item.media_type || "media"}-${item.id}`,
          item,
        });
      }
    };

    if (statusFilter) {
      // A status pill narrows the list to one bucket, so the
      // available/unreleased section split no longer applies.
      pushItems(visibleItems, "filtered");
    } else if (activeTab === "tv") {
      if (availableItems.length > 0) {
        out.push({
          type: "section",
          key: "section-available",
          title: "Available now",
          count: availableItems.length,
        });
        pushItems(availableItems, "available");
      }
      if (unreleasedItems.length > 0) {
        out.push({
          type: "section",
          key: "section-unreleased",
          title: "Not yet released",
          count: unreleasedItems.length,
          muted: true,
        });
        pushItems(unreleasedItems, "unreleased");
      }
    } else {
      pushItems(visibleItems, "movies");
    }

    return out;
  }, [
    activeTab,
    availableItems,
    emptyMessage,
    layoutMode,
    statusFilter,
    unreleasedItems,
    visibleItems,
  ]);

  const renderListItem = useCallback(
    ({ item }: { item: WatchlistListItem }) => {
      switch (item.type) {
        case "section":
          return (
            <WatchlistSection
              title={item.title}
              count={item.count}
              muted={item.muted}
            >
              {/* The section's children are separate list items; the wrapper
                  only renders its heading. */}
              {null}
            </WatchlistSection>
          );

        case "posters":
          return (
            <XStack flexWrap="wrap" gap="$3">
              {item.items.map((entry) => (
                <WatchlistPosterCard
                  key={`${entry.media_type || "media"}-${entry.id}`}
                  item={entry}
                  width={posterWidth}
                  subtitle={subtitleFor(entry, false)}
                  progress={progressFor(entry)}
                  selected={false}
                  selectionMode={false}
                  onPress={() => handleItemPress(entry)}
                />
              ))}
            </XStack>
          );

        case "entryRow":
          return (
            <WatchlistRow
              item={item.item}
              subtitle={subtitleFor(item.item, true)}
              progress={progressFor(item.item)}
              selected={false}
              selectionMode={false}
              onOpen={() => handleItemPress(item.item)}
            />
          );

        case "empty":
          return (
            <YStack py="$8" gap="$2">
              <Text color="$color" opacity={0.55} ta="center">
                {item.message}
              </Text>
            </YStack>
          );

        default:
          return null;
      }
    },
    [handleItemPress, posterWidth, progressFor, subtitleFor],
  );

  const listHeader = useMemo(
    () => (
      <XStack ai="center" jc="space-between" pb="$4">
        <Text color="$color" fow="900" fos="$8">
          {sectionTitle}
        </Text>
        <Text color="$color" opacity={0.45} fos="$2">
          {sectionMeta}
        </Text>
      </XStack>
    ),
    [sectionMeta, sectionTitle],
  );

  if (showAuthLoading) {
    return (
      <YStack f={1} ai="center" jc="center" bg="$background">
        {/* No caption: this is the session restore, and the watchlist's own
            caption follows it immediately. */}
        <LoadingOrb />
      </YStack>
    );
  }

  if (!token) {
    return null;
  }

  return (
    <YStack f={1} bg="$background">
      {/*
        The top safe inset is owned by this container rather than delegated to
        `contentInsetAdjustmentBehavior` on the FlashList below. The
        `ui-safe-area-scroll` rule assumes the scroller is the screen's root
        scroller; this screen deliberately pins the tab switcher, the menu
        affordance and the search field above it, so the list can never be a
        direct child. See `(tabs)/profile.tsx` for the migrated form.
      */}
      <SafeAreaView style={{ flex: 1 }} edges={["top"]}>
        <YStack
          f={1}
          px="$4"
          position="relative"
          // Required for the native tab bar's tap-to-scroll-to-top; see the
          // native tabs guide on wrapping a ScrollView.
          collapsable={false}
        >
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
              {backgroundRefreshing ? <Spinner size="small" color="$color" opacity={0.6} /> : null}
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

          {showingLocalMirror ? (
            // Say so rather than quietly presenting an incomplete view: the
            // mirror has no per-show progress, and it can be behind the server.
            <YStack
              bg="$backgroundElement"
              br="$3"
              borderCurve="continuous"
              px="$3"
              py="$2"
              mt="$2"
            >
              <Text color="$color" opacity={0.7} fos="$1">
                Offline: showing your saved titles from this device. Progress and
                any changes from other devices will sync when you reconnect.
              </Text>
            </YStack>
          ) : null}
          <YStack mt="$3" mb="$3">
            {/* Spacing lives OUTSIDE the beam: the port traces the bounds of its
                wrapper View, so margins on a child are measured inside the ring
                and the ring floats away from the pill. `borderRadius` has to
                match the wrapped pill (SearchField is radius 999 at height 50,
                so 25), not the `md` preset's 16. The theme must come from the
                app — the port defaults to `dark`, and this app can pin either
                appearance. */}
            <BorderBeam theme={isLight ? "light" : "dark"} borderRadius={25} active={typing || searching}>
              <SearchField
                value={searchQuery}
                onChangeText={(value) => {
                    setSearchQuery(value);
                    if (value.trim()) {
                      markTyping();
                    } else {
                      stopTyping();
                    }
                  }}
                placeholder={`Search your ${activeTab === "tv" ? "shows" : "movies"}`}
              />
            </BorderBeam>
          </YStack>

          {!showLoadingUI && !error && visibleSourceItems.length > 0 ? (
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

          {showLoadingUI ? (
            <LoadingOrb label="Loading watchlist..." />
          ) : error ? (
            <YStack f={1} ai="center" jc="center" gap="$4">
              <Text color="$red10" ta="center" fow="700">
                {error}
              </Text>
              <Button onPress={handleRetry}>Retry</Button>
            </YStack>
          ) : visibleSourceItems.length === 0 ? (
            <YStack f={1} ai="center" jc="center" gap="$2" px="$5">
              <Text fow="800" fos="$6" color="$color" ta="center">
                Your watchlist is empty
              </Text>
              <Text color="$color" opacity={0.55} ta="center">
                Add movies and TV shows from Discover and they will land here.
              </Text>
            </YStack>
          ) : (
            <FlashList
              data={listData}
              renderItem={renderListItem}
              keyExtractor={(entry) => entry.key}
              getItemType={(entry) => entry.type}
              ListHeaderComponent={listHeader}
              ItemSeparatorComponent={ListSeparator}
              showsVerticalScrollIndicator={false}
              // FlashList v2 sizes itself and manages the render window
              // internally; `initialNumToRender`/`windowSize` from v1 (and from
              // FlatList) no longer exist. `drawDistance` is the one remaining
              // knob, and 600dp keeps roughly a screenful of cards ready
              // without mounting the whole watchlist.
              drawDistance={600}
              contentContainerStyle={styles.listContent}
            />
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

/**
 * Row spacing for the FlashList.
 *
 * Applied as an item separator rather than a container `gap`: a recycled list
 * has no parent stack to space its children, and putting the spacing on the
 * item would double it between the last item and the next section header.
 */
function ListSeparator() {
  return <YStack h={12} />;
}

const styles = StyleSheet.create({
  listContent: {
    // Clears the floating tab bar.
    paddingBottom: 120,
  },
});
