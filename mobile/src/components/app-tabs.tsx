import { NativeTabs } from "expo-router/unstable-native-tabs";
import { useColorScheme } from "react-native";

import { useAuth } from "@/context/AuthContext";

/**
 * Tab bar colours, per appearance.
 *
 * This is the palette the hand-rolled bar used, with the app's solid
 * background instead of its translucent approximation, so the bar reads as a
 * true white/black rather than a near-match:
 *
 * | | background | active | inactive |
 * |---|---|---|---|
 * | dark | `#000000` | `#FFFFFF` | `#98989F` |
 * | light | `#FFFFFF` | `#1C1C1E` | `#6C6C70` |
 *
 * `separator` is iOS's bar shadow colour — it stands in for the hairline border
 * the old bar drew. `blur` picks the matching system material for iOS 18 and
 * earlier, where `backgroundColor` and `blurEffect` still apply.
 */
const PALETTE = {
  dark: {
    background: "#000000",
    active: "#FFFFFF",
    inactive: "#98989F",
    ripple: "rgba(255, 255, 255, 0.12)",
    separator: "rgba(255, 255, 255, 0.14)",
    blur: "systemMaterialDark",
  },
  light: {
    background: "#FFFFFF",
    active: "#1C1C1E",
    inactive: "#6C6C70",
    ripple: "rgba(0, 0, 0, 0.10)",
    separator: "rgba(60, 60, 67, 0.18)",
    blur: "systemMaterialLight",
  },
} as const;

/**
 * Tab bar, drawn by the platform.
 *
 * `NativeTabs` uses `UITabBarController` on iOS and a Material `BottomNavigation`
 * on Android, so transitions, the blur/material treatment, the indicator
 * animation and the accessibility tree all come from the system rather than
 * from JavaScript. This replaces the previous hand-built `tabBar` render prop.
 *
 * Three things are worth stating, because they are deliberate choices rather
 * than oversights:
 *
 * 1. **Icons are platform symbols, not the app's own glyphs.** The tab glyphs
 *    live in `tab-icon.tsx` as inline `react-native-svg` paths, and a native tab
 *    bar can only render an image source or a system symbol — it cannot host a
 *    React component. `src` does accept a React element, but the converter only
 *    supports it for an `@expo/vector-icons`-style family (it calls
 *    `family.getImageSource`), which this app does not depend on. `sf` (SF
 *    Symbols, iOS) and `md` (Material Symbols, Android) are used instead. The
 *    unused PNGs under `assets/images/tabIcons/` remain a fallback: point `src`
 *    at them.
 *
 * 2. **Colours do follow the app.** Icon and label tints are set explicitly for
 *    both states on every platform, and the bar background is set on Android and
 *    on iOS 18 and earlier.
 *
 * 3. **On iOS 26 the bar's *background* is the system's.** It is drawn with
 *    Liquid Glass and `backgroundColor`/`blurEffect`/`shadowColor` are ignored;
 *    the tint is sampled from the content behind the bar. Each trigger therefore
 *    sets `contentStyle` to the app background — the documented lever — so the
 *    glass resolves to the app's black in dark mode and white in light mode. The
 *    same reason is why `ThemeProvider` in `app/_layout.tsx` is required: it is
 *    what stops the glass flashing the wrong scheme when switching tabs.
 *
 * `app-tabs.web.tsx` is untouched: Metro resolves it for web, so the web build
 * keeps the existing top bar.
 */
export default function AppTabs() {
  const systemScheme = useColorScheme();
  const { themeMode } = useAuth();

  // `themeMode` wins over the OS: the app can pin an appearance, and the tab bar
  // should follow that the same way the rest of the UI does.
  const isDark =
    themeMode === "dark" || (themeMode === "system" && systemScheme === "dark");
  const c = isDark ? PALETTE.dark : PALETTE.light;

  // Every screen sits on the app background, so the same colour that tints the
  // iOS 26 glass also backs the tab content.
  const contentStyle = { backgroundColor: c.background };

  return (
    <NativeTabs
      // Icon and label tints: honoured on every platform and every iOS version.
      // This is the part that carries the app's white/black identity.
      iconColor={{ default: c.inactive, selected: c.active }}
      tintColor={c.active}
      labelStyle={{
        default: { color: c.inactive, fontSize: 11, fontWeight: "600" },
        selected: { color: c.active, fontSize: 11, fontWeight: "600" },
      }}
      // Bar background. Android, and iOS 18 and earlier only — see note 3 above.
      backgroundColor={c.background}
      blurEffect={c.blur}
      shadowColor={c.separator}
      // Material 3 draws an active-item indicator pill by default; the app's bar
      // has none, so it is switched off and the ripple kept as press feedback.
      disableIndicator
      rippleColor={c.ripple}
      labelVisibilityMode="labeled"
    >
      <NativeTabs.Trigger name="index" contentStyle={contentStyle}>
        <NativeTabs.Trigger.Icon sf="house.fill" md="home" />
        <NativeTabs.Trigger.Label>Home</NativeTabs.Trigger.Label>
      </NativeTabs.Trigger>

      <NativeTabs.Trigger name="discover" contentStyle={contentStyle}>
        <NativeTabs.Trigger.Icon sf="safari.fill" md="explore" />
        <NativeTabs.Trigger.Label>Discover</NativeTabs.Trigger.Label>
      </NativeTabs.Trigger>

      <NativeTabs.Trigger name="watchlist" contentStyle={contentStyle}>
        <NativeTabs.Trigger.Icon sf="bookmark.fill" md="bookmark" />
        <NativeTabs.Trigger.Label>Watchlist</NativeTabs.Trigger.Label>
      </NativeTabs.Trigger>

      <NativeTabs.Trigger name="profile" contentStyle={contentStyle}>
        <NativeTabs.Trigger.Icon sf="person.fill" md="person" />
        <NativeTabs.Trigger.Label>Profile</NativeTabs.Trigger.Label>
      </NativeTabs.Trigger>
    </NativeTabs>
  );
}
