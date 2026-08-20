import { useColorScheme as useRNColorScheme } from 'react-native';
import { useAuth } from '@/context/AuthContext';

/**
 * To support static rendering, this value needs to be re-calculated on the client side for web
 */
export function useColorScheme() {
  const systemScheme = useRNColorScheme();
  const auth = useAuth();
  const themeMode = auth?.themeMode ?? "system";

  let resolvedScheme = systemScheme === "dark" ? "dark" : "light";

  if (themeMode !== "system") {
    resolvedScheme = themeMode;
  }

  if (typeof window !== "undefined") {
    return resolvedScheme;
  }

  return 'light';
}
