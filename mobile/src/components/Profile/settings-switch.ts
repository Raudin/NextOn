/**
 * Shared contract for the settings toggle.
 *
 * `SettingsSwitch.tsx` is what iOS and web render; `SettingsSwitch.android.tsx`
 * renders the Material 3 `Switch` from `@expo/ui`. Both are typed against this
 * file, and the accent colour lives here so the platforms cannot drift.
 */

/** The app's "on" tint, unchanged from before the Android branch existed. */
export const SWITCH_ON_COLOR = "#34C759";

export interface SettingsSwitchProps {
  value: boolean;
  onValueChange: (value: boolean) => void;
  /** Blocks interaction while a write is in flight. */
  disabled?: boolean;
  /**
   * Accessibility label. Compose's `Switch` has no label slot in this API, so
   * the Android variant cannot carry it; the visible row title is the label
   * there.
   */
  label?: string;
}
