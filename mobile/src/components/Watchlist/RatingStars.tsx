import React from "react";
import { Text, XStack } from "tamagui";

interface RatingStarsProps {
  value: number;
}

export default function RatingStars({ value }: RatingStarsProps) {
  const full = Math.max(0, Math.min(5, Math.round(value / 2)));
  const empty = 5 - full;
  return (
    <XStack ai="center" gap="$1">
      <Text color="$yellow9" fos="$2">
        {"★".repeat(full)}
        {"☆".repeat(empty)}
      </Text>
      <Text color="$color" opacity={0.65} fos="$2">
        {value.toFixed(1)}
      </Text>
    </XStack>
  );
}
