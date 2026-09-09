import { Tabs } from "expo-router";
import { SymbolView } from "expo-symbols";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Platform, Pressable, StyleSheet, Text, View, useColorScheme } from "react-native";
import { useAuth } from "@/context/AuthContext";

const TABS = [
  { name: "index", label: "Home", ios: "house.fill", android: "home" },
  { name: "discover", label: "Discover", ios: "safari.fill", android: "explore" },
  { name: "watchlist", label: "Watchlist", ios: "bookmark.fill", android: "bookmarks" },
  { name: "profile", label: "Profile", ios: "person.fill", android: "person" },
] as const;

export default function AppTabs() {
  const insets = useSafeAreaInsets();
  const systemScheme = useColorScheme();
  const { themeMode } = useAuth();
  const isDark = themeMode === "dark" || (themeMode === "system" && systemScheme === "dark");
  const colors = {
    background: isDark ? "rgba(28, 28, 30, 0.96)" : "rgba(249, 249, 249, 0.96)",
    border: isDark ? "rgba(255,255,255,0.14)" : "rgba(60,60,67,0.18)",
    active: isDark ? "#FFFFFF" : "#1C1C1E",
    inactive: isDark ? "#98989F" : "#6C6C70",
    selected: isDark ? "#3A3A3C" : "#E5E5EA",
  };

  return (
    <Tabs
      screenOptions={{ headerShown: false }}
      tabBar={({ state, navigation }) => (
        <View style={[styles.bar, { paddingBottom: Math.max(insets.bottom, 8), backgroundColor: colors.background, borderTopColor: colors.border }]}>
          {TABS.map((tab) => {
            const index = state.routes.findIndex((route) => route.name === tab.name);
            if (index < 0) return null;
            const route = state.routes[index];
            const focused = state.index === index;

            return (
              <Pressable
                key={route.key}
                accessibilityRole="tab"
                accessibilityState={{ selected: focused }}
                accessibilityLabel={tab.label}
                onPress={() => {
                  const event = navigation.emit({ type: "tabPress", target: route.key, canPreventDefault: true });
                  if (!focused && !event.defaultPrevented) navigation.navigate(route.name);
                }}
                style={({ pressed }) => [styles.tab, pressed && styles.pressed]}
              >
                <View style={[styles.iconFrame, focused && { backgroundColor: colors.selected }]}>
                  <SymbolView
                    name={{ ios: tab.ios as never, android: tab.android as never, web: tab.android as never }}
                    size={22}
                    tintColor={focused ? colors.active : colors.inactive}
                    type="hierarchical"
                  />
                </View>
                <Text style={[styles.label, { color: focused ? colors.active : colors.inactive }]}>{tab.label}</Text>
              </Pressable>
            );
          })}
        </View>
      )}
    >
      <Tabs.Screen name="index" />
      <Tabs.Screen name="discover" />
      <Tabs.Screen name="watchlist" />
      <Tabs.Screen name="profile" />
    </Tabs>
  );
}

const styles = StyleSheet.create({
  bar: {
    borderTopWidth: StyleSheet.hairlineWidth,
    flexDirection: "row",
    minHeight: Platform.OS === "ios" ? 82 : 68,
    paddingTop: 8,
    paddingHorizontal: 8,
  },
  tab: {
    alignItems: "center",
    flex: 1,
    gap: 3,
    minHeight: 52,
    paddingHorizontal: 4,
  },
  iconFrame: {
    alignItems: "center",
    borderRadius: 18,
    height: 32,
    justifyContent: "center",
    width: 56,
  },
  label: {
    fontSize: 11,
    fontWeight: "600",
    letterSpacing: 0.1,
  },
  pressed: {
    opacity: 0.6,
  },
});
