import { useEffect, useState } from 'react';
import { useColorScheme as useRNColorScheme } from 'react-native';
import { useAuth } from '@/context/AuthContext';

/**
 * To support static rendering, this value needs to be re-calculated on the client side for web
 */
export function useColorScheme() {
  const [hasHydrated, setHasHydrated] = useState(false);

  useEffect(() => {
    setHasHydrated(true);
  }, []);

  const systemScheme = useRNColorScheme();
  let resolvedScheme = systemScheme === "dark" ? "dark" : "light";

  try {
    const { themeMode } = useAuth();
    if (themeMode !== "system") {
      resolvedScheme = themeMode;
    }
  } catch {
    // ignore
  }

  if (hasHydrated) {
    return resolvedScheme;
  }

  return 'light';
}
