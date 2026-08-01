import { useColorScheme as useRNColorScheme } from "react-native";
import { useAuth } from "@/context/AuthContext";

export function useColorScheme() {
  const systemScheme = useRNColorScheme();
  try {
    const { themeMode } = useAuth();
    if (themeMode === "system") {
      return systemScheme === "dark" ? "dark" : "light";
    }
    return themeMode;
  } catch {
    return systemScheme === "dark" ? "dark" : "light";
  }
}
