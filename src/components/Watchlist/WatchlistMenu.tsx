import { Pressable } from "react-native";
import { Text, XStack, YStack } from "tamagui";

export type WatchlistLayoutMode = "posters" | "list";
export type WatchlistSortMode = "recent" | "alphabetical";

interface WatchlistMenuProps {
  visible: boolean;
  selectionMode: boolean;
  layoutMode: WatchlistLayoutMode;
  sortMode: WatchlistSortMode;
  onClose: () => void;
  onToggleSelectionMode: () => void;
  onLayoutChange: (mode: WatchlistLayoutMode) => void;
  onSortChange: (mode: WatchlistSortMode) => void;
}

interface MenuItemProps {
  label: string;
  active?: boolean;
  onPress: () => void;
}

function MenuItem({ label, active, onPress }: MenuItemProps) {
  return (
    <XStack
      ai="center"
      jc="space-between"
      px="$3"
      py="$2.5"
      borderRadius="$3"
      bg={active ? "$backgroundHover" : "transparent"}
      pressStyle={{ opacity: 0.8 }}
      onPress={onPress}
    >
      <Text color="$color" fos="$3" fow={active ? "700" : "500"}>
        {label}
      </Text>
      <Text color="$color" opacity={active ? 1 : 0}>
        ✓
      </Text>
    </XStack>
  );
}

export default function WatchlistMenu({
  visible,
  selectionMode,
  layoutMode,
  sortMode,
  onClose,
  onToggleSelectionMode,
  onLayoutChange,
  onSortChange,
}: WatchlistMenuProps) {
  if (!visible) {
    return null;
  }

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
        bg="$background"
        borderWidth={1}
        borderColor="$borderColor"
        shadowColor="#000"
        shadowOpacity={0.32}
        shadowRadius={14}
        shadowOffset={{ width: 0, height: 8 }}
      >
        <MenuItem
          label="Select"
          active={selectionMode}
          onPress={() => {
            onToggleSelectionMode();
            onClose();
          }}
        />

        <YStack h={1} bg="$borderColor" my="$1" />

        <MenuItem
          label="Posters"
          active={layoutMode === "posters"}
          onPress={() => {
            onLayoutChange("posters");
            onClose();
          }}
        />
        <MenuItem
          label="List"
          active={layoutMode === "list"}
          onPress={() => {
            onLayoutChange("list");
            onClose();
          }}
        />

        <YStack h={1} bg="$borderColor" my="$1" />

        <MenuItem
          label="Recently added"
          active={sortMode === "recent"}
          onPress={() => {
            onSortChange("recent");
            onClose();
          }}
        />
        <MenuItem
          label="Alphabetical"
          active={sortMode === "alphabetical"}
          onPress={() => {
            onSortChange("alphabetical");
            onClose();
          }}
        />
      </YStack>
    </>
  );
}
