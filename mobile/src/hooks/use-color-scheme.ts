import { useColorScheme as useRNColorScheme } from "react-native";
import { useAuth } from "@/context/AuthContext";

export function useColorScheme() {
  const systemScheme = useRNColorScheme();
  const auth = useAuth();
  const themeMode = auth?.themeMode ?? "system";

  if (themeMode === "system") {
    return systemScheme === "dark" ? "dark" : "light";
  }
  return themeMode;
}
