import React from "react";
import { Modal, Platform, Pressable, ScrollView, StyleSheet, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import {
  Bell,
  ChevronRight,
  ImageOff,
  LogOut,
  RotateCcw,
  SunMoon,
  Trash,
  type LucideIcon,
} from "lucide-react-native";
import { Button, Text, XStack, YStack } from "tamagui";
import { clearImageCache } from "@/lib/image-cache";
import { type User } from "@/lib/media-api";
import { useTheme } from "@/hooks/use-theme";
import SettingsSwitch from "@/components/Profile/SettingsSwitch";
import {
  Group,
  IconTile,
  LIST_ROW_GAP,
  LIST_ROW_PADDING,
  SectionHeader,
  Separator,
} from "@/components/Profile/grouped-list";

interface PreferencesSectionProps {
  isOpen: boolean;
  onClose: () => void;
  profileUser: User;
  themeMode: "light" | "dark" | "system";
  onToggleNotifications: (checked: boolean) => void;
  onCycleAppearance: () => void;
  onClearHistory: () => void;
  onDeleteAccount: () => void;
  onLogout: () => void;
  /**
   * Reports the outcome of clearing the artwork cache.
   *
   * The sheet raises the notice rather than showing it: a dialog rendered
   * inside this modal would be a Compose window inside a React Native modal
   * window on Android, and the profile screen already owns the dialog host.
   */
  onImageCacheCleared: (cleared: boolean) => void;
}

const DESTRUCTIVE = "#FF3B30";

type SettingsRowProps = {
  // icon: LucideIcon;
  title: string;
  subtitle?: string;
  tint?: string;
  destructive?: boolean;
  onPress?: () => void;
  trailing?: React.ReactNode;
};

function SettingsRow({
  // icon,
  title,
  subtitle,
  tint = "#8E8E93",
  destructive = false,
  onPress,
  trailing,
}: SettingsRowProps) {
  const theme = useTheme();

  return (
    <Pressable
      onPress={onPress}
      disabled={!onPress}
      style={({ pressed }) => (pressed && onPress ? styles.pressed : undefined)}
    >
      <XStack ai="center" gap={LIST_ROW_GAP} px={LIST_ROW_PADDING} minHeight={subtitle ? 60 : 52}>
        {/* <IconTile icon={icon} tint={destructive ? DESTRUCTIVE : tint} /> */}
        <YStack f={1} gap={1}>
          <Text color={destructive ? "$red10" : "$color"} fow="500" fos="$3">
            {title}
          </Text>
          {subtitle ? (
            <Text color="$color" opacity={0.5} fos="$1">
              {subtitle}
            </Text>
          ) : null}
        </YStack>
        {trailing !== undefined ? (
          trailing
        ) : onPress ? (
          <ChevronRight size={16} color={theme.textSecondary} strokeWidth={2.4} />
        ) : null}
      </XStack>
    </Pressable>
  );
}

export default function PreferencesSection({
  isOpen,
  onClose,
  profileUser,
  themeMode,
  onToggleNotifications,
  onCycleAppearance,
  onClearHistory,
  onDeleteAccount,
  onLogout,
  onImageCacheCleared,
}: PreferencesSectionProps) {
  const insets = useSafeAreaInsets();
  const theme = useTheme();

  /**
   * Clears the downloaded-artwork cache.
   *
   * This is the only way a user can reclaim it: expo-image exposes no size or
   * limit API, and iOS offers no per-app "clear cache" action in Settings, so
   * without this the only recourse would be reinstalling the app.
   */
  const handleClearImageCache = async () => {
    onImageCacheCleared(await clearImageCache());
  };

  /**
   * Whether the platform can present a real native sheet.
   *
   * `presentationStyle="formSheet"` is iOS-only; Android ignores it and always
   * presents full-screen, so Android keeps the hand-rolled sheet over a dimmed
   * backdrop. This is the `ui-native-modals` rule applied where the platform
   * actually supports it: on iOS the system supplies the grabber,
   * swipe-to-dismiss, detent handling, keyboard avoidance and accessibility
   * containment.
   */
  const isIOS = Platform.OS === "ios";

  return (
    <Modal
      visible={isOpen}
      presentationStyle={isIOS ? "formSheet" : undefined}
      // A native form sheet is not transparent: it is its own presented
      // container, so neither the custom backdrop nor the overlay wrapper is
      // rendered for it.
      transparent={!isIOS}
      animationType="slide"
      onRequestClose={onClose}
    >
      <View style={isIOS ? styles.nativeContainer : styles.overlay}>
        {isIOS ? null : (
          <Pressable
            style={StyleSheet.absoluteFill}
            onPress={onClose}
            accessibilityLabel="Close settings"
          />
        )}

        <YStack
          bg="$background"
          style={
            isIOS
              ? styles.nativeSheet
              : [styles.sheet, { paddingBottom: Math.max(insets.bottom, 16) }]
          }
        >
          {isIOS ? null : (
            // The native sheet draws its own grabber; only the hand-rolled sheet
            // needs one.
            <YStack ai="center" pt={8}>
              <YStack w={36} h={4} br={2} bg="$color" opacity={0.2} />
            </YStack>
          )}

          <XStack ai="center" jc="space-between" px={18} py={10}>
            <Text fow="800" fos="$7" color="$color">
              Settings
            </Text>
            <Button
              size="$3"
              chromeless
              onPress={onClose}
              pressStyle={{ opacity: 0.5 }}
              accessibilityLabel="Done"
            >
              <Text color="$color" fow="700" fos="$4">
                Done
              </Text>
            </Button>
          </XStack>

          <ScrollView
            showsVerticalScrollIndicator={false}
            style={styles.scroller}
            contentContainerStyle={styles.content}
          >
            <YStack gap={24}>
              <YStack gap={8}>
                <SectionHeader>Preferences</SectionHeader>
                <Group>
                  {/* <SettingsRow
                    // icon={Bell}
                    // tint="#FF9500"
                    title="Notifications"
                    trailing={
                      <SettingsSwitch
                        value={!!profileUser.notifications_enabled}
                        onValueChange={onToggleNotifications}
                        label="Notifications"
                      />
                    }
                  />
                  <Separator /> */}
                  <SettingsRow
                    // icon={SunMoon}
                    // tint="#5856D6"
                    title="Appearance"
                    onPress={onCycleAppearance}
                    trailing={
                      <XStack ai="center" gap={6}>
                        <Text color="$color" opacity={0.5} fos="$3" tt="capitalize">
                          {themeMode}
                        </Text>
                        <ChevronRight size={16} color={theme.textSecondary} strokeWidth={2.4} />
                      </XStack>
                    }
                  />
                </Group>
              </YStack>

              <YStack gap={8}>
                <SectionHeader>Storage</SectionHeader>
                <Group>
                  <SettingsRow
                    // icon={ImageOff}
                    // tint="#0A84FF"
                    title="Clear image cache"
                    subtitle="Reclaims downloaded artwork. Images re-download as you browse."
                    trailing={null}
                    onPress={handleClearImageCache}
                  />
                </Group>
              </YStack>

              <YStack gap={8}>
                <SectionHeader>Privacy & data</SectionHeader>
                <Group>
                  <SettingsRow
                    // icon={RotateCcw}
                    // destructive
                    title="Clear watch history"
                    trailing={null}
                    onPress={() => {
                      onClose();
                      onClearHistory();
                    }}
                  />
                  <Separator />
                  <SettingsRow
                    // icon={Trash}
                    // destructive
                    title="Delete account"
                    trailing={null}
                    onPress={() => {
                      onClose();
                      onDeleteAccount();
                    }}
                  />
                </Group>
              </YStack>

              <Group>
                <Pressable
                  onPress={() => {
                    onClose();
                    onLogout();
                  }}
                  style={({ pressed }) => (pressed ? styles.pressed : undefined)}
                >
                  <XStack ai="center" jc="center" gap={8} minHeight={52} px={LIST_ROW_PADDING}>
                    <LogOut size={17} color="#FF3B30" strokeWidth={2.4} />
                    <Text color="$red10" fow="600" fos="$3">
                      Log out
                    </Text>
                  </XStack>
                </Pressable>
              </Group>
            </YStack>
          </ScrollView>
        </YStack>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  /** Full-bleed host for the native form sheet (iOS). */
  nativeContainer: {
    flex: 1,
  },
  /**
   * The native form sheet supplies its own rounded container, so this only has
   * to fill it. The radius, max height and max width below belong to the
   * hand-rolled Android sheet and would fight the system sheet if applied here.
   */
  nativeSheet: {
    flex: 1,
  },
  overlay: {
    flex: 1,
    backgroundColor: "rgba(0, 0, 0, 0.4)",
    justifyContent: "flex-end",
  },
  sheet: {
    width: "100%",
    maxWidth: 560,
    alignSelf: "center",
    maxHeight: "88%",
    borderTopLeftRadius: 16,
    borderTopRightRadius: 16,
    // iOS-only smoothing; ignored elsewhere. Matches the rounded cards.
    borderCurve: "continuous",
    overflow: "hidden",
  },
  /** Shrinks against the sheet's maxHeight so the content scrolls instead of clipping. */
  scroller: { flexShrink: 1 },
  content: { paddingHorizontal: 18, paddingBottom: 16 },
  pressed: { opacity: 0.6 },
});
