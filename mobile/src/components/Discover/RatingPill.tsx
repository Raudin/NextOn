import React from "react";
import { Text, XStack } from "tamagui";

interface RatingPillProps {
  rating: number;
}

export default function RatingPill({ rating }: RatingPillProps) {
  return (
    <XStack bg="$background" px="$2" py="$1" borderRadius="$3" ai="center" gap="$1">
      <Text fos="$1" color="#B88900">
        ★
      </Text>
      <Text color="$color" fos="$1" fow="800">
        {rating.toFixed(1)}
      </Text>
    </XStack>
  );
}
