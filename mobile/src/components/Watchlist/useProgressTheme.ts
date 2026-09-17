import { useTheme } from "tamagui";

export interface ProgressTheme {
  /** Watch progress rounded and clamped to 0-100. */
  percentage: number;
  /** Tier colour: green when nearly done, orange midway, red when early. */
  accent: string;
  trackColor: string;
  surface: string;
  borderTone: string;
}

/**
 * Shared colour tiers for every watch-progress indicator (ring on poster
 * cards, bar on list rows) so both stay visually in sync.
 */
export function useProgressTheme(progress: number): ProgressTheme {
  const theme = useTheme();
  const percentage = Math.max(0, Math.min(100, Math.round(progress * 100)));
  const accent =
    percentage >= 80
      ? (theme.green9?.val ?? "#22C55E")
      : percentage >= 45
        ? (theme.orange9?.val ?? "#F97316")
        : (theme.red9?.val ?? "#EF4444");

  return {
    percentage,
    accent,
    trackColor: theme.color7?.val ?? "rgba(128,128,128,0.45)",
    surface: theme.color3?.val ?? "rgba(128,128,128,0.2)",
    borderTone: theme.borderColor?.val ?? "rgba(128,128,128,0.3)",
  };
}
