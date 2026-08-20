import React from "react";
import { Modal, Pressable, StyleSheet, ScrollView } from "react-native";
import { Button, Switch, Text, XStack, YStack } from "tamagui";
import { type User } from "@/lib/media-api";

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
  if (!isOpen) return null;

  return (
    <Modal
      visible={isOpen}
      transparent
      animationType="fade"
      onRequestClose={onClose}
    >
      <Pressable style={styles.overlay} onPress={onClose}>
        <Pressable style={{ width: "100%", maxWidth: 520 }} onPress={(e) => e.stopPropagation()}>
          <YStack
            bg="$background"
            borderTopLeftRadius="$6"
            borderTopRightRadius="$6"
            borderRadius="$5"
            borderWidth={1}
            borderColor="$borderColor"
            p="$5"
            gap="$4"
            style={styles.sheetShadow}
          >
            {/* Sheet Header */}
            <XStack jc="space-between" ai="center" w="100%" pb="$2" borderBottomWidth={1} borderBottomColor="$borderColor">
              <XStack ai="center" gap="$2">
                <Text fos="$5">⚙️</Text>
                <Text fow="800" fos="$5" color="$color">
                  Settings & Preferences
                </Text>
              </XStack>
              <Button
                size="$2"
                circular
                chromeless
                onPress={onClose}
                pressStyle={{ opacity: 0.7 }}
              >
                <Text fos="$4" color="$color" opacity={0.6}>
                  ✕
                </Text>
              </Button>
            </XStack>

            <ScrollView showsVerticalScrollIndicator={false} style={{ maxHeight: 480 }}>
              <YStack gap="$4">
                {/* Section: App Preferences */}
                <YStack gap="$2">
                  <Text fow="800" fos="$1" color="$color" opacity={0.5} letterSpacing={1}>
                    APP PREFERENCES
                  </Text>

                  {/* Notifications Toggle */}
                  <XStack
                    bg="$backgroundElement"
                    p="$3"
                    borderRadius="$4"
                    borderWidth={1}
                    borderColor="$borderColor"
                    ai="center"
                    jc="space-between"
                  >
                    <XStack gap="$3" ai="center" f={1}>
                      <Text fos="$5">🔔</Text>
                      <YStack f={1}>
                        <Text color="$color" fow="bold" fos="$3">
                          Notifications
                        </Text>
                        <Text color="$color" opacity={0.5} fos="$1">
                          Air date & show updates
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

                  {/* Theme Selector */}
                  <XStack
                    bg="$backgroundElement"
                    p="$3"
                    borderRadius="$4"
                    borderWidth={1}
                    borderColor="$borderColor"
                    ai="center"
                    jc="space-between"
                    pressStyle={{ opacity: 0.8 }}
                    onPress={onCycleAppearance}
                  >
                    <XStack gap="$3" ai="center" f={1}>
                      <Text fos="$5">🎨</Text>
                      <YStack f={1}>
                        <Text color="$color" fow="bold" fos="$3">
                          Appearance
                        </Text>
                        <Text color="$color" opacity={0.5} fos="$1">
                          Theme mode
                        </Text>
                      </YStack>
                    </XStack>
                    <XStack ai="center" gap="$1" bg="$background" px="$3" py="$1" borderRadius="$3">
                      <Text color="$purple10" fow="bold" fos="$2" tt="capitalize">
                        {themeMode}
                      </Text>
                    </XStack>
                  </XStack>
                </YStack>

                {/* Section: Account & Privacy */}
                <YStack gap="$2">
                  <Text fow="800" fos="$1" color="$color" opacity={0.5} letterSpacing={1}>
                    PRIVACY & DATA
                  </Text>

                  {/* Clear Watch History */}
                  <XStack
                    bg="$backgroundElement"
                    p="$3"
                    borderRadius="$4"
                    borderWidth={1}
                    borderColor="$borderColor"
                    ai="center"
                    jc="space-between"
                    pressStyle={{ opacity: 0.8 }}
                    onPress={() => {
                      onClose();
                      onClearHistory();
                    }}
                  >
                    <XStack gap="$3" ai="center" f={1}>
                      <Text fos="$5">🔒</Text>
                      <YStack f={1}>
                        <Text color="$color" fow="bold" fos="$3">
                          Clear Watch History
                        </Text>
                        <Text color="$color" opacity={0.5} fos="$1">
                          Reset stats, levels, and streaks
                        </Text>
                      </YStack>
                    </XStack>
                    <Text color="$red10" fow="bold" fos="$2" px="$3" py="$1" bg="$red2" borderRadius="$3">
                      Clear
                    </Text>
                  </XStack>

                  {/* Delete Account */}
                  <XStack
                    bg="$backgroundElement"
                    p="$3"
                    borderRadius="$4"
                    borderWidth={1}
                    borderColor="$borderColor"
                    ai="center"
                    jc="space-between"
                    pressStyle={{ opacity: 0.8 }}
                    onPress={() => {
                      onClose();
                      onDeleteAccount();
                    }}
                  >
                    <XStack gap="$3" ai="center" f={1}>
                      <Text fos="$5">⚠️</Text>
                      <YStack f={1}>
                        <Text color="$color" fow="bold" fos="$3">
                          Delete Account
                        </Text>
                        <Text color="$color" opacity={0.5} fos="$1">
                          Permanently erase all profile data
                        </Text>
                      </YStack>
                    </XStack>
                    <Text color="$red10" fow="bold" fos="$2" px="$3" py="$1" bg="$red2" borderRadius="$3">
                      Delete
                    </Text>
                  </XStack>
                </YStack>

                {/* Log Out Button */}
                <YStack pt="$2">
                  <Button
                    size="$4"
                    borderColor="$red8"
                    color="$red10"
                    bg="$red2"
                    hoverStyle={{ bg: "$red3", borderColor: "$red10" }}
                    pressStyle={{ bg: "$red4" }}
                    fontWeight="bold"
                    borderRadius="$4"
                    onPress={() => {
                      onClose();
                      onLogout();
                    }}
                    w="100%"
                  >
                    Log Out 🚪
                  </Button>
                </YStack>
              </YStack>
            </ScrollView>
          </YStack>
        </Pressable>
      </Pressable>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: "rgba(0, 0, 0, 0.65)",
    justifyContent: "flex-end",
    alignItems: "center",
    padding: 16,
  },
  sheetShadow: {
    shadowColor: "#000",
    shadowOffset: { width: 0, height: -4 },
    shadowOpacity: 0.3,
    shadowRadius: 10,
    elevation: 8,
  },
});
