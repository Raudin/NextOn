import React, { useEffect, useState, useCallback } from "react";
import { Alert, Platform, StyleSheet } from "react-native";
import { useRouter, useFocusEffect } from "expo-router";
import { SafeAreaView } from "react-native-safe-area-context";
import {
  YStack,
  Text,
  Spinner,
  ScrollView,
} from "tamagui";
import { useAuth } from "@/context/AuthContext";

import ProfileHeader from "@/components/Profile/ProfileHeader";
import StatsGrid from "@/components/Profile/StatsGrid";
import WatchActivityGraph from "@/components/Profile/WatchActivityGraph";
import PreferencesSection from "@/components/Profile/PreferencesSection";
import { invalidateMediaCaches } from "@/lib/cache";

import {
  fetchUserProfile,
  fetchWatchedHistory,
  updateUserProfile,
  clearWatchHistory,
  deleteUserAccount,
  type ProfileStats,
  type User,
  type WatchedItem,
} from "@/lib/media-api";

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
  const [watchHistory, setWatchHistory] = useState<WatchedItem[]>([]);
  const [error, setError] = useState<string | null>(null);

  // Edit states
  const [isEditing, setIsEditing] = useState(false);
  const [editName, setEditName] = useState("");
  const [selectedAvatar, setSelectedAvatar] = useState("");
  const [updating, setUpdating] = useState(false);

  // Preferences / Settings Modal State
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);

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
      const [data, history] = await Promise.all([
        fetchUserProfile(),
        // The activity graph is decorative — never let it block or fail the profile.
        fetchWatchedHistory().catch(() => [] as WatchedItem[]),
      ]);
      setProfileUser(data.user);
      setStats(data.stats);
      setWatchHistory(history);
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
    if (error) {
      return (
        <YStack f={1} bg="$background" ai="center" jc="center" px="$5" gap="$3">
          <Text color="$red10" fow="700" fos="$5" ta="center">Unable to load your profile</Text>
          <Text color="$color" opacity={0.6} ta="center">{error}</Text>
        </YStack>
      );
    }
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
          // Invalidate affected caches
          await invalidateMediaCaches();
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

  return (
    <YStack f={1} bg="$background">
      <SafeAreaView style={{ flex: 1 }} edges={["top"]}>
        <ScrollView
          showsVerticalScrollIndicator={false}
          contentContainerStyle={styles.scrollContent}
        >
          <YStack px="$4" pt="$2" pb="$5" gap="$5" maxWidth={600} alignSelf="center" w="100%">

            {error && (
              <YStack bg="$red2" p="$3" br="$3" pressStyle={{ opacity: 0.8 }} onPress={() => setError(null)}>
                <Text color="$red10" fow="bold" ta="center">{error}</Text>
                <Text color="$red8" fos="$1" ta="center" mt="$1">Tap to dismiss</Text>
              </YStack>
            )}

            <ProfileHeader
              profileUser={profileUser}
              stats={stats}
              isEditing={isEditing}
              setIsEditing={setIsEditing}
              editName={editName}
              setEditName={setEditName}
              selectedAvatar={selectedAvatar}
              setSelectedAvatar={setSelectedAvatar}
              updating={updating}
              onUpdateProfileDetails={handleUpdateProfileDetails}
              onOpenSettings={() => setIsSettingsOpen(true)}
            />

            <StatsGrid stats={stats} />

            <WatchActivityGraph items={watchHistory} />

          </YStack>
        </ScrollView>
      </SafeAreaView>

      {/* Settings & Preferences Modal Sheet */}
      <PreferencesSection
        isOpen={isSettingsOpen}
        onClose={() => setIsSettingsOpen(false)}
        profileUser={profileUser}
        themeMode={themeMode}
        onToggleNotifications={handleToggleNotifications}
        onCycleAppearance={cycleAppearance}
        onClearHistory={handleClearHistory}
        onDeleteAccount={handleDeleteUserAccount}
        onLogout={handleLogoutPress}
      />
    </YStack>
  );
}

const styles = StyleSheet.create({
  scrollContent: {
    paddingBottom: Platform.OS === "web" ? 40 : 120,
  },
});
