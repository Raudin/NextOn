import React from "react";
import { StyleSheet } from "react-native";
import { Image } from "expo-image";
import { SymbolView } from "expo-symbols";
import { Avatar, Button, Input, ScrollView, Spinner, Text, XStack, YStack } from "tamagui";
import { type User, type ProfileStats } from "@/lib/media-api";

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
  const levelTitle = getLevelTitle(stats.current_level);

  return (
    <YStack w="100%" gap="$4">
      <XStack jc="space-between" ai="flex-start" w="100%">
        <YStack gap="$1" f={1}>
          <Text fow="800" fos="$9" color="$color" letterSpacing={-0.4}>Profile</Text>
          <Text color="$color" opacity={0.55} fos="$2">Your viewing journey, all in one place</Text>
        </YStack>
        <Button
          circular
          size="$4"
          bg="$backgroundElement"
          borderWidth={1}
          borderColor="$borderColor"
          onPress={onOpenSettings}
          accessibilityLabel="Open settings"
          pressStyle={{ opacity: 0.65, scale: 0.96 }}
        >
          <SymbolView name={{ ios: "gearshape", android: "settings", web: "settings" }} size={20} tintColor="#6E6E73" />
        </Button>
      </XStack>

      <XStack ai="center" gap="$3" w="100%">
        <YStack pos="relative">
          <Avatar circular size={72} bg="$purple3" borderWidth={2} borderColor="$purple9">
            {profileUser.avatar_url ? (
              <Image source={{ uri: profileUser.avatar_url }} style={styles.avatarImage} contentFit="cover" />
            ) : (
              <Avatar.Fallback bc="$purple10" jc="center" ai="center">
                <Text color="white" fow="bold" fos="$6">{profileUser.email.substring(0, 2).toUpperCase()}</Text>
              </Avatar.Fallback>
            )}
          </Avatar>
          {!isEditing && (
            <Button
              pos="absolute"
              bottom={-2}
              right={-2}
              size="$1"
              circular
              bg="$purple10"
              onPress={() => {
                setEditName(profileUser.name || "");
                setSelectedAvatar(profileUser.avatar_url || "");
                setIsEditing(true);
              }}
              accessibilityLabel="Edit profile"
              style={styles.editButton}
            >
              <SymbolView name={{ ios: "pencil", android: "edit", web: "edit" }} size={13} tintColor="white" />
            </Button>
          )}
        </YStack>

        <YStack f={1} gap="$0.5">
          <XStack ai="center" gap="$2" fw="wrap">
            <Text fow="800" fos="$6" color="$color" numberOfLines={1}>{profileUser.name || "Nexton User"}</Text>
            <XStack bg="$purple9" px="$2" py="$0.5" borderRadius="$4">
              <Text fow="800" fos="$1" color="white" letterSpacing={0.5}>Lv. {stats.current_level}</Text>
            </XStack>
          </XStack>
          <Text color="$purple10" fow="600" fos="$2" numberOfLines={1}>{levelTitle}</Text>
          <Text color="$color" opacity={0.5} fos="$1" numberOfLines={1}>{profileUser.email}</Text>
        </YStack>
      </XStack>

      {isEditing && (
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
          <Text fow="bold" fos="$2" color="$color">Select Avatar Preset</Text>
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
            <Button size="$3" chromeless onPress={() => setIsEditing(false)} disabled={updating}>Cancel</Button>
            <Button size="$3" bg="$purple10" color="white" onPress={onUpdateProfileDetails} disabled={updating}>
              {updating ? <Spinner color="white" /> : "Save Changes"}
            </Button>
          </XStack>
        </YStack>
      )}
    </YStack>
  );
}

const styles = StyleSheet.create({
  avatarImage: { width: "100%", height: "100%" },
  presetImage: { width: 44, height: 44 },
  presetsScroll: { gap: 10, paddingVertical: 4 },
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
