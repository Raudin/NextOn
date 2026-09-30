import {
  ArrowDownAZ,
  Check,
  Clock,
  LayoutGrid,
  List,
  type LucideIcon,
} from "lucide-react-native";
import { useEffect } from "react";
import { Pressable, StyleSheet, useColorScheme, View } from "react-native";
import Animated, {
  Easing,
  interpolate,
  useAnimatedStyle,
  useSharedValue,
  withTiming,
} from "react-native-reanimated";
import { Text, YStack } from "tamagui";

export type WatchlistLayoutMode = "posters" | "list";
export type WatchlistSortMode = "recent" | "alphabetical";

interface WatchlistMenuProps {
  visible: boolean;
  layoutMode: WatchlistLayoutMode;
  sortMode: WatchlistSortMode;
  onClose: () => void;
  onLayoutChange: (mode: WatchlistLayoutMode) => void;
  onSortChange: (mode: WatchlistSortMode) => void;
}

interface MenuRowProps {
  label: string;
  icon: LucideIcon;
  active: boolean;
  textColor: string;
  iconColor: string;
  activeBg: string;
  onPress: () => void;
}

function MenuRow({
  label,
  icon: Icon,
  active,
  textColor,
  iconColor,
  activeBg,
  onPress,
}: MenuRowProps) {
  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => [
        styles.row,
        active && { backgroundColor: activeBg },
        pressed && styles.rowPressed,
      ]}
      accessibilityRole="button"
      accessibilityState={{ selected: active }}
    >
      <Icon size={17} color={iconColor} strokeWidth={2.2} />
      <Text
        color={textColor}
        fos="$3"
        fow={active ? "700" : "500"}
        style={styles.rowLabel}
      >
        {label}
      </Text>
      {active ? <Check size={15} color={iconColor} strokeWidth={3} /> : null}
    </Pressable>
  );
}

function SectionLabel({ children, color }: { children: string; color: string }) {
  return (
    <Text
      color={color}
      fos="$1"
      fow="800"
      opacity={0.45}
      px="$3"
      pt="$2"
      pb="$1"
      letterSpacing={0.8}
    >
      {children.toUpperCase()}
    </Text>
  );
}

/**
 * Options menu for the watchlist header. Renders as an anchored, translucent
 * material sheet with a spring-in animation, a real icon set, and a checkmark
 * on the active choice - closer to a native popover than a plain list.
 */
export default function WatchlistMenu({
  visible,
  layoutMode,
  sortMode,
  onClose,
  onLayoutChange,
  onSortChange,
}: WatchlistMenuProps) {
  const scheme = useColorScheme();
  const isDark = scheme === "dark";
  /**
   * Ground truth for the panel's transition: 0 = hidden, 1 = shown. Opacity,
   * scale and offset are *derived* from it in `panelStyle` below — see the
   * `state-ground-truth` rule — so a further property needs another
   * interpolation rather than another animated value.
   */
  const shown = useSharedValue(0);

  useEffect(() => {
    // The panel is only mounted while `visible`, so this only ever animates in;
    // closing remains an immediate unmount, as it was before.
    if (!visible) return;
    shown.set(withTiming(1, { duration: 170, easing: Easing.out(Easing.cubic) }));
  }, [shown, visible]);

  const panelStyle = useAnimatedStyle(() => ({
    opacity: shown.get(),
    transform: [
      { scale: interpolate(shown.get(), [0, 1], [0.94, 1]) },
      { translateY: interpolate(shown.get(), [0, 1], [-6, 0]) },
    ],
  }));

  if (!visible) {
    return null;
  }

  const panelBg = isDark ? "rgba(28, 28, 32, 0.94)" : "rgba(250, 250, 252, 0.96)";
  const borderColor = isDark
    ? "rgba(255, 255, 255, 0.14)"
    : "rgba(0, 0, 0, 0.10)";
  const textColor = isDark ? "#FFFFFF" : "#111111";
  const iconColor = isDark ? "rgba(255,255,255,0.78)" : "rgba(0,0,0,0.62)";
  const itemActiveBg = isDark
    ? "rgba(255, 255, 255, 0.12)"
    : "rgba(0, 0, 0, 0.07)";

  const select = (action: () => void) => () => {
    action();
    onClose();
  };

  return (
    <>
      <Pressable
        onPress={onClose}
        style={styles.backdrop}
        accessibilityLabel="Close menu"
      />

      <Animated.View style={[styles.panelWrap, panelStyle]}>
        <View
          style={[
            styles.panel,
            { backgroundColor: panelBg, borderColor },
          ]}
        >
          <YStack>
            <SectionLabel color={textColor}>Layout</SectionLabel>
            <MenuRow
              label="Posters"
              icon={LayoutGrid}
              active={layoutMode === "posters"}
              textColor={textColor}
              iconColor={iconColor}
              activeBg={itemActiveBg}
              onPress={select(() => onLayoutChange("posters"))}
            />
            <MenuRow
              label="List"
              icon={List}
              active={layoutMode === "list"}
              textColor={textColor}
              iconColor={iconColor}
              activeBg={itemActiveBg}
              onPress={select(() => onLayoutChange("list"))}
            />

            <View style={[styles.divider, { backgroundColor: borderColor }]} />

            <SectionLabel color={textColor}>Sort by</SectionLabel>
            <MenuRow
              label="Recently added"
              icon={Clock}
              active={sortMode === "recent"}
              textColor={textColor}
              iconColor={iconColor}
              activeBg={itemActiveBg}
              onPress={select(() => onSortChange("recent"))}
            />
            <MenuRow
              label="Alphabetical"
              icon={ArrowDownAZ}
              active={sortMode === "alphabetical"}
              textColor={textColor}
              iconColor={iconColor}
              activeBg={itemActiveBg}
              onPress={select(() => onSortChange("alphabetical"))}
            />
          </YStack>
        </View>
      </Animated.View>
    </>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    position: "absolute",
    top: -8,
    right: -8,
    bottom: -8,
    left: -8,
    zIndex: 20,
  },
  panelWrap: {
    position: "absolute",
    top: 52,
    right: 0,
    zIndex: 30,
    width: 232,
    transformOrigin: "top right",
  },
  panel: {
    borderRadius: 18,
    // iOS-only smoothing; ignored elsewhere. Softens the popover's corners.
    borderCurve: "continuous",
    borderWidth: StyleSheet.hairlineWidth,
    padding: 6,
    // CSS box-shadow syntax replacing the legacy shadow* props plus Android
    // `elevation`, which had to be kept in step with them by hand.
    boxShadow: "0 10px 22px rgba(0, 0, 0, 0.38)",
  },
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    paddingVertical: 10,
    paddingHorizontal: 12,
    borderRadius: 12,
  },
  rowPressed: {
    opacity: 0.6,
  },
  rowLabel: {
    flex: 1,
  },
  divider: {
    height: StyleSheet.hairlineWidth,
    marginVertical: 4,
    marginHorizontal: 8,
  },
});
