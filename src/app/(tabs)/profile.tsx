import React, { useEffect, useState, useCallback } from "react";
import { Alert, Platform, StyleSheet } from "react-native";
import { useRouter, useFocusEffect } from "expo-router";
import { Image } from "expo-image";
import {
  YStack,
  XStack,
  Text,
  Button,
  Spinner,
  Avatar,
  Input,
  ScrollView,
  Switch,
} from "tamagui";
import { useAuth } from "@/context/AuthContext";
import {
  fetchUserProfile,
  updateUserProfile,
  clearWatchHistory,
  deleteUserAccount,
  type ProfileStats,
  type User,
} from "@/lib/media-api";

function getLevelTitle(level: number): string {
  if (level < 3) return "Binge Novice";
  if (level < 6) return "Screen Cadet";
  if (level < 10) return "Episode Enthusiast";
  if (level < 15) return "Serial Streamer";
  if (level < 21) return "Binge Commander";
  if (level < 31) return "Showmaster";
  return "Couch Emperor";
}

function formatWatchTime(totalMinutes: number): string {
  const days = Math.floor(totalMinutes / (24 * 60));
  const hours = Math.floor((totalMinutes % (24 * 60)) / 60);
  return `${days}d ${hours}h`;
}

const AVATAR_PRESETS = [
  "https://api.dicebear.com/7.x/bottts/svg?seed=Gladiator",
  "https://api.dicebear.com/7.x/bottts/svg?seed=Sonic",
  "https://api.dicebear.com/7.x/bottts/svg?seed=Wicked",
  "https://api.dicebear.com/7.x/bottts/svg?seed=Wednesday",
  "https://api.dicebear.com/7.x/bottts/svg?seed=Squid",
  "https://api.dicebear.com/7.x/bottts/svg?seed=InsideOut",
];

const showConfirmDialog = (
  title: string,
  message: string,
  onConfirm: () => void
) => {
  if (Platform.OS === "web") {
    const confirm = window.confirm(`${title}\n\n${message}`);
    if (confirm) onConfirm();
  } else {
    Alert.alert(
      title,
      message,
      [
        { text: "Cancel", style: "cancel" },
        { text: "Confirm", style: "destructive", onPress: onConfirm },
      ],
      { cancelable: true }
    );
  }
};

export default function ProfileScreen() {
  const { token, logout, isLoading: authLoading, themeMode, setThemeMode, updateUser } = useAuth();
  const router = useRouter();

  const [loading, setLoading] = useState(true);
  const [profileUser, setProfileUser] = useState<User | null>(null);
  const [stats, setStats] = useState<ProfileStats | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Edit states
  const [isEditing, setIsEditing] = useState(false);
  const [editName, setEditName] = useState("");
  const [selectedAvatar, setSelectedAvatar] = useState("");
  const [updating, setUpdating] = useState(false);

  useEffect(() => {
    if (!authLoading && !token) {
      router.replace("/auth");
    }
  }, [authLoading, token, router]);

  const loadProfile = useCallback(async () => {
    if (!token) return;
    setLoading(true);
    setError(null);
    try {
      const data = await fetchUserProfile();
      setProfileUser(data.user);
      setStats(data.stats);
      setEditName(data.user.name || "");
      setSelectedAvatar(data.user.avatar_url || "");
      // Sync auth context user state if needed
      updateUser(data.user);
    } catch (err: any) {
      setError(err.message || String(err));
    } finally {
      setLoading(false);
    }
  }, [token, updateUser]);

  useFocusEffect(
    useCallback(() => {
      if (token) {
        loadProfile();
      }
    }, [loadProfile, token])
  );

  if (authLoading || (loading && !profileUser)) {
    return (
      <YStack f={1} ai="center" jc="center" bg="$background">
        <Spinner size="large" color="$color" />
      </YStack>
    );
  }

  if (!token || !profileUser || !stats) {
    return null;
  }

  const handleUpdateProfileDetails = async () => {
    if (!editName.trim()) {
      showConfirmDialog("Validation Error", "Name cannot be empty.", () => {});
      return;
    }
    setUpdating(true);
    try {
      const updated = await updateUserProfile({
        name: editName.trim(),
        avatar_url: selectedAvatar,
      });
      setProfileUser(updated);
      await updateUser(updated);
      setIsEditing(false);
    } catch (err: any) {
      setError(err.message || "Failed to update profile.");
    } finally {
      setUpdating(false);
    }
  };

  const handleToggleNotifications = async (checked: boolean) => {
    try {
      const updated = await updateUserProfile({
        notifications_enabled: checked,
      });
      setProfileUser(updated);
      await updateUser(updated);
    } catch (err: any) {
      setError(err.message || "Failed to toggle notifications.");
    }
  };

  const cycleAppearance = async () => {
    const cycleMap: Record<"light" | "dark" | "system", "light" | "dark" | "system"> = {
      light: "dark",
      dark: "system",
      system: "light",
    };
    const nextMode = cycleMap[themeMode] || "system";
    await setThemeMode(nextMode);
  };

  const handleClearHistory = () => {
    showConfirmDialog(
      "Clear Watch History",
      "Are you absolutely sure you want to clear your entire watch history? This will reset all your level stats and active streaks forever.",
      async () => {
        try {
          await clearWatchHistory();
          loadProfile();
        } catch (err: any) {
          setError(err.message || "Failed to clear watch history.");
        }
      }
    );
  };

  const handleDeleteUserAccount = () => {
    showConfirmDialog(
      "Delete Account",
      "Are you absolutely sure you want to delete your account? This will permanently erase your profile, watch list, and history. This action cannot be undone.",
      async () => {
        try {
          await deleteUserAccount();
          await logout();
          router.replace("/auth");
        } catch (err: any) {
          setError(err.message || "Failed to delete account.");
        }
      }
    );
  };

  const handleLogoutPress = () => {
    showConfirmDialog(
      "Log Out",
      "Are you sure you want to log out of Nexton?",
      async () => {
        await logout();
        router.replace("/auth");
      }
    );
  };

  const levelTitle = getLevelTitle(stats.current_level);

  return (
    <YStack f={1} bg="$background">
      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.scrollContent}>
        <YStack px="$5" py="$6" gap="$6" maxWidth={600} alignSelf="center" w="100%">

          {/* Circular Avatar Section */}
          <YStack ai="center" gap="$4">
            <YStack pos="relative">
              <Avatar circular size={110} bg="$purple3" borderWidth={2} borderColor="$purple10" style={styles.avatarShadow}>
                {profileUser.avatar_url ? (
                  <Image
                    source={{ uri: profileUser.avatar_url }}
                    style={styles.avatarImage}
                    contentFit="cover"
                  />
                ) : (
                  <Avatar.Fallback bc="$purple10" jc="center" ai="center">
                    <Text color="white" fow="bold" fos="$8">
                      {profileUser.email.substring(0, 2).toUpperCase()}
                    </Text>
                  </Avatar.Fallback>
                )}
              </Avatar>

              {!isEditing && (
                <Button
                  pos="absolute"
                  bottom={-4}
                  right={-4}
                  size="$2"
                  circular
                  theme="purple"
                  bg="$purple10"
                  onPress={() => {
                    setEditName(profileUser.name || "");
                    setSelectedAvatar(profileUser.avatar_url || "");
                    setIsEditing(true);
                  }}
                  style={styles.editButton}
                >
                  ✏️
                </Button>
              )}
            </YStack>

            {isEditing ? (
              <YStack w="100%" gap="$3" bg="$backgroundElement" p="$4" borderRadius="$4" borderWidth={1} borderColor="$borderColor">
                <Text fow="bold" fos="$2" color="$color">Edit Display Name</Text>
                <Input
                  bg="$background"
                  borderColor="$borderColor"
                  focusStyle={{ borderColor: "$purple8" }}
                  color="$color"
                  value={editName}
                  onChangeText={setEditName}
                  size="$3"
                  borderRadius="$3"
                  maxLength={30}
                  placeholder="Enter username"
                  placeholderTextColor="$color8"
                />

                <Text fow="bold" fos="$2" color="$color" mt="$1">Select Avatar Preset</Text>
                <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.presetsScroll}>
                  {AVATAR_PRESETS.map((preset) => {
                    const isSelected = selectedAvatar === preset;
                    return (
                      <YStack
                        key={preset}
                        onPress={() => setSelectedAvatar(preset)}
                        borderWidth={isSelected ? 3 : 1}
                        borderColor={isSelected ? "$purple10" : "$borderColor"}
                        borderRadius="$3"
                        p="$1"
                        bg={isSelected ? "$purple2" : "transparent"}
                        pressStyle={{ opacity: 0.8 }}
                      >
                        <Image source={{ uri: preset }} style={styles.presetImage} />
                      </YStack>
                    );
                  })}
                </ScrollView>

                <XStack gap="$2" mt="$2" jc="flex-end">
                  <Button size="$3" chromeless onPress={() => setIsEditing(false)} disabled={updating}>
                    Cancel
                  </Button>
                  <Button size="$3" theme="purple" bg="$purple10" color="white" onPress={handleUpdateProfileDetails} disabled={updating}>
                    {updating ? <Spinner color="white" /> : "Save Changes"}
                  </Button>
                </XStack>
              </YStack>
            ) : (
              <YStack ai="center" gap="$2">
                <Text fow="bold" fos="$7" color="$color" ta="center">
                  {profileUser.name || "Nexton User"}
                </Text>
                <Text color="$slate9" fos="$3" ta="center">
                  {profileUser.email}
                </Text>
                <XStack bg="$purple10" px="$3" py="$1" borderRadius="$5" mt="$1" style={styles.badgeShadow}>
                  <Text fow="800" fos="$2" color="white" letterSpacing={0.5}>
                    Lv. {stats.current_level} {levelTitle}
                  </Text>
                </XStack>
              </YStack>
            )}
          </YStack>

          {/* Quick Stats Grid */}
          <YStack gap="$3">
            <Text fow="800" fos="$4" color="$color" opacity={0.8} letterSpacing={0.5}>
              STATISTICS
            </Text>
            <YStack gap="$3">
              <XStack gap="$3">
                <YStack f={1} bg="$backgroundElement" p="$4" borderRadius="$4" borderWidth={1} borderColor="$borderColor" ai="center" jc="center" gap="$1" style={styles.cardShadow}>
                  <Text fos="$8">🎬</Text>
                  <Text fow="900" fos="$5" color="$color" mt="$1">
                    {stats.total_movies_watched}
                  </Text>
                  <Text fos="$1" color="$color" opacity={0.5} fow="600" ta="center">
                    Movies Watched
                  </Text>
                </YStack>

                <YStack f={1} bg="$backgroundElement" p="$4" borderRadius="$4" borderWidth={1} borderColor="$borderColor" ai="center" jc="center" gap="$1" style={styles.cardShadow}>
                  <Text fos="$8">📺</Text>
                  <Text fow="900" fos="$5" color="$color" mt="$1">
                    {stats.total_episodes_watched}
                  </Text>
                  <Text fos="$1" color="$color" opacity={0.5} fow="600" ta="center">
                    Episodes Watched
                  </Text>
                </YStack>
              </XStack>

              <XStack gap="$3">
                <YStack f={1} bg="$backgroundElement" p="$4" borderRadius="$4" borderWidth={1} borderColor="$borderColor" ai="center" jc="center" gap="$1" style={styles.cardShadow}>
                  <Text fos="$8">⏱️</Text>
                  <Text fow="900" fos="$5" color="$color" mt="$1">
                    {formatWatchTime(stats.total_watch_time_minutes)}
                  </Text>
                  <Text fos="$1" color="$color" opacity={0.5} fow="600" ta="center">
                    Total Time Spent
                  </Text>
                </YStack>

                <YStack f={1} bg="$backgroundElement" p="$4" borderRadius="$4" borderWidth={1} borderColor="$borderColor" ai="center" jc="center" gap="$1" style={styles.cardShadow}>
                  <Text fos="$8">🔥</Text>
                  <Text fow="900" fos="$5" color="$color" mt="$1">
                    {stats.streak_days} {stats.streak_days === 1 ? "Day" : "Days"}
                  </Text>
                  <Text fos="$1" color="$color" opacity={0.5} fow="600" ta="center">
                    Current Streak
                  </Text>
                </YStack>
              </XStack>
            </YStack>
          </YStack>

          {/* Account & App Preferences List */}
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
                  onCheckedChange={handleToggleNotifications}
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
                onPress={cycleAppearance}
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
                onPress={handleClearHistory}
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
                onPress={handleDeleteUserAccount}
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

          {/* Authentication Action: Log Out */}
          <YStack mt="$4">
            <Button
              size="$4"
              variant="outlined"
              borderColor="$red8"
              color="$red10"
              hoverStyle={{ bg: "$red2", borderColor: "$red10" }}
              pressStyle={{ bg: "$red3" }}
              fontWeight="bold"
              borderRadius="$4"
              onPress={handleLogoutPress}
              w="100%"
            >
              Log Out
            </Button>
          </YStack>

        </YStack>
      </ScrollView>
    </YStack>
  );
}

const styles = StyleSheet.create({
  scrollContent: {
    paddingBottom: Platform.OS === "web" ? 40 : 120,
  },
  avatarShadow: {
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.25,
    shadowRadius: 5,
    elevation: 4,
  },
  badgeShadow: {
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.15,
    shadowRadius: 3,
    elevation: 2,
  },
  cardShadow: {
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.1,
    shadowRadius: 2,
    elevation: 1,
  },
  avatarImage: {
    width: "100%",
    height: "100%",
  },
  presetImage: {
    width: 48,
    height: 48,
  },
  presetsScroll: {
    gap: 12,
    paddingVertical: 4,
  },
  editButton: {
    width: 32,
    height: 32,
    minHeight: 32,
    minWidth: 32,
    padding: 0,
    alignItems: "center",
    justifyContent: "center",
  },
});
