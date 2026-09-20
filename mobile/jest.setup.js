/**
 * Jest setup.
 *
 * Native modules with no JS implementation under Node are stubbed here so the
 * modules under test can be imported. Tests that need a real database are
 * deliberately absent (see jest.config.js): the stub exists so pure logic and
 * storage seams can be exercised, not to simulate SQLite.
 */

/**
 * `expo-sqlite/kv-store` is the cache module's backing store. An in-memory
 * implementation lets the real code path run under test — TTLs, the byte
 * budget, eviction ordering — instead of a hand-rolled fake that could drift
 * from the real API.
 */
jest.mock("expo-sqlite/kv-store", () => {
  const map = new Map();
  const storage = {
    getItem: async (key) => (map.has(key) ? map.get(key) : null),
    setItem: async (key, value) => {
      map.set(key, String(value));
    },
    removeItem: async (key) => {
      map.delete(key);
    },
    multiRemove: async (keys) => {
      for (const key of keys) {
        map.delete(key);
      }
    },
    getAllKeys: async () => Array.from(map.keys()),
    multiGet: async (keys) =>
      keys.map((key) => [key, map.has(key) ? map.get(key) : null]),
    clear: async () => {
      map.clear();
    },
    // Test-only hook, not part of the real API.
    __clear: () => map.clear(),
  };
  return { __esModule: true, default: storage, Storage: storage, AsyncStorage: storage };
});

jest.mock("expo-sqlite", () => ({
  openDatabaseAsync: jest.fn(async () => {
    throw new Error(
      "expo-sqlite is not available in tests; test pure logic instead.",
    );
  }),
  deleteDatabaseAsync: jest.fn(async () => {}),
}));

// expo-image is a native view with no work to assert in a unit test.
jest.mock("expo-image", () => ({
  Image: {
    clearDiskCache: jest.fn(async () => true),
    clearMemoryCache: jest.fn(async () => true),
    prefetch: jest.fn(async () => true),
  },
}));

// Keep the deliberate diagnostics output from these modules out of the run.
global.console = {
  ...global.console,
  log: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
};
