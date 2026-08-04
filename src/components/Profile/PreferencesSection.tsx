import React from "react";
import { StyleSheet } from "react-native";
import { Switch, Text, XStack, YStack } from "tamagui";
import { type User } from "@/lib/media-api";

interface PreferencesSectionProps {
  profileUser: User;
  themeMode: "light" | "dark" | "system";
  onToggleNotifications: (checked: boolean) => void;
  onCycleAppearance: () => void;
  onClearHistory: () => void;
  onDeleteAccount: () => void;
}

export default function PreferencesSection({
  profileUser,
  themeMode,
  onToggleNotifications,
  onCycleAppearance,
  onClearHistory,
  onDeleteAccount,
}: PreferencesSectionProps) {
  return (
    <YStack gap="$3">
      <Text fow="800" fos="$4" color="$color" opacity={0.8} letterSpacing={0.5}>
        PREFERENCES & ACCOUNT
      </Text>

      <YStack gap="$2">
        {/* Notifications Toggle Card */}
        <XStack
          bg="$backgroundElement"
          p="$3"
          borderRadius="$4"
          borderWidth={1}
          borderColor="$slate5"
          ai="center"
          jc="space-between"
          style={styles.cardShadow}
        >
          <XStack gap="$3" ai="center" f={1}>
            <Text fos="$5">🔔</Text>
            <YStack f={1}>
              <Text color="$color" fow="bold" fos="$3">
                Notifications
              </Text>
              <Text color="$color" opacity={0.5} fos="$1">
                Toggle episode air date alerts
              </Text>
            </YStack>
          </XStack>
          <Switch
            size="$3"
            theme="purple"
            checked={!!profileUser.notifications_enabled}
            onCheckedChange={onToggleNotifications}
          >
            <Switch.Thumb />
          </Switch>
        </XStack>

        {/* Theme/Appearance Selector Card */}
        <XStack
          bg="$backgroundElement"
          p="$3"
          borderRadius="$4"
          borderWidth={1}
          borderColor="$slate5"
          ai="center"
          jc="space-between"
          pressStyle={{ opacity: 0.8 }}
          onPress={onCycleAppearance}
          style={styles.cardShadow}
        >
          <XStack gap="$3" ai="center" f={1}>
            <Text fos="$5">🎨</Text>
            <YStack f={1}>
              <Text color="$color" fow="bold" fos="$3">
                Appearance
              </Text>
              <Text color="$color" opacity={0.5} fos="$1">
                Display current theme mode
              </Text>
            </YStack>
          </XStack>
          <XStack ai="center" gap="$1" bg="$background" px="$3" py="$1" borderRadius="$3">
            <Text color="$color" fow="bold" fos="$2" tt="capitalize">
              {themeMode}
            </Text>
          </XStack>
        </XStack>

        {/* Privacy Control Card: Clear Watch History */}
        <XStack
          bg="$backgroundElement"
          p="$3"
          borderRadius="$4"
          borderWidth={1}
          borderColor="$slate5"
          ai="center"
          jc="space-between"
          pressStyle={{ opacity: 0.8 }}
          onPress={onClearHistory}
          style={styles.cardShadow}
        >
          <XStack gap="$3" ai="center" f={1}>
            <Text fos="$5">🔒</Text>
            <YStack f={1}>
              <Text color="$color" fow="bold" fos="$3">
                Clear Watch History
              </Text>
              <Text color="$color" opacity={0.5} fos="$1">
                Reset stats, level, and streaks
              </Text>
            </YStack>
          </XStack>
          <Text color="$red10" fow="bold" fos="$2" px="$3" py="$1" bg="$red2" borderRadius="$3">
            Clear
          </Text>
        </XStack>

        {/* Privacy Control Card: Delete Account */}
        <XStack
          bg="$backgroundElement"
          p="$3"
          borderRadius="$4"
          borderWidth={1}
          borderColor="$slate5"
          ai="center"
          jc="space-between"
          pressStyle={{ opacity: 0.8 }}
          onPress={onDeleteAccount}
          style={styles.cardShadow}
        >
          <XStack gap="$3" ai="center" f={1}>
            <Text fos="$5">⚠️</Text>
            <YStack f={1}>
              <Text color="$color" fow="bold" fos="$3">
                Delete Account
              </Text>
              <Text color="$color" opacity={0.5} fos="$1">
                Permanently erase all your data
              </Text>
            </YStack>
          </XStack>
          <Text color="$red10" fow="bold" fos="$2" px="$3" py="$1" bg="$red2" borderRadius="$3">
            Delete
          </Text>
        </XStack>
      </YStack>
    </YStack>
  );
}

const styles = StyleSheet.create({
  cardShadow: {
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.1,
    shadowRadius: 2,
    elevation: 1,
  },
});
