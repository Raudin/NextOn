import { Pressable, useColorScheme } from "react-native";
import { Text, XStack, YStack } from "tamagui";

export type WatchlistLayoutMode = "posters" | "list";
export type WatchlistSortMode = "recent" | "alphabetical";

interface WatchlistMenuProps {
  visible: boolean;
  layoutMode: WatchlistLayoutMode;
  sortMode: WatchlistSortMode;
  onClose: () => void;
  onLayoutChange: (mode: WatchlistLayoutMode) => void;
  onSortChange: (mode: WatchlistSortMode) => void;
}

interface MenuItemProps {
  label: string;
  active?: boolean;
  textColor: string;
  activeBg: string;
  onPress: () => void;
}

function MenuItem({ label, active, textColor, activeBg, onPress }: MenuItemProps) {
  return (
    <XStack
      ai="center"
      jc="space-between"
      px="$3"
      py="$2.5"
      borderRadius="$3"
      bg={active ? activeBg : "transparent"}
      pressStyle={{ opacity: 0.8 }}
      onPress={onPress}
    >
      <Text color={textColor} fos="$3" fow={active ? "700" : "500"}>
        {label}
      </Text>
      <Text color={textColor} opacity={active ? 1 : 0}>
        ✓
      </Text>
    </XStack>
  );
}

export default function WatchlistMenu({
  visible,
  layoutMode,
  sortMode,
  onClose,
  onLayoutChange,
  onSortChange,
}: WatchlistMenuProps) {
  const scheme = useColorScheme();
  const isDark = scheme === "dark";

  if (!visible) {
    return null;
  }

  const bg = isDark ? "rgba(20, 20, 20, 0.75)" : "rgba(255, 255, 255, 0.75)";
  const borderColor = isDark ? "rgba(255, 255, 255, 0.15)" : "rgba(0, 0, 0, 0.12)";
  const textColor = isDark ? "white" : "black";
  const itemActiveBg = isDark ? "rgba(255, 255, 255, 0.12)" : "rgba(0, 0, 0, 0.08)";

  return (
    <>
      <Pressable
        onPress={onClose}
        style={{
          position: "absolute",
          top: 0,
          right: 0,
          bottom: 0,
          left: 0,
          zIndex: 20,
        }}
      />

      <YStack
        position="absolute"
        top={56}
        right={0}
        zIndex={30}
        w={220}
        p="$2"
        gap="$1"
        borderRadius="$5"
        style={{
          backgroundColor: bg,
          borderWidth: 1,
          borderColor: borderColor,
        }}
        shadowColor="#000"
        shadowOpacity={0.32}
        shadowRadius={14}
        shadowOffset={{ width: 0, height: 8 }}
      >
        <MenuItem
          label="Posters"
          active={layoutMode === "posters"}
          textColor={textColor}
          activeBg={itemActiveBg}
          onPress={() => {
            onLayoutChange("posters");
            onClose();
          }}
        />
        <MenuItem
          label="List"
          active={layoutMode === "list"}
          textColor={textColor}
          activeBg={itemActiveBg}
          onPress={() => {
            onLayoutChange("list");
            onClose();
          }}
        />

        <YStack h={1} style={{ backgroundColor: borderColor }} my="$1" />

        <MenuItem
          label="Recently added"
          active={sortMode === "recent"}
          textColor={textColor}
          activeBg={itemActiveBg}
          onPress={() => {
            onSortChange("recent");
            onClose();
          }}
        />
        <MenuItem
          label="Alphabetical"
          active={sortMode === "alphabetical"}
          textColor={textColor}
          activeBg={itemActiveBg}
          onPress={() => {
            onSortChange("alphabetical");
            onClose();
          }}
        />
      </YStack>
    </>
  );
}
