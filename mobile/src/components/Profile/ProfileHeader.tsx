import React from "react";
import { Platform, StyleSheet, View } from "react-native";
import { Image } from "expo-image";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import Svg, { Defs, LinearGradient, Rect, Stop } from "react-native-svg";
import Award from "lucide-react-native/icons/award";
import Pencil from "lucide-react-native/icons/pencil";
import Settings from "lucide-react-native/icons/settings";
import { Avatar, Button, Input, ScrollView, Spinner, Text, XStack, YStack } from "tamagui";
import { type User, type ProfileStats } from "@/lib/media-api";
import { imageCachePolicy, imageTransitionMs } from "@/lib/images";
import { getLevelTitle } from "@/components/Profile/LevelCard";

const AVATAR_PRESETS = [
  "https://api.dicebear.com/7.x/bottts/svg?seed=Gladiator",
  "https://api.dicebear.com/7.x/bottts/svg?seed=Sonic",
  "https://api.dicebear.com/7.x/bottts/svg?seed=Wicked",
  "https://api.dicebear.com/7.x/bottts/svg?seed=Wednesday",
  "https://api.dicebear.com/7.x/bottts/svg?seed=Squid",
  "https://api.dicebear.com/7.x/bottts/svg?seed=InsideOut",
];

interface ProfileHeaderProps {
  profileUser: User;
  stats: ProfileStats;
  backdropUrl: string;
  isEditing: boolean;
  setIsEditing: (isEditing: boolean) => void;
  editName: string;
  setEditName: (name: string) => void;
  selectedAvatar: string;
  setSelectedAvatar: (avatar: string) => void;
  updating: boolean;
  onUpdateProfileDetails: () => void;
  onOpenSettings: () => void;
}

export default function ProfileHeader({
  profileUser,
  stats,
  backdropUrl,
  isEditing,
  setIsEditing,
  editName,
  setEditName,
  selectedAvatar,
  setSelectedAvatar,
  updating,
  onUpdateProfileDetails,
  onOpenSettings,
}: ProfileHeaderProps) {
  const insets = useSafeAreaInsets();
  const topInset = Math.max(insets.top, Platform.OS === "android" ? 16 : 0);
  const levelTitle = getLevelTitle(stats.current_level);

  return (
    <YStack w="100%" pos="relative" overflow="hidden">
      {/* 1. Backdrop Banner Area */}
      <YStack h={200} w="100%" pos="relative">
        {backdropUrl ? (
          <Image
            source={{ uri: backdropUrl }}
            style={StyleSheet.absoluteFill}
            contentFit="cover"
            cachePolicy="memory-disk"
            transition={imageTransitionMs("backdrop")}
          />
        ) : (
          <YStack f={1} bg="$backgroundElement" />
        )}

        {/* Cinematic gradient fade: transparent at top/middle -> deep black at bottom */}
        <Svg style={StyleSheet.absoluteFill}>
          <Defs>
            <LinearGradient id="profileBannerGrad" x1="0" y1="0" x2="0" y2="1">
              <Stop offset="0%" stopColor="#000000" stopOpacity="0.45" />
              <Stop offset="30%" stopColor="#000000" stopOpacity="0.15" />
              <Stop offset="65%" stopColor="#000000" stopOpacity="0.5" />
              <Stop offset="92%" stopColor="#000000" stopOpacity="0.95" />
              <Stop offset="100%" stopColor="#000000" stopOpacity="1" />
            </LinearGradient>
          </Defs>
          <Rect width="100%" height="100%" fill="url(#profileBannerGrad)" />
        </Svg>

        {/* 2. Top Bar (Floating inside banner) */}
        <XStack
          pos="absolute"
          t={topInset + 8}
          l={0}
          r={0}
          px="$4"
          ai="center"
          jc="space-between"
          zIndex={10}
        >
          <View style={styles.topIconSpacer} /> 

          {/* Translucent Settings Gear Button */}
          <Button
            size="$3"
            circular
            bg="rgba(0,0,0,0.4)"
            borderWidth={1}
            borderColor="rgba(255,255,255,0.18)"
            onPress={onOpenSettings}
            accessibilityLabel="Open settings"
            pressStyle={{ opacity: 0.7, scale: 0.95 }}
            style={styles.settingsButton}
          >
            <Settings size={18} color="#FFFFFF" strokeWidth={2.2} />
          </Button>
        </XStack>

        {/* 3. Lower Banner: User Identity Row */}
        <XStack
          pos="absolute"
          b="$3"
          l="$4"
          r="$4"
          ai="center"
          gap="$3.5"
          zIndex={10}
        >
          {/* Avatar with subtle border and edit pencil */}
          <YStack pos="relative">
            <Avatar
              circular
              size={72}
              bg="$backgroundElement"
              borderWidth={2}
              borderColor="rgba(255,255,255,0.4)"
            >
              {profileUser.avatar_url ? (
                <Image
                  source={{ uri: profileUser.avatar_url }}
                  style={styles.avatarImage}
                  contentFit="cover"
                  cachePolicy={imageCachePolicy("profile")}
                  transition={imageTransitionMs("profile")}
                  recyclingKey={profileUser.avatar_url}
                />
              ) : (
                <Avatar.Fallback bc="#212225" jc="center" ai="center">
                  <Text color="white" fow="700" fos="$6">
                    {profileUser.email.substring(0, 2).toUpperCase()}
                  </Text>
                </Avatar.Fallback>
              )}
            </Avatar>

            {!isEditing && (
              <Button
                pos="absolute"
                b={0}
                r={0}
                circular
                bg="#212225"
                borderWidth={1.5}
                borderColor="rgba(255,255,255,0.5)"
                onPress={() => {
                  setEditName(profileUser.name || "");
                  setSelectedAvatar(profileUser.avatar_url || "");
                  setIsEditing(true);
                }}
                accessibilityLabel="Edit profile"
                pressStyle={{ opacity: 0.7 }}
                style={styles.editButton}
              >
                <Pencil size={11} color="white" strokeWidth={2.6} />
              </Button>
            )}
          </YStack>

          {/* Membership Pill */}
          <YStack f={1} gap={4}>
            {/* Level & Membership Pill */}
            <XStack
              ai="center"
              gap="$1.5"
              px="$2.5"
              py={3}
              br="$10"
              bg="rgba(255,255,255,0.12)"
              borderWidth={1}
              borderColor="rgba(255,255,255,0.18)"
              alignSelf="flex-start"
            >
              <Award size={12} color="#FFFFFF" strokeWidth={2.4} />
              <Text fow="800" fos={11} color="white" tt="uppercase" ls={0.5}>
                Lv. {stats.current_level} • {levelTitle}
              </Text>
            </XStack>
          </YStack>
        </XStack>
      </YStack>

      {/* 4. Editing Card Form (Expandable) */}
      {isEditing ? (
        <YStack
          w="100%"
          gap="$3"
          bg="$backgroundElement"
          p="$4"
          br="$4"
          borderCurve="continuous"
          borderWidth={1}
          borderColor="$borderColor"
          mt="$3"
        >
          <YStack gap="$2">
            <Text color="$color" opacity={0.55} fos="$2" fow="600" tt="uppercase" ls={0.6}>
              Display name
            </Text>
            <Input
              bg="$background"
              borderColor="$borderColor"
              focusStyle={{ borderColor: "$color" }}
              color="$color"
              value={editName}
              onChangeText={setEditName}
              size="$3"
              br="$2"
              maxLength={30}
              placeholder="Enter username"
              placeholderTextColor="$color8"
            />
          </YStack>

          <YStack gap="$2">
            <Text color="$color" opacity={0.55} fos="$2" fow="600" tt="uppercase" ls={0.6}>
              Avatar preset
            </Text>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.presetsScroll}>
              {AVATAR_PRESETS.map((preset) => {
                const isSelected = selectedAvatar === preset;
                return (
                  <YStack
                    key={preset}
                    onPress={() => setSelectedAvatar(preset)}
                    borderWidth={isSelected ? 2 : 1}
                    borderColor={isSelected ? "#FFFFFF" : "$borderColor"}
                    br={12}
                    p={2}
                    pressStyle={{ opacity: 0.8 }}
                  >
                    <Image
                      source={{ uri: preset }}
                      style={styles.presetImage}
                      cachePolicy={imageCachePolicy("profile")}
                      transition={imageTransitionMs("profile")}
                      recyclingKey={preset}
                    />
                  </YStack>
                );
              })}
            </ScrollView>
          </YStack>

          <XStack gap="$2" jc="flex-end" mt="$1">
            <Button size="$3" chromeless onPress={() => setIsEditing(false)} disabled={updating}>
              <Text color="$color" fow="600">Cancel</Text>
            </Button>
            <Button
              size="$3"
              bg="$color"
              onPress={onUpdateProfileDetails}
              disabled={updating}
              pressStyle={{ opacity: 0.8 }}
            >
              {updating ? (
                <Spinner color="$background" size="small" />
              ) : (
                <Text color="$background" fow="700">Save</Text>
              )}
            </Button>
          </XStack>
        </YStack>
      ) : null}
    </YStack>
  );
}

const styles = StyleSheet.create({
  topIconSpacer: {
    width: 38,
    height: 38,
  },
  settingsButton: {
    width: 38,
    height: 38,
    minHeight: 38,
    minWidth: 38,
    padding: 0,
    alignItems: "center",
    justifyContent: "center",
  },
  avatarImage: { width: "100%", height: "100%" },
  presetImage: { width: 44, height: 44, borderRadius: 8 },
  presetsScroll: { gap: 8, paddingVertical: 2, paddingRight: 4 },
  editButton: {
    width: 24,
    height: 24,
    minHeight: 24,
    minWidth: 24,
    padding: 0,
    alignItems: "center",
    justifyContent: "center",
  },
});
