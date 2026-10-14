import { useColorScheme as useRNColorScheme } from "react-native";
import { useThemeMode } from "@/context/AuthContext";

export function useColorScheme() {
  const systemScheme = useRNColorScheme();
  // Reads the theme context only, so a session update does not re-resolve the
  // colour scheme for every themed component in the tree.
  const { themeMode } = useThemeMode();

  if (themeMode === "system") {
    return systemScheme === "dark" ? "dark" : "light";
  }
  return themeMode;
}
