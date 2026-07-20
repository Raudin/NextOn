import React, { createContext, useContext, useEffect, useState } from "react";
import { Platform } from "react-native";
import * as SecureStore from "expo-secure-store";
import { setApiToken, loginUser, signupUser, type User } from "@/lib/media-api";

interface AuthContextType {
  token: string | null;
  user: User | null;
  isLoading: boolean;
  login: (email: string, password: string) => Promise<void>;
  signup: (email: string, password: string) => Promise<void>;
  logout: () => Promise<void>;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

const TOKEN_KEY = "nexton_auth_token";
const USER_KEY = "nexton_auth_user";

// Safe wrapper for Web fallback since SecureStore only runs on native platforms
const storage = {
  async setItem(key: string, value: string): Promise<void> {
    if (Platform.OS === "web") {
      try {
        localStorage.setItem(key, value);
      } catch (e) {
        console.warn("localStorage not available", e);
      }
    } else {
      await SecureStore.setItemAsync(key, value);
    }
  },

  async getItem(key: string): Promise<string | null> {
    if (Platform.OS === "web") {
      try {
        return localStorage.getItem(key);
      } catch (e) {
        return null;
      }
    } else {
      return await SecureStore.getItemAsync(key);
    }
  },

  async deleteItem(key: string): Promise<void> {
    if (Platform.OS === "web") {
      try {
        localStorage.removeItem(key);
      } catch (e) {
        // ignore
      }
    } else {
      await SecureStore.deleteItemAsync(key);
    }
  },
};

export const AuthProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [token, setToken] = useState<string | null>(null);
  const [user, setUser] = useState<User | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    async function loadStoredAuth() {
      try {
        const storedToken = await storage.getItem(TOKEN_KEY);
        const storedUserJson = await storage.getItem(USER_KEY);

        if (storedToken) {
          setToken(storedToken);
          setApiToken(storedToken);
        }

        if (storedUserJson) {
          setUser(JSON.parse(storedUserJson));
        }
      } catch (err) {
        console.error("Failed to load stored authentication", err);
      } finally {
        setIsLoading(false);
      }
    }
    loadStoredAuth();
  }, []);

  const login = async (email: string, password: string) => {
    const res = await loginUser({ email, password });
    if (res.token && res.user) {
      setToken(res.token);
      setUser(res.user);
      setApiToken(res.token);
      await storage.setItem(TOKEN_KEY, res.token);
      await storage.setItem(USER_KEY, JSON.stringify(res.user));
    } else {
      throw new Error("Invalid response from server");
    }
  };

  const signup = async (email: string, password: string) => {
    const res = await signupUser({ email, password });
    if (res.token && res.user) {
      setToken(res.token);
      setUser(res.user);
      setApiToken(res.token);
      await storage.setItem(TOKEN_KEY, res.token);
      await storage.setItem(USER_KEY, JSON.stringify(res.user));
    } else {
      throw new Error("Invalid response from server");
    }
  };

  const logout = async () => {
    setToken(null);
    setUser(null);
    setApiToken(null);
    await storage.deleteItem(TOKEN_KEY);
    await storage.deleteItem(USER_KEY);
  };

  return (
    <AuthContext.Provider value={{ token, user, isLoading, login, signup, logout }}>
      {children}
    </AuthContext.Provider>
  );
};

export function useAuth() {
  const context = useContext(AuthContext);
  if (context === undefined) {
    throw new Error("useAuth must be used within an AuthProvider");
  }
  return context;
}
