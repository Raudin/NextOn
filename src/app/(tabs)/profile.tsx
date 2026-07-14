import React from 'react';
import { YStack, Text } from 'tamagui';

export default function ProfileScreen() {
  return (
    <YStack f={1} ai="center" jc="center" bg="$background" px="$4">
      <Text fow="bold" fos="$8" color="$color" ta="center">Profile</Text>
      <Text color="$colorMuted" mt="$2" ta="center">
        Manage your account, history, and preferences here.
      </Text>
    </YStack>
  );
}
