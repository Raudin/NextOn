import { DarkTheme, DefaultTheme, ThemeProvider } from "expo-router";
import Stack from "expo-router/stack";
import { useEffect } from "react";
import { AuthProvider, useAuth } from "@/context/AuthContext";
import { SyncProvider } from "@/context/SyncContext";
import * as SplashScreen from "expo-splash-screen";
import { useColorScheme } from "react-native";
import { TamaguiProvider } from "tamagui";
import config from "../constants/tamagui.config";

import { AnimatedSplashOverlay } from "@/components/animated-icon";
import { runCacheMaintenance } from "@/lib/cache";
import { maintainImageCache } from "@/lib/image-cache";

SplashScreen.preventAutoHideAsync();

/**
 * One-time storage maintenance on launch: drop keys no current code writes,
 * enforce the key-value byte budget, and clear the image disk cache if it has
 * not been cleared in a month.
 *
 * Runs detached from render and swallows its own failures — cache upkeep must
 * never be able to delay or break startup.
 */
function useStorageMaintenance() {
  useEffect(() => {
    // Fire-and-forget: the only post-unmount effect is a console log, so there
    // is nothing to cancel.
    (async () => {
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
  }, []);
}

function ThemeAppContainer() {
  const { themeMode } = useAuth();
  const systemScheme = useColorScheme();
  const activeTheme = themeMode === "system"
    ? (systemScheme === "dark" ? "dark" : "light")
    : themeMode;

  useStorageMaintenance();

  return (
    <TamaguiProvider
      config={config}
      defaultTheme={activeTheme}
    >
      <ThemeProvider value={activeTheme === "dark" ? DarkTheme : DefaultTheme}>
        <AnimatedSplashOverlay />
        <Stack screenOptions={{ headerShown: false }}>
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
    <AuthProvider>
      {/* SyncProvider sits inside AuthProvider because sync is
          account-scoped: it must not run, and must not replay queued
          mutations, while signed out. */}
      <SyncProvider>
        <ThemeAppContainer />
      </SyncProvider>
    </AuthProvider>
  );
}
