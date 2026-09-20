import React from "react";
import { Alert, Modal, Pressable, ScrollView, StyleSheet, Switch, View } from "react-native";
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
}

const DESTRUCTIVE = "#FF3B30";

type SettingsRowProps = {
  icon: LucideIcon;
  title: string;
  subtitle?: string;
  tint?: string;
  destructive?: boolean;
  onPress?: () => void;
  trailing?: React.ReactNode;
};

function SettingsRow({
  icon,
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
        <IconTile icon={icon} tint={destructive ? DESTRUCTIVE : tint} />
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
    const cleared = await clearImageCache();
    Alert.alert(
      cleared ? "Image cache cleared" : "Could not clear the cache",
      cleared
        ? "Downloaded artwork has been removed. Images will load again as you browse."
        : "Something went wrong while clearing the cache. Please try again.",
    );
  };

  return (
    <Modal visible={isOpen} transparent animationType="slide" onRequestClose={onClose}>
      <View style={styles.overlay}>
        <Pressable
          style={StyleSheet.absoluteFill}
          onPress={onClose}
          accessibilityLabel="Close settings"
        />

        <YStack
          bg="$background"
          style={[
            styles.sheet,
            { paddingBottom: Math.max(insets.bottom, 16) },
          ]}
        >
          <YStack ai="center" pt={8}>
            <YStack w={36} h={4} br={2} bg="$color" opacity={0.2} />
          </YStack>

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
              <Text color="$purple10" fow="700" fos="$4">
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
                  <SettingsRow
                    icon={Bell}
                    tint="#FF9500"
                    title="Notifications"
                    trailing={
                      <Switch
                        value={!!profileUser.notifications_enabled}
                        onValueChange={onToggleNotifications}
                        trackColor={{ false: theme.backgroundSelected, true: "#34C759" }}
                        ios_backgroundColor={theme.backgroundSelected}
                      />
                    }
                  />
                  <Separator />
                  <SettingsRow
                    icon={SunMoon}
                    tint="#5856D6"
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
                    icon={ImageOff}
                    tint="#0A84FF"
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
                    icon={RotateCcw}
                    destructive
                    title="Clear watch history"
                    trailing={null}
                    onPress={() => {
                      onClose();
                      onClearHistory();
                    }}
                  />
                  <Separator />
                  <SettingsRow
                    icon={Trash}
                    destructive
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
    overflow: "hidden",
  },
  /** Shrinks against the sheet's maxHeight so the content scrolls instead of clipping. */
  scroller: { flexShrink: 1 },
  content: { paddingHorizontal: 18, paddingBottom: 16 },
  pressed: { opacity: 0.6 },
});
