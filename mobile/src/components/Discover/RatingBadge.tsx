import React from "react";
import { Text, XStack } from "tamagui";

interface RatingBadgeProps {
  rating: number;
}

export default function RatingBadge({ rating }: RatingBadgeProps) {
  return (
    <XStack
      pos="absolute"
      top={6}
      right={6}
      bg="rgba(0,0,0,0.72)"
      px={6}
      py={2}
      borderRadius="$2"
      ai="center"
      gap="$1"
    >
      <Text fos="$1" color="#FFD700">
        ★
      </Text>
      <Text color="white" fos="$1" fow="bold">
        {rating.toFixed(1)}
      </Text>
    </XStack>
  );
}
