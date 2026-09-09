import React from "react";
import { Modal, Pressable, ScrollView, StyleSheet } from "react-native";
import { SymbolView } from "expo-symbols";
import { Host, Switch as NativeSwitch } from "@expo/ui";
import { Button, Text, XStack, YStack } from "tamagui";
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

type SettingsRowProps = {
  symbol: string;
  title: string;
  subtitle?: string;
  tint?: string;
  onPress?: () => void;
  trailing?: React.ReactNode;
};

function SettingsRow({ symbol, title, subtitle, tint = "#6E6E73", onPress, trailing }: SettingsRowProps) {
  return (
    <Pressable onPress={onPress} disabled={!onPress} style={({ pressed }) => [styles.rowPressable, pressed && styles.pressed]}>
      <XStack ai="center" gap="$3" p="$3" minHeight={64}>
        <YStack w={30} h={30} br="$2" bg="$background" ai="center" jc="center">
          <SymbolView name={{ ios: symbol as never, android: "settings", web: "settings" }} size={17} tintColor={tint} />
        </YStack>
        <YStack f={1} gap="$0.5">
          <Text color="$color" fow="600" fos="$3">{title}</Text>
          {subtitle && <Text color="$color" opacity={0.5} fos="$1">{subtitle}</Text>}
        </YStack>
        {trailing}
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
  if (!isOpen) return null;

  return (
    <Modal visible={isOpen} transparent animationType="slide" onRequestClose={onClose}>
      <Pressable style={styles.overlay} onPress={onClose}>
        <Pressable style={styles.sheetContainer} onPress={(event) => event.stopPropagation()}>
          <YStack bg="$background" borderTopLeftRadius="$6" borderTopRightRadius="$6" p="$4" gap="$4" style={styles.sheet}>
            <YStack ai="center" gap="$3">
              <YStack w={36} h={4} br="$2" bg="$color" opacity={0.2} />
              <XStack jc="space-between" ai="center" w="100%">
                <YStack gap="$0.5">
                  <Text fow="800" fos="$7" color="$color">Settings</Text>
                  <Text fos="$2" color="$color" opacity={0.55}>Manage your NextOn experience</Text>
                </YStack>
                <Button size="$3" circular chromeless onPress={onClose} accessibilityLabel="Close settings">
                  <SymbolView name={{ ios: "xmark", android: "close", web: "close" }} size={18} tintColor="#6E6E73" />
                </Button>
              </XStack>
            </YStack>

            <ScrollView showsVerticalScrollIndicator={false} contentInsetAdjustmentBehavior="automatic" contentContainerStyle={styles.content}>
              <YStack gap="$4">
                <YStack gap="$2">
                  <Text fow="700" fos="$2" color="$color" opacity={0.55} px="$1">PREFERENCES</Text>
                  <YStack bg="$backgroundElement" borderRadius="$4" borderCurve="continuous" overflow="hidden">
                    <SettingsRow
                      symbol="bell"
                      title="Notifications"
                      subtitle="Air date and show updates"
                      trailing={
                        <Host>
                          <NativeSwitch value={!!profileUser.notifications_enabled} onValueChange={onToggleNotifications} />
                        </Host>
                      }
                    />
                    <YStack h={StyleSheet.hairlineWidth} bg="$borderColor" ml={66} />
                    <SettingsRow
                      symbol="circle.lefthalf.filled"
                      title="Appearance"
                      subtitle="Choose light, dark, or system"
                      onPress={onCycleAppearance}
                      trailing={<Text color="$purple10" fow="700" fos="$2" tt="capitalize">{themeMode}</Text>}
                    />
                  </YStack>
                </YStack>

                <YStack gap="$2">
                  <Text fow="700" fos="$2" color="$color" opacity={0.55} px="$1">PRIVACY & DATA</Text>
                  <YStack bg="$backgroundElement" borderRadius="$4" borderCurve="continuous" overflow="hidden">
                    <SettingsRow
                      symbol="clock.arrow.circlepath"
                      title="Clear watch history"
                      subtitle="Reset stats, levels, and streaks"
                      tint="#FF3B30"
                      onPress={() => { onClose(); onClearHistory(); }}
                      trailing={<SymbolView name={{ ios: "chevron.right", android: "chevron_right", web: "chevron_right" }} size={15} tintColor="#8E8E93" />}
                    />
                    <YStack h={StyleSheet.hairlineWidth} bg="$borderColor" ml={66} />
                    <SettingsRow
                      symbol="trash"
                      title="Delete account"
                      subtitle="Permanently erase all profile data"
                      tint="#FF3B30"
                      onPress={() => { onClose(); onDeleteAccount(); }}
                      trailing={<SymbolView name={{ ios: "chevron.right", android: "chevron_right", web: "chevron_right" }} size={15} tintColor="#8E8E93" />}
                    />
                  </YStack>
                </YStack>

                <Button size="$4" bg="$red2" color="$red10" borderColor="$red8" borderWidth={1} onPress={() => { onClose(); onLogout(); }}>
                  Log Out
                </Button>
              </YStack>
            </ScrollView>
          </YStack>
        </Pressable>
      </Pressable>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: { flex: 1, backgroundColor: "rgba(0, 0, 0, 0.4)", justifyContent: "flex-end" },
  sheetContainer: { width: "100%", maxWidth: 560, alignSelf: "center" },
  sheet: { maxHeight: "88%" },
  content: { paddingBottom: 16, gap: 16 },
  rowPressable: { minHeight: 64 },
  pressed: { opacity: 0.65 },
});
