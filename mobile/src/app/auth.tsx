import React, { useState } from "react";
import { Platform } from "react-native";
import { useRouter, useLocalSearchParams } from "expo-router";
import { SafeAreaView } from "react-native-safe-area-context";
import {
  Button,
  Input,
  Text,
  XStack,
  YStack,
  Spinner,
  Paragraph,
} from "tamagui";
import { useAuth } from "@/context/AuthContext";

export default function AuthScreen() {
  const router = useRouter();
  const { expired } = useLocalSearchParams<{ expired?: string }>();
  const { login, signup } = useAuth();

  const isExpired = expired === "true" || (Platform.OS === "web" && typeof window !== "undefined" && new URLSearchParams(window.location.search).get("expired") === "true");

  const [isLogin, setIsLogin] = useState(true);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const validateEmail = (val: string) => {
    return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(val);
  };

  const handleSubmit = async () => {
    setError(null);

    const trimmedEmail = email.trim();
    if (!trimmedEmail) {
      setError("Email is required.");
      return;
    }
    if (!validateEmail(trimmedEmail)) {
      setError("Please enter a valid email address.");
      return;
    }
    if (!password) {
      setError("Password is required.");
      return;
    }
    if (!isLogin && password.length < 6) {
      setError("Password must be at least 6 characters long.");
      return;
    }

    setLoading(true);
    try {
      if (isLogin) {
        await login(trimmedEmail, password);
      } else {
        await signup(trimmedEmail, password);
      }
      // Successful auth - navigate to Discover
      router.replace("/(tabs)/discover");
    } catch (err: any) {
      setError(err.message || "Authentication failed. Please check your details.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <YStack f={1} bg="$background">
      <SafeAreaView style={{ flex: 1 }}>
        <YStack f={1} px="$6" jc="center" gap="$6" maxWidth={480} alignSelf="center" w="100%">
          {/* Header & Back Action */}
          <XStack ai="center" jc="space-between" pos="absolute" top="$4" left="$4" right="$4">
            <Button
              size="$3"
              chromeless
              color="$color"
              onPress={() => router.replace("/(tabs)/discover")}
            >
              ← Skip to Browse
            </Button>
          </XStack>

          {/* Brand/Hero Section */}
          <YStack ai="center" gap="$2" mt="$6">
            <Text fos="$9" fow="900" color="$purple10" ta="center" letterSpacing={1}>
              NEXTON 🎬
            </Text>
            <Paragraph color="$color" opacity={0.6} ta="center" fos="$3">
              Your ultimate movie and TV show companion.
            </Paragraph>
          </YStack>

          {/* Session Expired Notice */}
          {isExpired && (
            <YStack
              bg="$purple2"
              borderColor="$purple8"
              borderWidth={1}
              p="$3"
              borderRadius="$4"
              gap="$1"
            >
              <Text color="$purple10" fos="$3" fow="800" ta="center">
                Session Expired ⚠️
              </Text>
              <Text color="$purple9" fos="$2" ta="center" fow="600">
                Your session has expired. Please log in again.
              </Text>
            </YStack>
          )}

          {/* Toggle Tab Row */}
          <XStack bg="$backgroundElement" p="$1" borderRadius="$5" mt="$3">
            <Button
              f={1}
              borderRadius="$4"
              bg={isLogin ? "$background" : "transparent"}
              color={isLogin ? "$color" : "$color10"}
              onPress={() => {
                setIsLogin(true);
                setError(null);
              }}
              size="$3.5"
            >
              Sign In
            </Button>
            <Button
              f={1}
              borderRadius="$4"
              bg={!isLogin ? "$background" : "transparent"}
              color={!isLogin ? "$color" : "$color10"}
              onPress={() => {
                setIsLogin(false);
                setError(null);
              }}
              size="$3.5"
            >
              Sign Up
            </Button>
          </XStack>

          {/* Form Fields */}
          <YStack gap="$4">
            <YStack gap="$1.5">
              <Text color="$color" fow="700" fos="$2" opacity={0.8}>
                Email Address
              </Text>
              <Input
                bg="$backgroundElement"
                borderColor="$borderColor"
                focusStyle={{ borderColor: "$purple8" }}
                color="$color"
                placeholder="your@email.com"
                placeholderTextColor="$color9"
                keyboardType="email-address"
                autoCapitalize="none"
                autoCorrect={false}
                value={email}
                onChangeText={setEmail}
                size="$4"
                borderRadius="$4"
              />
            </YStack>

            <YStack gap="$1.5">
              <Text color="$color" fow="700" fos="$2" opacity={0.8}>
                Password
              </Text>
              <Input
                bg="$backgroundElement"
                borderColor="$borderColor"
                focusStyle={{ borderColor: "$purple8" }}
                color="$color"
                placeholder="••••••••"
                placeholderTextColor="$color9"
                secureTextEntry
                autoCapitalize="none"
                autoCorrect={false}
                value={password}
                onChangeText={setPassword}
                size="$4"
                borderRadius="$4"
              />
              {!isLogin && (
                <Text color="$color" opacity={0.4} fos="$1" mt="$1">
                  Must be at least 6 characters long.
                </Text>
              )}
            </YStack>
          </YStack>

          {/* Error Banner */}
          {error && (
            <YStack bg="rgba(255, 0, 0, 0.1)" borderColor="$red8" borderWidth={1} p="$3" borderRadius="$4">
              <Text color="$red10" fos="$2" fow="600" ta="center">
                {error}
              </Text>
            </YStack>
          )}

          {/* Submit Action */}
          <Button
            size="$4.5"
            theme="purple"
            borderRadius="$4"
            disabled={loading}
            onPress={handleSubmit}
            fontWeight="bold"
            letterSpacing={0.5}
            bg="$purple10"
            color="white"
            pressStyle={{ opacity: 0.9 }}
          >
            {loading ? <Spinner color="white" /> : isLogin ? "Sign In" : "Create Account"}
          </Button>

          {/* Footer Text */}
          <YStack ai="center">
            <Text
              color="$purple9"
              fos="$2"
              fow="600"
              pressStyle={{ opacity: 0.7 }}
              onPress={() => setIsLogin(!isLogin)}
            >
              {isLogin ? "Don't have an account? Sign Up" : "Already have an account? Sign In"}
            </Text>
          </YStack>
        </YStack>
      </SafeAreaView>
    </YStack>
  );
}
