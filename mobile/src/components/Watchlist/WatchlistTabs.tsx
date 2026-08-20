import { Text, XStack } from "tamagui";

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
    <XStack gap="$3" ai="center">
      {(["tv", "movies"] as const).map((tab) => {
        const active = activeTab === tab;
        return (
          <Text
            key={tab}
            color="$color"
            opacity={active ? 1 : 0.6}
            fow={active ? "900" : "700"}
            fos={active ? "$10" : "$9"}
            pressStyle={{ opacity: 0.75 }}
            onPress={() => onChange(tab)}
          >
            {tab === "movies" ? "Movies" : "Shows"}
          </Text>
        );
      })}
    </XStack>
  );
}
