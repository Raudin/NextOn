import React, { useEffect, useState, useCallback } from "react";
import { Platform, StyleSheet } from "react-native";
import { useRouter, useFocusEffect } from "expo-router";
import {
  YStack,
  Text,
  ScrollView,
} from "tamagui";
import { useAuth } from "@/context/AuthContext";

import ProfileHeader from "@/components/Profile/ProfileHeader";
import LevelCard from "@/components/Profile/LevelCard";
import StatsGrid from "@/components/Profile/StatsGrid";
import PreferencesSection from "@/components/Profile/PreferencesSection";
import DiagnosticsSection from "@/components/Profile/DiagnosticsSection";
import LoadingOrb from "@/components/LoadingOrb";
import ConfirmDialog from "@/components/ui/ConfirmDialog";
import { useConfirmDialog } from "@/components/ui/use-confirm-dialog";
import { useDeferredLoading } from "@/hooks/use-deferred-loading";
import { invalidateMediaCaches } from "@/lib/cache";
import { setTelemetryScreen } from "@/lib/telemetry";
import { getProfileBannerBackdrop } from "@/lib/profile-banner";

import {
  fetchUserProfile,
  fetchWatchedHistory,
  updateUserProfile,
  clearWatchHistory,
  deleteUserAccount,
  type ProfileResponse,
  type ProfileStats,
  type User,
  type WatchedItem,
} from "@/lib/media-api";

/**
 * Reads the profile and the activity history.
 *
 * Module-level so the `try`/`catch` is not inside the component: React
 * Compiler's `BuildHIR` rejects any function containing a `try` with a
 * `finally` clause and then skips the ENTIRE component, so the profile screen
 * had no automatic memoisation because of the cleanup in `loadProfile`. Errors
 * are returned rather than thrown so the caller needs no `try`.
 *
 * The history failing is deliberately not an error: the activity graph is
 * decorative, so a history failure yields an empty graph rather than taking the
 * profile down with it.
 */
type ProfileLoadOutcome =
  | { status: "ok"; data: ProfileResponse; history: WatchedItem[] }
  | { status: "error"; message: string };

async function readUserProfile(): Promise<ProfileLoadOutcome> {
  try {
    const [data, history] = await Promise.all([
      fetchUserProfile(),
      fetchWatchedHistory().catch(() => [] as WatchedItem[]),
    ]);
    return { status: "ok", data, history };
  } catch (err: any) {
    return { status: "error", message: err?.message || String(err) };
  }
}

/**
 * Saves the edited profile fields.
 *
 * `updateUser` (the auth context) is deliberately NOT called here — it is a
 * React callback, so it belongs to the component. The caller applies it.
 */
type ProfileSaveOutcome =
  | { status: "ok"; updated: User }
  | { status: "error"; message: string };

async function saveProfileEdits(
  name: string,
  avatarUrl: string,
): Promise<ProfileSaveOutcome> {
  try {
    const updated = await updateUserProfile({ name, avatar_url: avatarUrl });
    return { status: "ok", updated };
  } catch (err: any) {
    return { status: "error", message: err?.message || "Failed to update profile." };
  }
}

export default function ProfileScreen() {
  const { token, logout, isLoading: authLoading, themeMode, setThemeMode, updateUser } = useAuth();
  const { replace } = useRouter();

  /**
   * Starts false, not true.
   *
   * The tab navigator mounts every tab at launch, so an initial `true` claimed
   * a load that had not started on screens the user had never opened — and the
   * orb, which is gated on this flag, animated from startup on all of them.
   * `loadProfile` claims the flag synchronously before its first await, and it
   * is only ever called from the focus effect below.
   */
  const [loading, setLoading] = useState(false);
  const [profileUser, setProfileUser] = useState<User | null>(null);
  const [stats, setStats] = useState<ProfileStats | null>(null);
  const [backdropUrl, setBackdropUrl] = useState<string>("");
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
      replace("/auth");
    }
  }, [authLoading, token, replace]);

  const loadProfile = useCallback(async () => {
    if (!token) return;
    setLoading(true);
    setError(null);

    // No try/finally in the component: see `readUserProfile`. The flag is
    // cleared after the await on every path, which is what the `finally` did.
    const outcome = await readUserProfile();

    if (outcome.status === "error") {
      setError(outcome.message);
    } else {
      const { data, history } = outcome;
      setProfileUser(data.user);
      setStats(data.stats);
      setEditName(data.user.name || "");
      setSelectedAvatar(data.user.avatar_url || "");
      // Sync auth context user state if needed
      updateUser(data.user);

      // Resolve weekly cached backdrop banner from recently watched items
      getProfileBannerBackdrop(history).then((url) => {
        if (url) setBackdropUrl(url);
      });
    }

    setLoading(false);
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

    // Same reasoning as `loadProfile`: the request and its outcome
    // classification live outside the component so no `finally` sits in it.
    const outcome = await saveProfileEdits(editName.trim(), selectedAvatar);

    if (outcome.status === "error") {
      setError(outcome.message);
    } else {
      setProfileUser(outcome.updated);
      await updateUser(outcome.updated);
      setIsEditing(false);
    }

    setUpdating(false);
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
          replace("/auth");
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
        replace("/auth");
      },
    });
  };

  return (
    <YStack f={1} bg="$background">
      <YStack
        f={1}
        // Required for the native tab bar's tap-to-scroll-to-top; see the native
        // tabs guide on wrapping a ScrollView.
        collapsable={false}
      >
        <ScrollView
          showsVerticalScrollIndicator={false}
          // Insets the scroll content around the status bar natively so the backdrop
          // scrolls seamlessly under the top bar
          contentInsetAdjustmentBehavior="never"
          contentContainerStyle={styles.scrollContent}
        >
          {/* Full-bleed hero banner and embedded profile identity */}
          <ProfileHeader
            profileUser={profileUser}
            stats={stats}
            backdropUrl={backdropUrl}
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

          <YStack px="$4" pt="$3.5" pb="$5" gap="$4" maxWidth={600} alignSelf="center" w="100%">
            {error ? (
              <YStack bg="$red2" p="$3" br="$3" pressStyle={{ opacity: 0.8 }} onPress={() => setError(null)}>
                <Text color="$red10" fow="bold" ta="center">{error}</Text>
                <Text color="$red8" fos="$1" ta="center" mt="$1">Tap to dismiss</Text>
              </YStack>
            ) : null}

            {/* Level Card with circular SVG progress ring */}
            <LevelCard stats={stats} />

            {/* 4-Stat Grid (No View All) */}
            <StatsGrid stats={stats} />

            {__DEV__ ? <DiagnosticsSection /> : null}
          </YStack>
        </ScrollView>
      </YStack>

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
