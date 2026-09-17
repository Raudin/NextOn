import {
  CalendarClock,
  CheckCheck,
  CirclePlay,
  type LucideIcon,
} from "lucide-react-native";
import { ScrollView } from "react-native";
import { Text, useTheme, XStack } from "tamagui";

/** Watching status a watchlist item can be filtered by. */
export type WatchlistStatus = "available" | "caughtUp" | "upcoming";

type FilterTone = "green" | "blue" | "orange";

interface StatusFilterMeta {
  /** Compact label shown inside the pill. */
  label: string;
  /** Sentence-style label used as the list heading. */
  title: string;
  /** Shown when the filter matches nothing. */
  empty: string;
  icon: LucideIcon;
  tone: FilterTone;
}

export const STATUS_FILTER_META: Record<WatchlistStatus, StatusFilterMeta> =
  {
    available: {
      label: "Available",
      title: "Available to watch",
      empty: "Nothing is available to watch right now.",
      icon: CirclePlay,
      tone: "green",
    },
    caughtUp: {
      label: "Caught up",
      title: "Caught up",
      empty: "No show is fully watched and waiting on new episodes.",
      icon: CheckCheck,
      tone: "blue",
    },
    upcoming: {
      label: "Not yet released",
      title: "Not yet released",
      empty: "Nothing is waiting to be released.",
      icon: CalendarClock,
      tone: "orange",
    },
  };

interface WatchlistStatusFilterProps {
  /** Which pills to show: movies get two, TV shows get three. */
  options: WatchlistStatus[];
  value: WatchlistStatus | null;
  counts: Record<WatchlistStatus, number>;
  /** Tapping the active pill clears the filter (passes null). */
  onChange: (value: WatchlistStatus | null) => void;
}

/** Rounded pill row that filters the watchlist by watching status. */
export default function WatchlistStatusFilter({
  options,
  value,
  counts,
  onChange,
}: WatchlistStatusFilterProps) {
  const theme = useTheme();
  const iconColor = theme.color?.val ?? "#FFFFFF";
  // Same defensive token reads as the header affordances: `?? ` only kicks in
  // when a token is missing from the active theme.
  const idleSurface = theme.color3?.val ?? "rgba(128,128,128,0.14)";
  const activeSurface = theme.color5?.val ?? "rgba(128,128,128,0.26)";
  const idleBorder = theme.borderColor?.val ?? "rgba(128,128,128,0.32)";

  const accentFor = (tone: FilterTone) => {
    if (tone === "green") return theme.green9?.val ?? "#22C55E";
    if (tone === "blue") return theme.blue9?.val ?? "#3B82F6";
    return theme.orange9?.val ?? "#F97316";
  };

  return (
    <ScrollView
      horizontal
      showsHorizontalScrollIndicator={false}
      // RN's horizontal ScrollView defaults to flexGrow: 1, which would stretch
      // the row over the whole column instead of hugging the pills.
      style={{ flexGrow: 0, flexShrink: 0 }}
      contentContainerStyle={{ gap: 8, paddingRight: 4 }}
    >
      {options.map((option) => {
        const meta = STATUS_FILTER_META[option];
        const Icon = meta.icon;
        const active = value === option;
        const accent = accentFor(meta.tone);

        return (
          <XStack
            key={option}
            ai="center"
            gap="$1.5"
            px="$3"
            h={34}
            borderRadius={999}
            bg={active ? activeSurface : idleSurface}
            borderWidth={1}
            borderColor={active ? accent : idleBorder}
            pressStyle={{ opacity: 0.7 }}
            onPress={() => onChange(active ? null : option)}
            accessibilityRole="button"
            accessibilityLabel={`Filter watchlist by ${meta.title}`}
            accessibilityState={{ selected: active }}
          >
            <Icon
              size={14}
              color={active ? accent : iconColor}
              strokeWidth={2.4}
              opacity={active ? 1 : 0.7}
            />
            <Text
              color="$color"
              fos="$2"
              fow={active ? "800" : "600"}
              opacity={active ? 1 : 0.8}
            >
              {meta.label}
            </Text>
            <Text
              color={active ? accent : iconColor}
              fos="$1"
              fow="800"
              opacity={active ? 1 : 0.5}
            >
              {counts[option]}
            </Text>
          </XStack>
        );
      })}
    </ScrollView>
  );
}
