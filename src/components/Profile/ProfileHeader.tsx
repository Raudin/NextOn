import React from "react";
import { StyleSheet } from "react-native";
import { Image } from "expo-image";
import {
  Avatar,
  Button,
  Input,
  ScrollView,
  Spinner,
  Text,
  XStack,
  YStack,
} from "tamagui";
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
}: ProfileHeaderProps) {
  const levelTitle = getLevelTitle(stats.current_level);

  return (
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
            <Button size="$3" theme="purple" bg="$purple10" color="white" onPress={onUpdateProfileDetails} disabled={updating}>
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
  );
}

const styles = StyleSheet.create({
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
