import React, { useEffect } from 'react';
import { useRouter } from 'expo-router';
import { YStack, Text, Button, Spinner, Avatar } from 'tamagui';
import { useAuth } from '@/context/AuthContext';

export default function ProfileScreen() {
  const { token, user, logout, isLoading } = useAuth();
  const router = useRouter();

  useEffect(() => {
    if (!isLoading && !token) {
      router.replace('/auth');
    }
  }, [isLoading, token]);

  if (isLoading) {
    return (
      <YStack f={1} ai="center" jc="center" bg="$background">
        <Spinner size="large" color="$color" />
      </YStack>
    );
  }

  if (!token || !user) {
    return null;
  }

  const handleLogout = async () => {
    await logout();
    router.replace('/auth');
  };

  return (
    <YStack f={1} ai="center" jc="center" bg="$background" px="$6" gap="$5">
      <YStack ai="center" gap="$3">
        <Avatar circular size="$8" bg="$purple10">
          <Avatar.Fallback bc="$purple10" jc="center" ai="center">
            <Text color="white" fow="bold" fos="$6">
              {user.email.substring(0, 2).toUpperCase()}
            </Text>
          </Avatar.Fallback>
        </Avatar>

        <YStack ai="center" gap="$1">
          <Text fow="900" fos="$7" color="$color" ta="center">
            My Profile
          </Text>
          <Text color="$color" opacity={0.6} fos="$4" ta="center">
            {user.email}
          </Text>
        </YStack>
      </YStack>

      <YStack w="100%" maxWidth={320} gap="$3" mt="$4">
        <Button
          size="$4"
          theme="red"
          bg="$red10"
          color="white"
          borderRadius="$4"
          fontWeight="bold"
          onPress={handleLogout}
        >
          Logout
        </Button>
      </YStack>
    </YStack>
  );
}
