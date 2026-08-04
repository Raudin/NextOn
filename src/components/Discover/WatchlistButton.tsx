import React from "react";
import { Button } from "tamagui";

interface WatchlistButtonProps {
  added: boolean;
  onPress: () => void;
}

export default function WatchlistButton({ added, onPress }: WatchlistButtonProps) {
  return (
    <Button
      pos="absolute"
      bottom="$2"
      right="$2"
      size="$2"
      circular
      bg={added ? "$purple9" : "rgba(0,0,0,0.72)"}
      color="white"
      borderWidth={1}
      borderColor={added ? "$purple7" : "rgba(255,255,255,0.2)"}
      onPress={(event: any) => {
        event?.stopPropagation?.();
        onPress();
      }}
    >
      {added ? "✓" : "+"}
    </Button>
  );
}
