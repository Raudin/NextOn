import { Switch } from "react-native";

import { useTheme } from "@/hooks/use-theme";

import { SWITCH_ON_COLOR, type SettingsSwitchProps } from "./settings-switch";

/**
 * The settings toggle for iOS and web: React Native's `Switch` with the two
 * colours the notifications row has always used. Android renders the same
 * control with Jetpack Compose — see `SettingsSwitch.android.tsx`.
 */
export default function SettingsSwitch({
  value,
  onValueChange,
  disabled,
  label,
}: SettingsSwitchProps) {
  const theme = useTheme();

  return (
    <Switch
      value={value}
      onValueChange={onValueChange}
      disabled={disabled}
      accessibilityLabel={label}
      trackColor={{ false: theme.backgroundSelected, true: SWITCH_ON_COLOR }}
      ios_backgroundColor={theme.backgroundSelected}
    />
  );
}
