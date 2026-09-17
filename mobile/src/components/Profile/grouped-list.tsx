import React from "react";
import { StyleSheet } from "react-native";
import { type LucideIcon } from "lucide-react-native";
import { Text, XStack, YStack } from "tamagui";

/**
 * Shared metrics for the inset grouped lists used across the profile tab, so the
 * stat rows, the settings rows and the activity graph all line up.
 */
export const LIST_ICON_SIZE = 28;
export const LIST_ROW_PADDING = 12;
export const LIST_ROW_GAP = 12;
/** Separators line up with the row label, not the icon tile. */
export const LIST_SEPARATOR_INSET = LIST_ROW_PADDING + LIST_ICON_SIZE + LIST_ROW_GAP;

/** Inset grouped container, following the iOS settings idiom. */
export function Group({ children }: { children: React.ReactNode }) {
  return (
    <YStack
      bg="$backgroundElement"
      br="$4"
      borderCurve="continuous"
      overflow="hidden"
    >
      {children}
    </YStack>
  );
}

export function Separator() {
  return (
    <YStack
      h={StyleSheet.hairlineWidth}
      bg="$borderColor"
      ml={LIST_SEPARATOR_INSET}
    />
  );
}

export function SectionHeader({ children }: { children: string }) {
  return (
    <Text
      color="$color"
      opacity={0.5}
      fos="$2"
      fow="600"
      px={4}
      tt="uppercase"
      ls={0.6}
    >
      {children}
    </Text>
  );
}

export function IconTile({ icon: Icon, tint }: { icon: LucideIcon; tint: string }) {
  return (
    <XStack
      w={LIST_ICON_SIZE}
      h={LIST_ICON_SIZE}
      br={8}
      ai="center"
      jc="center"
      style={{ backgroundColor: `${tint}22` }}
    >
      <Icon size={17} color={tint} strokeWidth={2.4} />
    </XStack>
  );
}
