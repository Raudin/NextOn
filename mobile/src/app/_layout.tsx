import { DarkTheme, DefaultTheme, ThemeProvider } from "expo-router";
import Stack from "expo-router/stack";
import { AuthProvider, useAuth } from "@/context/AuthContext";
import * as SplashScreen from "expo-splash-screen";
import { useColorScheme } from "react-native";
import { TamaguiProvider } from "tamagui";
import config from "../constants/tamagui.config";

import { AnimatedSplashOverlay } from "@/components/animated-icon";

SplashScreen.preventAutoHideAsync();

function ThemeAppContainer() {
  const { themeMode } = useAuth();
  const systemScheme = useColorScheme();
  const activeTheme = themeMode === "system"
    ? (systemScheme === "dark" ? "dark" : "light")
    : themeMode;

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
      <ThemeAppContainer />
    </AuthProvider>
  );
}
