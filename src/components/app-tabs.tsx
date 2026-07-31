import { Tabs } from "expo-router";
import { useColorScheme, View, Text, TouchableOpacity, StyleSheet } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Colors } from "@/constants/theme";

const TAB_DEFS = [
  {
    name: "index",
    label: "Home",
    // House icon paths rendered as SVG-like unicode
    iconInactive: "🏠",
    iconActive: "🏠",
  },
  {
    name: "discover",
    label: "Discover",
    iconInactive: "🔍",
    iconActive: "🔍",
  },
  {
    name: "watchlist",
    label: "Watchlist",
    iconInactive: "🔖",
    iconActive: "🔖",
  },
  {
    name: "profile",
    label: "Profile",
    iconInactive: "👤",
    iconActive: "👤",
  },
];

export default function AppTabs() {
  const scheme = useColorScheme();
  const isDark = scheme !== "light";
  const insets = useSafeAreaInsets();

  const activeColor = "#FFFFFF";
  const inactiveColor = isDark ? "#48494D" : "#8E8E93";
  const bgColor = isDark ? "#0A0A0C" : "#F5F5F7";
  const borderColor = isDark ? "#1C1C22" : "#DCDCE0";
  const pillColor = isDark ? "#1E1E24" : "#E5E5EA";

  return (
    <Tabs
      screenOptions={{ headerShown: false }}
      tabBar={(props) => {
        const { state, navigation } = props;
        return (
          <View
            style={[
              styles.container,
              {
                backgroundColor: bgColor,
                borderTopColor: borderColor,
                paddingBottom: Math.max(insets.bottom, Platform.OS === "android" ? 12 : 0),
              },
            ]}
          >
            {state.routes.map((route: any, index: number) => {
              const def = TAB_DEFS[index];
              const focused = state.index === index;

              return (
                <TouchableOpacity
                  key={route.key}
                  style={styles.tab}
                  activeOpacity={0.7}
                  onPress={() => {
                    const event = navigation.emit({
                      type: "tabPress",
                      target: route.key,
                      canPreventDefault: true,
                    });
                    if (!focused && !event.defaultPrevented) {
                      navigation.navigate(route.name);
                    }
                  }}
                >
                  <View style={[styles.pill, focused && { backgroundColor: pillColor }]}>
                    <Text style={[styles.icon, !focused && styles.iconInactive]}>
                      {def?.iconActive ?? "○"}
                    </Text>
                  </View>
                  <Text
                    style={[
                      styles.label,
                      { color: focused ? activeColor : inactiveColor },
                      focused && styles.labelActive,
                    ]}
                  >
                    {def?.label ?? route.name}
                  </Text>
                </TouchableOpacity>
              );
            })}
          </View>
        );
      }}
    >
      <Tabs.Screen name="index" />
      <Tabs.Screen name="discover" />
      <Tabs.Screen name="watchlist" />
      <Tabs.Screen name="profile" />
    </Tabs>
  );
}

import { Platform } from "react-native";

const styles = StyleSheet.create({
  container: {
    flexDirection: "row",
    borderTopWidth: StyleSheet.hairlineWidth,
    paddingTop: 10,
    elevation: 0,
    shadowOpacity: 0,
  },
  tab: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    gap: 2,
    paddingBottom: 4,
  },
  pill: {
    width: 56,
    height: 32,
    borderRadius: 16,
    alignItems: "center",
    justifyContent: "center",
  },
  icon: {
    fontSize: 20,
    lineHeight: 24,
  },
  iconInactive: {
    opacity: 0.45,
  },
  label: {
    fontSize: 10,
    letterSpacing: 0.1,
    textAlign: "center",
  },
  labelActive: {
    fontWeight: "600",
  },
});
