/**
 * Learn more about light and dark modes:
 * https://docs.expo.dev/guides/color-schemes/
 */

import { Colors } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { useAuth } from '@/context/AuthContext';

export function useTheme() {
  const scheme = useColorScheme();
  const { themeMode } = useAuth();
  const theme = themeMode === 'system'
    ? (scheme === 'dark' ? 'dark' : 'light')
    : themeMode;

  return Colors[theme];
}
