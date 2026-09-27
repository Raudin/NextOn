import { Host, Switch } from "@expo/ui/jetpack-compose";

import { useTheme } from "@/hooks/use-theme";

import { SWITCH_ON_COLOR, type SettingsSwitchProps } from "./settings-switch";

/**
 * The settings toggle for Android, drawn with the Material 3 `Switch` from
 * `@expo/ui`.
 *
 * Compose has no `trackColor` / `ios_backgroundColor` pair, so the two colours
 * the other platforms use are mapped onto its checked and unchecked tracks.
 * `matchContents` lets the switch report its intrinsic size back to Yoga,
 * because Compose is unaware of the row it was dropped into.
 *
 * `label` is intentionally not read: Compose's `Switch` exposes no label or
 * content-description prop, and the surrounding row already names the setting.
 */
export default function SettingsSwitch({
  value,
  onValueChange,
  disabled,
}: SettingsSwitchProps) {
  const theme = useTheme();

  return (
    <Host matchContents>
      <Switch
        value={value}
        onCheckedChange={onValueChange}
        enabled={disabled !== true}
        colors={{
          checkedTrackColor: SWITCH_ON_COLOR,
          uncheckedTrackColor: theme.backgroundSelected,
          uncheckedThumbColor: theme.background,
          uncheckedBorderColor: theme.backgroundSelected,
        }}
      />
    </Host>
  );
}
