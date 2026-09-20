import * as SQLite from "expo-sqlite";

/**
 * On-device SQLite database.
 *
 * This is the local-first half of the architecture. Read payloads such as the
 * Home schedule are NOT normalised in here: the server already sends them
 * trimmed and de-duplicated (see `MediaDetailsLite`), and the shared response
 * cache serves them instantly and offline, so re-storing them relationally
 * would add a second source of truth for no measurable gain.
 *
 * What each table is for, and whether anything currently reads it:
 *
 *  - `watchlist`  mirrors the server list. WRITTEN by `replaceLocalWatchlist`
 *                 after every successful fetch and by delta apply; READ by
 *                 `getLocalWatchlist`, which backstops the Watchlist screen
 *                 when there is no cached payload and no connection.
 *  - `watched`    WRITTEN by delta apply. Has no reader today: the outbox
 *                 overlay covers changes this device has not sent yet, and the
 *                 response cache covers the server's state. It is kept so a
 *                 delta can be applied in full rather than silently dropping a
 *                 collection, and so an offline-first read path has somewhere
 *                 to start.
 *  - `favorites`  same as `watched`; there is no favourites screen yet.
 *  - `sync_state` the delta cursor. Read and written by `lib/sync.ts`.
 *  - `outbox`     queued offline mutations. Read by the drain and by the
 *                 reconciliation overlay, which is what makes an offline
 *                 mutation survive a restart.
 *
 * The store is opened lazily and cached, rather than through `SQLiteProvider`,
 * so the outbox can be drained from plain module code (on reconnect, in the
 * background) without needing a React tree to be mounted.
 */

export const LOCAL_DATABASE_NAME = "nexton.db";

/**
 * Schema version, tracked in SQLite's own `user_version` pragma.
 *
 * Bump this and add a step to `migrate` for any change. A migration must never
 * be shipped through an OTA update: DDL changes need a new native build.
 */
const SCHEMA_VERSION = 1;

/**
 * v1 schema.
 *
 * `watched` uses -1 rather than NULL for "no season/episode" so the primary key
 * works: SQLite treats NULLs as distinct in a PRIMARY KEY, so a movie row could
 * otherwise be inserted repeatedly.
 */
const SCHEMA_V1 = `
CREATE TABLE IF NOT EXISTS watchlist (
  media_type TEXT NOT NULL,
  media_id INTEGER NOT NULL,
  title TEXT,
  name TEXT,
  poster_path TEXT,
  backdrop_path TEXT,
  vote_average REAL,
  release_date TEXT,
  first_air_date TEXT,
  created_at TEXT,
  PRIMARY KEY (media_type, media_id)
);

CREATE TABLE IF NOT EXISTS favorites (
  media_type TEXT NOT NULL,
  media_id INTEGER NOT NULL,
  title TEXT,
  name TEXT,
  poster_path TEXT,
  backdrop_path TEXT,
  vote_average REAL,
  release_date TEXT,
  first_air_date TEXT,
  created_at TEXT,
  PRIMARY KEY (media_type, media_id)
);

CREATE TABLE IF NOT EXISTS watched (
  media_type TEXT NOT NULL,
  media_id INTEGER NOT NULL,
  season_number INTEGER NOT NULL DEFAULT -1,
  episode_number INTEGER NOT NULL DEFAULT -1,
  watched_at TEXT,
  PRIMARY KEY (media_type, media_id, season_number, episode_number)
);

CREATE TABLE IF NOT EXISTS sync_state (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS outbox (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  method TEXT NOT NULL,
  path TEXT NOT NULL,
  body TEXT,
  created_at INTEGER NOT NULL,
  attempts INTEGER NOT NULL DEFAULT 0
);

-- Queue order is the replay order, and it must be stable.
CREATE INDEX IF NOT EXISTS idx_outbox_created ON outbox (created_at, id);
`;

let databasePromise: Promise<SQLite.SQLiteDatabase> | null = null;

/**
 * Returns the shared database handle, opening and migrating on first use.
 *
 * A failed open clears the cached promise so a later call can retry instead of
 * permanently wedging the app on a transient error.
 */
export const getLocalDatabase = (): Promise<SQLite.SQLiteDatabase> => {
  if (!databasePromise) {
    databasePromise = openAndMigrate().catch((error) => {
      databasePromise = null;
      throw error;
    });
  }
  return databasePromise;
};

async function openAndMigrate(): Promise<SQLite.SQLiteDatabase> {
  const db = await SQLite.openDatabaseAsync(LOCAL_DATABASE_NAME);
  await migrate(db);
  return db;
}

export async function migrate(db: SQLite.SQLiteDatabase): Promise<void> {
  // WAL keeps reads from blocking on the outbox writer.
  await db.execAsync("PRAGMA journal_mode = WAL;");
  await db.execAsync("PRAGMA foreign_keys = ON;");

  const row = await db.getFirstAsync<{ user_version: number }>("PRAGMA user_version");
  const currentVersion = row?.user_version ?? 0;

  if (currentVersion >= SCHEMA_VERSION) {
    return;
  }

  if (currentVersion === 0) {
    await db.execAsync(SCHEMA_V1);
  }

  await db.execAsync(`PRAGMA user_version = ${SCHEMA_VERSION}`);
}

/**
 * Empties the user's local data. Called on sign-out and when the server asks
 * for a full resync, so a stale copy can never be shown to the next account on
 * the same device.
 */
export const clearLocalUserData = async (): Promise<void> => {
  const db = await getLocalDatabase();
  await db.withTransactionAsync(async () => {
    await db.execAsync(
      "DELETE FROM watchlist; DELETE FROM favorites; DELETE FROM watched; DELETE FROM outbox; DELETE FROM sync_state;",
    );
  });
};

/** Test/diagnostics escape hatch: drops the whole database file. */
export const deleteLocalDatabase = async (): Promise<void> => {
  const db = await getLocalDatabase();
  await db.closeAsync();
  databasePromise = null;
  await SQLite.deleteDatabaseAsync(LOCAL_DATABASE_NAME);
};
