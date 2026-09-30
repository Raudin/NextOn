import React from "react";
import { Text, YStack } from "tamagui";

interface EmptyStateProps {
  text: string;
}

export default function EmptyState({ text }: EmptyStateProps) {
  return (
    <YStack
      py="$5"
      ai="center"
      bg="$backgroundElement"
      borderRadius="$4"
      borderCurve="continuous"
    >
      <Text color="$color" opacity={0.5} fos="$2">
        {text}
      </Text>
    </YStack>
  );
}
