import { Tabs } from "expo-router";
import {
  Platform,
  useColorScheme,
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  Animated,
  LayoutChangeEvent,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Home, Compass, Bookmark, User } from "lucide-react-native";
import { useRef, useState, useCallback } from "react";

const CAPSULE_TABS = [
  { name: "index", label: "Home", Icon: Home },
  { name: "discover", label: "Discover", Icon: Compass },
  { name: "watchlist", label: "Watchlist", Icon: Bookmark },
];
const PROFILE_TAB = { name: "profile", label: "Profile", Icon: User };

const CAPSULE_HEIGHT = 60;
const PILL_HEIGHT = CAPSULE_HEIGHT - 10;

export default function AppTabs() {
  const insets = useSafeAreaInsets();
  const scheme = useColorScheme();
  const isDark = scheme === "dark";

  const capsuleBg = isDark ? "#1C1C1E" : "#F2F2F5";
  const activePillColor = isDark ? "#3A3A3C" : "#FFFFFF";
  const activeColor = isDark ? "#FFFFFF" : "#1C1C1E";
  const inactiveColor = isDark ? "rgba(255,255,255,0.55)" : "rgba(60,60,67,0.6)";

  // Measured x/width of each tab, keyed by route name, so the pill can
  // animate to the exact position/size of whichever tab becomes active.
  const layouts = useRef<Record<string, { x: number; width: number }>>({});
  const pillX = useRef(new Animated.Value(0)).current;
  const pillWidth = useRef(new Animated.Value(0)).current;
  const [pillReady, setPillReady] = useState(false);
  const labelOpacity = useRef(new Animated.Value(1)).current;

  const animateTo = useCallback(
    (routeName: string) => {
      const layout = layouts.current[routeName];
      if (!layout) return;

      // Crossfade the label out/in so it doesn't just pop as the pill
      // resizes to the new tab's width.
      Animated.sequence([
        Animated.timing(labelOpacity, { toValue: 0, duration: 90, useNativeDriver: true }),
        Animated.timing(labelOpacity, { toValue: 1, duration: 140, useNativeDriver: true }),
      ]).start();

      Animated.parallel([
        Animated.spring(pillX, {
          toValue: layout.x,
          useNativeDriver: false, // animating layout props (left), can't use native driver
          speed: 18,
          bounciness: 6,
        }),
        Animated.spring(pillWidth, {
          toValue: layout.width,
          useNativeDriver: false,
          speed: 18,
          bounciness: 6,
        }),
      ]).start();

      if (!pillReady) setPillReady(true);
    },
    [labelOpacity, pillReady, pillWidth, pillX]
  );

  const handleTabLayout = (routeName: string, e: LayoutChangeEvent, isActive: boolean) => {
    const { x, width } = e.nativeEvent.layout;
    layouts.current[routeName] = { x, width };
    // Initialize the pill under the active tab on first measure, no animation.
    if (isActive && !pillReady) {
      pillX.setValue(x);
      pillWidth.setValue(width);
      setPillReady(true);
    }
  };

  return (
    <Tabs
      screenOptions={{ headerShown: false }}
      tabBar={(props) => {
        const { state, navigation } = props;

        const goTo = (routeKey: string, routeName: string, focused: boolean) => {
          const event = navigation.emit({
            type: "tabPress",
            target: routeKey,
            canPreventDefault: true,
          });
          if (!focused && !event.defaultPrevented) {
            navigation.navigate(routeName);
            animateTo(routeName);
          }
        };

        const profileIndex = state.routes.findIndex((r: any) => r.name === PROFILE_TAB.name);
        const profileRoute = profileIndex !== -1 ? state.routes[profileIndex] : null;
        const profileFocused = state.index === profileIndex;

        return (
          <View
            style={[
              styles.wrapper,
              { bottom: Math.max(insets.bottom, Platform.OS === "android" ? 12 : 8) + 14 },
            ]}
          >
            <View style={[styles.capsule, { backgroundColor: capsuleBg }]}>
              {/* Sliding highlight — sits behind the tabs, animates x/width */}
              {pillReady && (
                <Animated.View
                  pointerEvents="none"
                  style={[
                    styles.pillHighlight,
                    {
                      backgroundColor: activePillColor,
                      transform: [{ translateX: pillX }],
                      width: pillWidth,
                    },
                  ]}
                />
              )}

              {CAPSULE_TABS.map((def) => {
                const routeIndex = state.routes.findIndex((r: any) => r.name === def.name);
                if (routeIndex === -1) return null;
                const route = state.routes[routeIndex];
                const focused = state.index === routeIndex;
                const Icon = def.Icon;

                return (
                  <TouchableOpacity
                    key={route.key}
                    activeOpacity={0.7}
                    onPress={() => goTo(route.key, route.name, focused)}
                    onLayout={(e) => handleTabLayout(route.name, e, focused)}
                    style={styles.tab}
                  >
                    <Icon size={18} color={focused ? activeColor : inactiveColor} strokeWidth={2.2} />
                    {focused && (
                      <Animated.Text
                        style={[styles.label, { color: activeColor, opacity: labelOpacity }]}
                      >
                        {def.label}
                      </Animated.Text>
                    )}
                  </TouchableOpacity>
                );
              })}
            </View>

            {profileRoute && (
              <TouchableOpacity
                activeOpacity={0.7}
                onPress={() => goTo(profileRoute.key, PROFILE_TAB.name, profileFocused)}
                style={[
                  styles.profileButton,
                  { backgroundColor: profileFocused ? activePillColor : capsuleBg },
                ]}
              >
                <PROFILE_TAB.Icon
                  size={20}
                  color={profileFocused ? activeColor : inactiveColor}
                  strokeWidth={2.2}
                />
              </TouchableOpacity>
            )}
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

const styles = StyleSheet.create({
  wrapper: {
    position: "absolute",
    left: 16,
    right: 16,
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
  },
  capsule: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    height: CAPSULE_HEIGHT,
    borderRadius: CAPSULE_HEIGHT / 2,
    paddingHorizontal: 8,
    gap: 4,
  },
  pillHighlight: {
    position: "absolute",
    left: 0,
    top: 5,
    height: PILL_HEIGHT,
    borderRadius: PILL_HEIGHT / 2,
  },
  tab: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
    height: PILL_HEIGHT,
    paddingHorizontal: 12,
  },
  label: {
    fontSize: 13,
    fontWeight: "600",
  },
  profileButton: {
    width: CAPSULE_HEIGHT,
    height: CAPSULE_HEIGHT,
    borderRadius: CAPSULE_HEIGHT / 2,
    alignItems: "center",
    justifyContent: "center",
  },
});