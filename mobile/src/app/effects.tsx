import React, { useCallback, useState } from "react";
import { Pressable, ScrollView, StyleSheet } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Text, XStack, YStack, useThemeName } from "tamagui";

import {
  BorderBeam,
  WEB_DEMO_PULSE_PRESET,
  type BorderBeamColorVariant,
  type BorderBeamSize,
} from "border-beam-native";
import { STATE_TO_MODE, ThinkingOrb, type OrbState } from "thinking-orbs-native";

/**
 * Visual bench for the two React Native effect ports under `../packages`.
 *
 * This screen exists so both ports can be verified in **Expo Go** — where Skia
 * and Reanimated are the versions Expo Go ships (Skia 2.6.2 on SDK 57), which
 * are not necessarily the versions a dev build would link — before either port
 * is wired into a real screen. It is also where the consumer tuning props get
 * eyeballed against the web demos.
 *
 * Deliberate stress cases, not oversights:
 *  - Every BorderBeam preset renders at once, including `pulse-outside`, whose
 *    glow is drawn OUTSIDE the element's bounds at zIndex -1 and therefore
 *    requires an opaque wrapped child (every card here sets its own background).
 *  - All nine orbs animate together. The port records a frame on the JS thread
 *    per orb per frame, so nine live orbs is the worst case worth checking for
 *    frame pacing on a physical device.
 *
 * Both ports read their theme from the OS by default (`theme="auto"`), which is
 * wrong for this app when the user pins an appearance — the app's effective
 * theme comes from `AuthContext` via the Tamagui provider, so this screen reads
 * it back with `useThemeName()`.
 */

const SIZES: BorderBeamSize[] = ["sm", "md", "line", "pulse-outside", "pulse-inner"];
const VARIANTS: BorderBeamColorVariant[] = ["colorful", "mono", "ocean", "sunset"];

/** Sourced from the engine so this screen cannot drift from the port. */
const ORB_STATES = Object.keys(STATE_TO_MODE) as OrbState[];

function Chip({
  label,
  selected,
  onPress,
}: {
  label: string;
  selected?: boolean;
  onPress: () => void;
}) {
  return (
    <Pressable onPress={onPress} style={[styles.chip, selected ? styles.chipSelected : null]}>
      <Text color="$color" fow="700" fos="$1" opacity={selected ? 1 : 0.6}>
        {label}
      </Text>
    </Pressable>
  );
}

function SectionTitle({ children }: { children: string }) {
  return (
    <Text color="$color" fow="900" fos="$2" letterSpacing={0.5} opacity={0.7}>
      {children}
    </Text>
  );
}

/** One BorderBeam preset wrapped around an opaque card. */
function BeamCard({
  size,
  variant,
  theme,
  active,
  staticColors,
  tuning,
  onActivate,
  onDeactivate,
}: {
  size: BorderBeamSize;
  variant: BorderBeamColorVariant;
  theme: "dark" | "light";
  active: boolean;
  staticColors: boolean;
  tuning: boolean;
  onActivate: () => void;
  onDeactivate: () => void;
}) {
  return (
    <BorderBeam
      size={size}
      colorVariant={variant}
      theme={theme}
      active={active}
      staticColors={staticColors}
      borderRadius={16}
      tuning={tuning ? WEB_DEMO_PULSE_PRESET : undefined}
      onActivate={onActivate}
      onDeactivate={onDeactivate}
    >
      {/* Opaque child: `pulse-outside` draws its glow behind it. */}
      <YStack bg="$backgroundElement" br={16} p="$4" gap="$1" width={228}>
        <Text color="$color" fow="800" fos="$3">
          {size}
        </Text>
        <Text color="$color" opacity={0.6} fos="$1">
          {variant} · {staticColors ? "static colors" : "hue shifting"}
          {tuning ? " · demo tuning" : ""}
        </Text>
      </YStack>
    </BorderBeam>
  );
}

export default function EffectsScreen() {
  // The app's effective appearance, not the OS's: this app can pin one.
  const themeName = useThemeName();
  const appTheme: "dark" | "light" = themeName === "light" ? "light" : "dark";

  const [active, setActive] = useState(true);
  const [staticColors, setStaticColors] = useState(false);
  const [tuning, setTuning] = useState(false);
  const [variant, setVariant] = useState<BorderBeamColorVariant>("colorful");
  const [orbsPaused, setOrbsPaused] = useState(false);
  const [fades, setFades] = useState({ in: 0, out: 0 });

  // Stable identities: BorderBeam's fade effect depends on these callbacks.
  const handleActivate = useCallback(() => {
    setFades((current) => ({ ...current, in: current.in + 1 }));
  }, []);
  const handleDeactivate = useCallback(() => {
    setFades((current) => ({ ...current, out: current.out + 1 }));
  }, []);

  return (
    <YStack f={1} bg="$background">
      <SafeAreaView style={styles.flex} edges={["top"]}>
        <ScrollView
          showsVerticalScrollIndicator={false}
          contentContainerStyle={styles.scrollContent}
        >
          <YStack px="$4" pt="$2" pb="$5" gap="$5" maxWidth={600} alignSelf="center" w="100%">
            <YStack gap="$1">
              <Text color="$color" fow="900" fos="$6">
                Effects bench
              </Text>
              <Text color="$color" opacity={0.6} fos="$2">
                border-beam-native · thinking-orbs-native · app theme {appTheme}
              </Text>
            </YStack>

            <YStack
              gap="$3"
              bg="$backgroundElement"
              borderWidth={1}
              borderColor="$borderColor"
              br="$4"
              p="$3.5"
            >
              <SectionTitle>BORDER BEAM CONTROLS</SectionTitle>
              <XStack gap="$2" flexWrap="wrap">
                {VARIANTS.map((option) => (
                  <Chip
                    key={option}
                    label={option}
                    selected={option === variant}
                    onPress={() => setVariant(option)}
                  />
                ))}
              </XStack>
              <XStack gap="$2" flexWrap="wrap">
                <Chip
                  label={`active: ${active ? "on" : "off"}`}
                  selected={active}
                  onPress={() => setActive((current) => !current)}
                />
                <Chip
                  label={`static colors: ${staticColors ? "on" : "off"}`}
                  selected={staticColors}
                  onPress={() => setStaticColors((current) => !current)}
                />
                <Chip
                  label={`demo tuning: ${tuning ? "on" : "off"}`}
                  selected={tuning}
                  onPress={() => setTuning((current) => !current)}
                />
              </XStack>
              <Text color="$color" opacity={0.6} fos="$1">
                fade-ins {fades.in} · fade-outs {fades.out}
              </Text>
            </YStack>

            <YStack gap="$4">
              <SectionTitle>BORDER BEAM — ALL FIVE PRESETS</SectionTitle>
              {/* 40px: `pulse-outside` blooms 30px past the card (beam-spec bloomInsetPx). */}
              <YStack gap={40} ai="center" w="100%">
                {SIZES.map((size) => (
                  <BeamCard
                    key={size}
                    size={size}
                    variant={variant}
                    theme={appTheme}
                    active={active}
                    staticColors={staticColors}
                    tuning={tuning}
                    onActivate={handleActivate}
                    onDeactivate={handleDeactivate}
                  />
                ))}
              </YStack>
            </YStack>

            <YStack
              gap="$3"
              bg="$backgroundElement"
              borderWidth={1}
              borderColor="$borderColor"
              br="$4"
              p="$3.5"
            >
              <SectionTitle>THINKING ORB CONTROLS</SectionTitle>
              <XStack gap="$2" flexWrap="wrap">
                <Chip
                  label={orbsPaused ? "paused" : "running"}
                  selected={orbsPaused}
                  onPress={() => setOrbsPaused((current) => !current)}
                />
              </XStack>
              <Text color="$color" opacity={0.6} fos="$1">
                Nine orbs animate together on purpose: the port records one frame per orb per
                frame on the JS thread, so this is the worst case for frame pacing.
              </Text>
            </YStack>

            <YStack gap="$4">
              <SectionTitle>ORBS — NINE STATES AT size 64</SectionTitle>
              <XStack gap="$3" flexWrap="wrap" jc="center">
                {ORB_STATES.map((state) => (
                  <YStack key={state} ai="center" gap="$1" width={96}>
                    <ThinkingOrb state={state} size={64} theme={appTheme} paused={orbsPaused} />
                    <Text color="$color" opacity={0.6} fos="$1" numberOfLines={1}>
                      {state}
                    </Text>
                  </YStack>
                ))}
              </XStack>
            </YStack>

            <YStack gap="$3">
              <SectionTitle>ORBS — size 20 (inline scale)</SectionTitle>
              <XStack gap="$4" ai="center" flexWrap="wrap">
                {ORB_STATES.map((state) => (
                  <ThinkingOrb
                    key={state}
                    state={state}
                    size={20}
                    theme={appTheme}
                    paused={orbsPaused}
                  />
                ))}
              </XStack>
            </YStack>

            <YStack gap="$3" pb="$4">
              <SectionTitle>ORBS — displaySize AND speed</SectionTitle>
              <XStack gap="$5" ai="center" flexWrap="wrap">
                {/* The 64 preset's geometry, redrawn vector-crisp at another size. */}
                <YStack ai="center" gap="$1">
                  <ThinkingOrb
                    state="solving"
                    size={64}
                    displaySize={112}
                    theme={appTheme}
                    paused={orbsPaused}
                  />
                  <Text color="$color" opacity={0.6} fos="$1">
                    112dp
                  </Text>
                </YStack>
                <YStack ai="center" gap="$1">
                  <ThinkingOrb
                    state="solving"
                    size={64}
                    displaySize={32}
                    theme={appTheme}
                    paused={orbsPaused}
                  />
                  <Text color="$color" opacity={0.6} fos="$1">
                    32dp
                  </Text>
                </YStack>
                <YStack ai="center" gap="$1">
                  <ThinkingOrb
                    state="solving"
                    size={64}
                    speed={3}
                    theme={appTheme}
                    paused={orbsPaused}
                  />
                  <Text color="$color" opacity={0.6} fos="$1">
                    speed 3x
                  </Text>
                </YStack>
              </XStack>
            </YStack>
          </YStack>
        </ScrollView>
      </SafeAreaView>
    </YStack>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  scrollContent: { paddingBottom: 120 },
  chip: {
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: "rgba(128,128,128,0.4)",
  },
  chipSelected: { borderColor: "rgba(128,128,128,0.9)" },
});


