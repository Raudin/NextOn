import React from "react";
import { Button, XStack } from "tamagui";

export type WatchlistTab = "movies" | "tv";

interface WatchlistTabsProps {
  activeTab: WatchlistTab;
  onChange: (tab: WatchlistTab) => void;
}

export default function WatchlistTabs({
  activeTab,
  onChange,
}: WatchlistTabsProps) {
  return (
    <XStack bg="$backgroundElement" p="$1" borderRadius="$4" mb="$4">
      {(["movies", "tv"] as const).map((tab) => {
        const active = activeTab === tab;
        return (
          <Button
            key={tab}
            flex={1}
            borderRadius="$3"
            bg={active ? "$background" : "transparent"}
            color="$color"
            opacity={active ? 1 : 0.6}
            onPress={() => onChange(tab)}
          >
            {tab === "movies" ? "Movies" : "TV Shows"}
          </Button>
        );
      })}
    </XStack>
  );
}
