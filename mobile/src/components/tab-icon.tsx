import Svg, { Path } from "react-native-svg";

export type TabIconName = "home" | "discover" | "watchlist" | "profile";

/**
 * Solid (FILL=1) Material Symbols Rounded glyphs.
 *
 * They are inlined as plain path data instead of going through a symbol font so
 * every platform (iOS, Android, web) renders exactly the same filled shape,
 * with no font download and no active/inactive variant switching — only the
 * color changes when a tab is focused.
 *
 * Source: Material Symbols (Apache-2.0), https://fonts.google.com/icons
 * Glyph coordinate space is 960x960 with the origin at 0/-960.
 */
const TAB_ICON_PATHS: Record<TabIconName, string> = {
  home: "M160-200v-360q0-19 8.5-36t23.5-28l240-180q21-16 48-16t48 16l240 180q15 11 23.5 28t8.5 36v360q0 33-23.5 56.5T720-120H600q-17 0-28.5-11.5T560-160v-200q0-17-11.5-28.5T520-400h-80q-17 0-28.5 11.5T400-360v200q0 17-11.5 28.5T360-120H240q-33 0-56.5-23.5T160-200Z",
  discover:
    "m335-310 202-58q20-6 34.5-20.5T592-423l58-202q3-11-5.5-19.5T625-650l-202 58q-20 6-34.5 20.5T368-537l-58 202q-3 11 5.5 19.5T335-310Zm145-110q-25 0-42.5-17.5T420-480q0-25 17.5-42.5T480-540q25 0 42.5 17.5T540-480q0 25-17.5 42.5T480-420Zm0 340q-83 0-156-31.5T197-197q-54-54-85.5-127T80-480q0-83 31.5-156T197-763q54-54 127-85.5T480-880q83 0 156 31.5T763-763q54 54 85.5 127T880-480q0 83-31.5 156T763-197q-54 54-127 85.5T480-80Z",
  watchlist:
    "m400-200-182 91q-20 10-39-1.5T160-145v-495q0-33 23.5-56.5T240-720h320q33 0 56.5 23.5T640-640v495q0 23-19 34.5t-39 1.5l-182-91Zm331.5-51.5Q720-263 720-280v-520H320q-17 0-28.5-11.5T280-840q0-17 11.5-28.5T320-880h400q33 0 56.5 23.5T800-800v520q0 17-11.5 28.5T760-240q-17 0-28.5-11.5Z",
  profile:
    "M367-527q-47-47-47-113t47-113q47-47 113-47t113 47q47 47 47 113t-47 113q-47 47-113 47t-113-47ZM160-240v-32q0-34 17.5-62.5T224-378q62-31 126-46.5T480-440q66 0 130 15.5T736-378q29 15 46.5 43.5T800-272v32q0 33-23.5 56.5T720-160H240q-33 0-56.5-23.5T160-240Z",
};

interface TabIconProps {
  name: TabIconName;
  /** Rendered size in dp. Defaults to 24. */
  size?: number;
  /** Fill color of the glyph. */
  color: string;
}

/** A filled, state-independent tab bar glyph. */
export function TabIcon({ name, size = 24, color }: TabIconProps) {
  return (
    <Svg width={size} height={size} viewBox="0 -960 960 960">
      <Path d={TAB_ICON_PATHS[name]} fill={color} />
    </Svg>
  );
}
