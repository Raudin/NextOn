import { createAnimations } from '@tamagui/animations-react-native'
import { config as configBase } from '@tamagui/config/v3'
import { createTamagui } from 'tamagui'

// Simple default animation driver for layout transitions
const animations = createAnimations({
  fast: {
    type: 'spring',
    damping: 20,
    mass: 1.2,
    stiffness: 250,
  },
  medium: {
    type: 'spring',
    damping: 15,
    stiffness: 120,
  },
  slow: {
    type: 'spring',
    damping: 15,
    stiffness: 40,
  },
})

const config = createTamagui({
  ...configBase,
  animations,
})

export type AppConfig = typeof config

declare module 'tamagui' {
  // Declaration merging: this interface is intentionally empty and gains its
  // members from AppConfig. The lint rule that flags empty interfaces does not
  // apply to module augmentation.
  // eslint-disable-next-line @typescript-eslint/no-empty-object-type
  interface TamaguiCustomConfig extends AppConfig {}
}

export default config