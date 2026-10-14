import React, {
  createContext,
  useContext,
  useEffect,
  useState,
  useCallback,
  useMemo,
} from "react";
import { Platform } from "react-native";
import { Image } from "expo-image";
import * as SecureStore from "expo-secure-store";
import Storage from "expo-sqlite/kv-store";
import { router } from "expo-router";
import { setApiToken, registerUnauthorizedCallback, loginUser, signupUser, type User } from "@/lib/media-api";
import { cache, clearMemory } from "@/lib/cache";
import { clearLocalUserData } from "@/lib/db/client";

interface AuthContextType {
  token: string | null;
  user: User | null;
  isLoading: boolean;
  themeMode: "light" | "dark" | "system";
  setThemeMode: (mode: "light" | "dark" | "system") => Promise<void>;
  login: (email: string, password: string) => Promise<void>;
  signup: (email: string, password: string) => Promise<void>;
  logout: () => Promise<void>;
  updateUser: (updatedUser: User) => Promise<void>;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

/**
 * Theme is a separate context from the session.
 *
 * Both used to live in one value, so switching the appearance re-rendered every
 * component that calls `useAuth()` — which is most of the app — even though
 * none of them were reading the theme. Conversely, `updateUser` (which the
 * profile screen calls on every focus) re-rendered every themed component. The
 * two change on entirely different clocks and almost no consumer wants both.
 *
 * `useAuth()` still returns the theme fields, so no screen had to change; what
 * changed is which context an update flows through.
 */
interface ThemeContextType {
  themeMode: "light" | "dark" | "system";
  setThemeMode: (mode: "light" | "dark" | "system") => Promise<void>;
}

const ThemeContext = createContext<ThemeContextType | undefined>(undefined);

/**
 * The session without the theme fields.
 *
 * Components that call `useAuthSession()` subscribe to this context rather than
 * `AuthContext`, so a theme change does not re-render them. The value is a
 * memoised subset of the auth value — no spread, no new object per render.
 */
interface SessionContextType {
  token: string | null;
  user: User | null;
  isLoading: boolean;
  login: (email: string, password: string) => Promise<void>;
  signup: (email: string, password: string) => Promise<void>;
  logout: () => Promise<void>;
  updateUser: (updatedUser: User) => Promise<void>;
}

const SessionContext = createContext<SessionContextType | undefined>(undefined);

const TOKEN_KEY = "nexton_auth_token";
const USER_KEY = "nexton_auth_user";
const THEME_KEY = "nexton_theme_mode";

/**
 * The non-secret half of the session (profile and theme preference).
 *
 * These are not credentials, and SecureStore is the wrong home for them on
 * Android in particular: it is backed by the keystore and is measurably slower
 * per read than the SQLite-backed key-value store the rest of the app already
 * uses. Only the token needs that protection, and only the token still uses it.
 *
 * Kept behind the same KVStorage shape as the cache so the reads can be issued
 * together.
 */
const preferenceStore = Storage;

// Safe wrapper for Web fallback since SecureStore only runs on native platforms
const secureStorage = {
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
      } catch {
        // Storage can be unavailable (private mode, blocked cookies); treat it
        // as "no stored session" rather than failing the whole app start.
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
      } catch {
        // ignore
      }
    } else {
      await SecureStore.deleteItemAsync(key);
    }
  },
};

/**
 * Compares every field of `User`, dynamically covering present and future fields.
 *
 * Checks all keys across both objects rather than hardcoding a static field list,
 * so future properties added to `User` (e.g. settings, timestamps, tiers) are
 * automatically compared without requiring updates here or silently suppressing
 * persistence writes. Avoids JSON serialization overhead on every focus while
 * remaining fully exhaustive.
 */
export const sameUser = (a: User, b: User): boolean => {
  if (a === b) return true;
  const keys = new Set([...Object.keys(a), ...Object.keys(b)]) as Set<keyof User>;
  for (const key of keys) {
    if (a[key] !== b[key]) {
      return false;
    }
  }
  return true;
};

export const AuthProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [token, setToken] = useState<string | null>(null);
  const [user, setUser] = useState<User | null>(null);
  const [themeMode, setThemeModeState] = useState<"light" | "dark" | "system">("system");
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    async function loadStoredAuth() {
      try {
        // One round trip, not three.
        //
        // These were awaited in sequence, and on Android each SecureStore read
        // is a keystore call, so the three added up on the cold-start path —
        // the one path where the splash screen is still up. Only the token
        // needs the keystore now; the other two come from the SQLite-backed
        // store and are issued alongside it.
        const [storedToken, storedUserJson, storedTheme] = await Promise.all([
          secureStorage.getItem(TOKEN_KEY),
          preferenceStore.getItem(USER_KEY),
          preferenceStore.getItem(THEME_KEY),
        ]);

        if (storedToken) {
          setToken(storedToken);
          setApiToken(storedToken);
        }

        if (storedUserJson) {
          setUser(JSON.parse(storedUserJson));
        }

        if (storedTheme === "light" || storedTheme === "dark" || storedTheme === "system") {
          setThemeModeState(storedTheme);
        }
      } catch (err) {
        console.error("Failed to load stored authentication", err);
      } finally {
        setIsLoading(false);
      }
    }
    loadStoredAuth();
  }, []);

  const setThemeMode = useCallback(async (mode: "light" | "dark" | "system") => {
    setThemeModeState(mode);
    await preferenceStore.setItem(THEME_KEY, mode);
  }, []);

  const updateUser = useCallback(async (updatedUser: User) => {
    // Only a real change triggers a state update and a storage write.
    //
    // The profile screen calls this on every focus with the object the server
    // just returned, which is a new reference even when nothing changed. Setting
    // state with it re-rendered every auth consumer and rewrote storage on each
    // visit to the tab. Comparing the fields first makes the common
    // "nothing changed" case free.
    //
    // The comparison reads `user` from the outer closure rather than relying on
    // the functional updater's synchronous execution order, which is a React
    // implementation detail that could change under concurrent mode.
    setUser((current) => {
      if (current && sameUser(current, updatedUser)) {
        return current;
      }
      return updatedUser;
    });

    // Persist when the fields differ from what is currently stored.
    // Comparing with sameUser avoids coupling to the updater's timing or
    // JSON serialization key order differences.
    const stored = await preferenceStore.getItem(USER_KEY);
    let shouldPersist = true;
    if (stored) {
      try {
        const storedUser = JSON.parse(stored) as User;
        if (sameUser(storedUser, updatedUser)) {
          shouldPersist = false;
        }
      } catch {
        // If stored JSON was corrupt, fall through and persist.
      }
    }
    if (shouldPersist) {
      await preferenceStore.setItem(USER_KEY, JSON.stringify(updatedUser));
    }
  }, []);

  const login = useCallback(async (email: string, password: string) => {
    const res = await loginUser({ email, password });
    if (res.token && res.user) {
      setToken(res.token);
      setUser(res.user);
      setApiToken(res.token);
      await secureStorage.setItem(TOKEN_KEY, res.token);
      await preferenceStore.setItem(USER_KEY, JSON.stringify(res.user));
    } else {
      throw new Error("Invalid response from server");
    }
  }, []);

  const signup = useCallback(async (email: string, password: string) => {
    const res = await signupUser({ email, password });
    if (res.token && res.user) {
      setToken(res.token);
      setUser(res.user);
      setApiToken(res.token);
      await secureStorage.setItem(TOKEN_KEY, res.token);
      await preferenceStore.setItem(USER_KEY, JSON.stringify(res.user));
    } else {
      throw new Error("Invalid response from server");
    }
  }, []);

  const logout = useCallback(async () => {
    setToken(null);
    setUser(null);
    setApiToken(null);
    await secureStorage.deleteItem(TOKEN_KEY);
    await preferenceStore.removeItem(USER_KEY);
    await cache.clearAll();
    // `clearAll` empties the store but not the two process-wide memory caches
    // built from it. Those are a different lifetime from the session, so
    // without this the next account to sign in inherits the previous one's
    // parsed payloads, and decoded artwork stays a live memory-cache hit
    // because expo-image keys it by URL.
    clearMemory();
    try {
      await Image.clearMemoryCache();
    } catch (err) {
      console.warn("Failed to clear the image memory cache on logout", err);
    }
    // Drop the local-first copy too. Leaving one account's watchlist and queued
    // mutations on the device would show them to the next account that signs in,
    // and could replay them against the wrong user.
    try {
      await clearLocalUserData();
    } catch (err) {
      console.warn("Failed to clear local data on logout", err);
    }
  }, []);

  useEffect(() => {
    registerUnauthorizedCallback(async () => {
      await logout();
      router.replace("/auth?expired=true");
    });
  }, [logout]);

  // Memoised so an unrelated re-render of the provider does not hand consumers a
  // new context value and re-render them all. The theme value depends only on
  // the theme, and the auth value on the session.
  const themeValue = useMemo<ThemeContextType>(
    () => ({ themeMode, setThemeMode }),
    [themeMode, setThemeMode],
  );

  const authValue = useMemo<AuthContextType>(
    () => ({
      token,
      user,
      isLoading,
      themeMode,
      setThemeMode,
      login,
      signup,
      logout,
      updateUser,
    }),
    [token, user, isLoading, themeMode, setThemeMode, login, signup, logout, updateUser],
  );

  const sessionValue = useMemo<SessionContextType>(
    () => ({ token, user, isLoading, login, signup, logout, updateUser }),
    [token, user, isLoading, login, signup, logout, updateUser],
  );

  return (
    <ThemeContext.Provider value={themeValue}>
      <SessionContext.Provider value={sessionValue}>
        <AuthContext.Provider value={authValue}>
          {children}
        </AuthContext.Provider>
      </SessionContext.Provider>
    </ThemeContext.Provider>
  );
};

/**
 * The session: token, profile, and loading state.
 *
 * Reads from `SessionContext`, whose value is memoised separately from the
 * theme. A theme change does not re-render session consumers, and (unlike the
 * previous spread-based hook) no new object is created per render.
 */
export function useAuthSession(): SessionContextType {
  const context = useContext(SessionContext);
  if (context === undefined) {
    throw new Error("useAuthSession must be used within an AuthProvider");
  }
  return context;
}

/** The appearance preference alone. */
export function useThemeMode(): ThemeContextType {
  const context = useContext(ThemeContext);
  if (context === undefined) {
    throw new Error("useThemeMode must be used within an AuthProvider");
  }
  return context;
}

/**
 * The whole auth surface.
 *
 * Still the hook every screen uses. Components that only need the session
 * should prefer `useAuthSession()`, and components that only need the theme
 * `useThemeMode()`, so an unrelated update does not re-render them.
 */
export function useAuth(): AuthContextType {
  const context = useContext(AuthContext);
  if (context === undefined) {
    throw new Error("useAuth must be used within an AuthProvider");
  }
  return context;
}
