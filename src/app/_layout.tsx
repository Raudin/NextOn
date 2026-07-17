import { DarkTheme, DefaultTheme, ThemeProvider } from "expo-router";
import Stack from "expo-router/stack";
import { AuthProvider } from "@/context/AuthContext";
import * as SplashScreen from "expo-splash-screen";
import { useColorScheme } from "react-native";
import { TamaguiProvider } from "tamagui";
import config from "../constants/tamagui.config";

import { AnimatedSplashOverlay } from "@/components/animated-icon";

SplashScreen.preventAutoHideAsync();

export default function TabLayout() {
  const colorScheme = useColorScheme();
  return (
    <TamaguiProvider
      config={config}
      defaultTheme={colorScheme === "dark" ? "dark" : "light"}
    >
      <ThemeProvider value={colorScheme === "dark" ? DarkTheme : DefaultTheme}>
        <AuthProvider>
          <AnimatedSplashOverlay />
          <Stack screenOptions={{ headerShown: false }}>
            <Stack.Screen name="(tabs)" />
            <Stack.Screen name="auth" />
            <Stack.Screen name="media/[type]/[id]" />
            <Stack.Screen name="media/[type]/[id]/episode/[season]/[episode]" />
          </Stack>
        </AuthProvider>
      </ThemeProvider>
    </TamaguiProvider>
  );
}
