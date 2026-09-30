import React from "react";
import { StyleSheet } from "react-native";
import { Image } from "expo-image";
import { Pencil, Settings } from "lucide-react-native";
import { Avatar, Button, Input, ScrollView, Spinner, Text, XStack, YStack } from "tamagui";
import { type User, type ProfileStats } from "@/lib/media-api";
import { imageCachePolicy, imageTransitionMs } from "@/lib/images";
import { useTheme } from "@/hooks/use-theme";

const AVATAR_PRESETS = [
  "https://api.dicebear.com/7.x/bottts/svg?seed=Gladiator",
  "https://api.dicebear.com/7.x/bottts/svg?seed=Sonic",
  "https://api.dicebear.com/7.x/bottts/svg?seed=Wicked",
  "https://api.dicebear.com/7.x/bottts/svg?seed=Wednesday",
  "https://api.dicebear.com/7.x/bottts/svg?seed=Squid",
  "https://api.dicebear.com/7.x/bottts/svg?seed=InsideOut",
];

function getLevelTitle(level: number): string {
  if (level < 3) return "Binge Novice";
  if (level < 6) return "Screen Cadet";
  if (level < 10) return "Episode Enthusiast";
  if (level < 15) return "Serial Streamer";
  if (level < 21) return "Binge Commander";
  if (level < 31) return "Showmaster";
  return "Couch Emperor";
}

interface ProfileHeaderProps {
  profileUser: User;
  stats: ProfileStats;
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
  const theme = useTheme();
  const levelTitle = getLevelTitle(stats.current_level);

  return (
    <YStack w="100%" gap="$4">
      <XStack ai="center" jc="space-between" gap="$3" w="100%">
        <YStack f={1}>
          <Text color="$color" fow="900" fos="$9">
            Profile
          </Text>
          <Text color="$color" opacity={0.5} fos="$2">
            Your viewing journey, all in one place
          </Text>
        </YStack>
        <Button
          size="$3"
          circular
          chromeless
          onPress={onOpenSettings}
          accessibilityLabel="Open settings"
          pressStyle={{ opacity: 0.5 }}
        >
          <Settings size={20} color={theme.text} strokeWidth={2.2} />
        </Button>
      </XStack>

      <XStack ai="center" gap="$3" w="100%">
        <YStack pos="relative">
          <Avatar
            circular
            size={68}
            bg="$backgroundElement"
            borderWidth={1}
            borderColor="$borderColor"
          >
            {profileUser.avatar_url ? (
              <Image
                source={{ uri: profileUser.avatar_url }}
                style={styles.avatarImage}
                contentFit="cover"
                // Avatars are remote and revisited on every profile visit, so
                // they are worth keeping on disk.
                cachePolicy={imageCachePolicy("profile")}
                transition={imageTransitionMs("profile")}
                recyclingKey={profileUser.avatar_url}
              />
            ) : (
              <Avatar.Fallback bc="$purple9" jc="center" ai="center">
                <Text color="white" fow="700" fos="$5">{profileUser.email.substring(0, 2).toUpperCase()}</Text>
              </Avatar.Fallback>
            )}
          </Avatar>
          {!isEditing && (
            <Button
              pos="absolute"
              b={-2}
              r={-2}
              circular
              bg="$purple9"
              borderWidth={2}
              borderColor="$background"
              onPress={() => {
                setEditName(profileUser.name || "");
                setSelectedAvatar(profileUser.avatar_url || "");
                setIsEditing(true);
              }}
              accessibilityLabel="Edit profile"
              pressStyle={{ opacity: 0.7 }}
              style={styles.editButton}
            >
              <Pencil size={12} color="white" strokeWidth={2.6} />
            </Button>
          )}
        </YStack>

        <YStack f={1} gap={2}>
          <XStack ai="center" gap="$2" fw="wrap">
            <Text fow="800" fos="$6" color="$color" numberOfLines={1}>{profileUser.name || "Nexton User"}</Text>
            <XStack bg="$purple9" px="$2" py={1} br="$4">
              <Text fow="800" fos="$1" color="white">Lv. {stats.current_level}</Text>
            </XStack>
          </XStack>
          <Text color="$purple10" fow="600" fos="$2" numberOfLines={1}>{levelTitle}</Text>
          <Text color="$color" opacity={0.5} fos="$1" numberOfLines={1}>{profileUser.email}</Text>
        </YStack>
      </XStack>

      {isEditing ? <YStack
          w="100%"
          gap="$3"
          bg="$backgroundElement"
          p="$4"
          br="$4"
          borderCurve="continuous"
        >
          <YStack gap="$2">
            <Text color="$color" opacity={0.5} fos="$2" fow="600" tt="uppercase" ls={0.6}>
              Display name
            </Text>
            <Input
              bg="$background"
              borderColor="$borderColor"
              focusStyle={{ borderColor: "$purple8" }}
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
            <Text color="$color" opacity={0.5} fos="$2" fow="600" tt="uppercase" ls={0.6}>
              Avatar
            </Text>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.presetsScroll}>
              {AVATAR_PRESETS.map((preset) => {
                const isSelected = selectedAvatar === preset;
                return (
                  <YStack
                    key={preset}
                    onPress={() => setSelectedAvatar(preset)}
                    borderWidth={isSelected ? 2 : 1}
                    borderColor={isSelected ? "$purple9" : "$borderColor"}
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

          <XStack gap="$2" jc="flex-end">
            <Button size="$3" chromeless onPress={() => setIsEditing(false)} disabled={updating}>
              <Text color="$color" fow="600">Cancel</Text>
            </Button>
            <Button size="$3" bg="$purple9" onPress={onUpdateProfileDetails} disabled={updating} pressStyle={{ opacity: 0.8 }}>
              {updating ? <Spinner color="white" size="small" /> : <Text color="white" fow="700">Save</Text>}
            </Button>
          </XStack>
        </YStack> : null}
    </YStack>
  );
}

const styles = StyleSheet.create({
  avatarImage: { width: "100%", height: "100%" },
  presetImage: { width: 44, height: 44, borderRadius: 8 },
  presetsScroll: { gap: 8, paddingVertical: 2, paddingRight: 4 },
  editButton: {
    width: 26,
    height: 26,
    minHeight: 26,
    minWidth: 26,
    padding: 0,
    alignItems: "center",
    justifyContent: "center",
  },
});
