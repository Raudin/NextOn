import { DarkTheme, DefaultTheme, ThemeProvider } from "expo-router";
import Stack from "expo-router/stack";
import { Image } from "expo-image";
import { useEffect } from "react";
import { AuthProvider, useThemeMode } from "@/context/AuthContext";
import { SyncProvider } from "@/context/SyncContext";
import * as SplashScreen from "expo-splash-screen";
import { AppState, StyleSheet, useColorScheme } from "react-native";
import { GestureHandlerRootView } from "react-native-gesture-handler";
import { TamaguiProvider } from "tamagui";
import config from "../constants/tamagui.config";

import { AnimatedSplashOverlay } from "@/components/animated-icon";
import { clearMemory, runCacheMaintenance } from "@/lib/cache";
import { maintainImageCache } from "@/lib/image-cache";

SplashScreen.preventAutoHideAsync();

/**
 * One-time storage maintenance on launch: drop keys no current code writes,
 * enforce the key-value byte budget, and clear the image disk cache if it has
 * not been cleared in a month.
 *
 * Deferred until the first screen has settled, because the prune reads and
 * JSON-parses every cache entry to work out what to evict — a multi-megabyte
 * spike in the JS heap at exactly the moment the app is starting, competing
 * with the first render for both memory and the JS thread. Nothing here is
 * urgent: it reclaims what the *previous* session accumulated, so running it a
 * few hundred milliseconds later costs nothing and keeps launch smooth.
 *
 * Failures are swallowed — cache upkeep must never be able to delay or break
 * startup.
 */
function useStorageMaintenance() {
  useEffect(() => {
    // Deferred to an idle slot rather than straight away.
    //
    // `InteractionManager.runAfterInteractions` used to do this and is
    // deprecated (React Native warns about it on use): it was never quite the
    // right primitive, because it tracks the interaction *handle* count and
    // says nothing about whether the JS thread actually has room to work.
    //
    // `requestIdleCallback` asks the question this code cares about — is there
    // spare time in this frame? — and yields a deadline so the maintenance can
    // be abandoned part-way rather than monopolising a frame it cannot finish
    // in. React Native exposes it natively, and `cancelIdleCallback` undoes an
    // unscheduled call, so the effect still cleans up after itself.
    const idleHandle = requestIdleCallback(
      () => {
        void (async () => {
          try {
            const { purgedLegacy, pruned } = await runCacheMaintenance();
            if (purgedLegacy > 0 || pruned.removed > 0) {
              console.log(
                `[storage] purged ${purgedLegacy} legacy keys, evicted ${pruned.removed} entries (${pruned.freedBytes} bytes)`,
              );
            }

            const imageCache = await maintainImageCache();
            if (imageCache.cleared) {
              console.log("[storage] cleared the image disk cache");
            }
          } catch (err) {
            console.warn("[storage] maintenance failed:", err);
          }
        })();
      },
      // A ceiling, so maintenance still runs on a device that never goes idle
      // (a screen with a permanently animating orb keeps the loop busy). Two
      // seconds is well past first paint, which is the point of deferring.
      { timeout: 2000 },
    );

    return () => {
      cancelIdleCallback(idleHandle);
    };
  }, []);
}

/**
 * Gives memory back the moment the OS asks for it.
 *
 * `memoryWarning` is the last warning before the system starts killing
 * processes, and both caches named here are pure optimisations: the key-value
 * entries are still in SQLite and the artwork is still on disk. Dropping the
 * in-memory copies therefore costs a re-read and nothing else — which is why
 * this is not `clearAll`. The device is short on RAM, not storage, and making
 * the user re-download everything they had already fetched would be the wrong
 * trade.
 */
function useMemoryPressureRelief() {
  useEffect(() => {
    const subscription = AppState.addEventListener("memoryWarning", () => {
      clearMemory();
      Image.clearMemoryCache().catch((err) => {
        console.warn("[memory] failed to clear the image memory cache:", err);
      });
    });
    return () => subscription.remove();
  }, []);
}

function ThemeAppContainer() {
  // The theme alone, so an unrelated session change (a profile refresh, a
  // token change) does not re-run this whole subtree.
  const { themeMode } = useThemeMode();
  const systemScheme = useColorScheme();
  const activeTheme = themeMode === "system"
    ? (systemScheme === "dark" ? "dark" : "light")
    : themeMode;

  useStorageMaintenance();
  useMemoryPressureRelief();

  return (
    <TamaguiProvider
      config={config}
      defaultTheme={activeTheme}
    >
      <ThemeProvider value={activeTheme === "dark" ? DarkTheme : DefaultTheme}>
        <AnimatedSplashOverlay />
        {/*
          `freezeOnBlur` suspends a screen that is not on top instead of leaving
          it mounted and re-rendering. The detail screens are the reason: the
          "Related" rows let a user walk from title to title, and every level
          left below the current one would otherwise keep its hero image,
          poster carousels, cast avatars and details JSON live and reactive.
        */}
        <Stack screenOptions={{ headerShown: false, freezeOnBlur: true }}>
          <Stack.Screen name="(tabs)" />
          <Stack.Screen name="auth" />
          <Stack.Screen name="effects" />
          <Stack.Screen name="media/[type]/[id]" />
          <Stack.Screen name="media/[type]/[id]/episode/[season]/[episode]" />
        </Stack>
      </ThemeProvider>
    </TamaguiProvider>
  );
}

export default function TabLayout() {
  return (
    /**
     * Gesture handler's root view must sit above everything that uses it —
     * without it, gestures silently do not fire on Android. Nothing in the app
     * consumes `react-native-gesture-handler` yet, so today this is a no-op;
     * it is here because the animated press states (see `BackButton`,
     * `HeroIconButton`, `WatchlistButton`) are being migrated from the RN
     * `Animated` API to `GestureDetector` + Reanimated shared values, and that
     * migration is inert without this wrapper.
     *
     * `flex: 1` is required: the root view is a plain View, so it does not
     * stretch to the screen on its own and the whole app would collapse.
     */
    <GestureHandlerRootView style={styles.root}>
      <AuthProvider>
        {/* SyncProvider sits inside AuthProvider because sync is
            account-scoped: it must not run, and must not replay queued
            mutations, while signed out. */}
        <SyncProvider>
          <ThemeAppContainer />
        </SyncProvider>
      </AuthProvider>
    </GestureHandlerRootView>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
  },
});
