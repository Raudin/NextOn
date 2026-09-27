import React, { useEffect, useState, useCallback } from "react";
import { Platform, StyleSheet } from "react-native";
import { useRouter, useFocusEffect } from "expo-router";
import { SafeAreaView } from "react-native-safe-area-context";
import {
  YStack,
  Text,
  ScrollView,
} from "tamagui";
import { useAuth } from "@/context/AuthContext";

import ProfileHeader from "@/components/Profile/ProfileHeader";
import StatsGrid from "@/components/Profile/StatsGrid";
import WatchActivityGraph from "@/components/Profile/WatchActivityGraph";
import PreferencesSection from "@/components/Profile/PreferencesSection";
import DiagnosticsSection from "@/components/Profile/DiagnosticsSection";
import LoadingOrb from "@/components/LoadingOrb";
import ConfirmDialog from "@/components/ui/ConfirmDialog";
import { useConfirmDialog } from "@/components/ui/use-confirm-dialog";
import { useDeferredLoading } from "@/hooks/use-deferred-loading";
import { invalidateMediaCaches } from "@/lib/cache";
import { setTelemetryScreen } from "@/lib/telemetry";

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

  /**
   * The one confirmation dialog this screen shows.
   *
   * Declarative rather than `Alert.alert`, because Android renders it with
   * Jetpack Compose and a Compose dialog has to be mounted inside a `Host` in
   * the tree. Hooks run before the loading and error returns below, so the
   * dialog stays mounted for the whole life of the screen.
   */
  const { confirm, dialogProps } = useConfirmDialog();

  /**
   * What the screen renders, rather than raw `authLoading`/`loading`.
   *
   * Deferring the gate matters more here than anywhere: the profile is the one
   * tab whose data is re-fetched on every focus, and the guard below only fires
   * on a cold load (`!profileUser`), so the orb appears exactly when there is
   * genuinely nothing to show — and then not for a two-frame flash.
   */
  const showLoadingUI = useDeferredLoading(
    authLoading || (loading && !profileUser)
  );

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
      setTelemetryScreen("profile");
      if (token) {
        loadProfile();
      }
    }, [loadProfile, token])
  );

  if (showLoadingUI) {
    return (
      <YStack f={1} ai="center" jc="center" bg="$background">
        <LoadingOrb label="Loading profile..." />
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
      confirm({
        title: "Validation Error",
        message: "Name cannot be empty.",
        infoOnly: true,
        onConfirm: () => {},
      });
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

  /**
   * The artwork-cache notice, raised from the settings sheet.
   *
   * It is shown here rather than inside the sheet because on Android the sheet
   * is a React Native modal window, and a Compose dialog wants to be the only
   * window in play.
   */
  const handleImageCacheCleared = (cleared: boolean) => {
    confirm({
      title: cleared ? "Image cache cleared" : "Could not clear the cache",
      message: cleared
        ? "Downloaded artwork has been removed. Images will load again as you browse."
        : "Something went wrong while clearing the cache. Please try again.",
      infoOnly: true,
      onConfirm: () => {},
    });
  };

  const handleClearHistory = () => {
    confirm({
      title: "Clear Watch History",
      message:
        "Are you absolutely sure you want to clear your entire watch history? This will reset all your level stats and active streaks forever.",
      destructive: true,
      onConfirm: async () => {
        try {
          await clearWatchHistory();
          // Invalidate affected caches
          await invalidateMediaCaches();
          loadProfile();
        } catch (err: any) {
          setError(err.message || "Failed to clear watch history.");
        }
      },
    });
  };

  const handleDeleteUserAccount = () => {
    confirm({
      title: "Delete Account",
      message:
        "Are you absolutely sure you want to delete your account? This will permanently erase your profile, watch list, and history. This action cannot be undone.",
      destructive: true,
      onConfirm: async () => {
        try {
          await deleteUserAccount();
          await logout();
          router.replace("/auth");
        } catch (err: any) {
          setError(err.message || "Failed to delete account.");
        }
      },
    });
  };

  const handleLogoutPress = () => {
    confirm({
      title: "Log Out",
      message: "Are you sure you want to log out of Nexton?",
      destructive: true,
      onConfirm: async () => {
        await logout();
        router.replace("/auth");
      },
    });
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

            {__DEV__ ? <DiagnosticsSection /> : null}

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
        onImageCacheCleared={handleImageCacheCleared}
      />

      {/*
        Sibling of the sheet, not a child of it: on Android this dialog is a
        Compose window of its own, and it must not be nested inside the modal
        window the sheet uses.
      */}
      {dialogProps ? <ConfirmDialog {...dialogProps} /> : null}
    </YStack>
  );
}

const styles = StyleSheet.create({
  scrollContent: {
    paddingBottom: Platform.OS === "web" ? 40 : 120,
  },
});
