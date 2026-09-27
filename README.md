# Nexton 🎬

Nexton is a comprehensive movie and TV show discovery, tracking, and watchlist application. It is structured as a monorepo consisting of a high-performance **Go (Gin) backend** and a modern **React Native/Expo mobile app** powered by Tamagui.

---

## 🚀 Key Features

- **Public Media Discovery & Search**: Browse trending movies, TV shows, and search for specific titles anonymously.
- **Detailed Media Views**: View rich details, summaries, ratings, and cast lists.
- **User Authentication**: Secure user registration, password hashing (via bcrypt), login, and JWT-based authentication.
- **Guarded Navigation & Protected Features**:
  - Restricted tabs (*Home, Watchlist, Profile*) and restricted actions (toggling watchlist or watched status) automatically redirect unauthenticated users to the login/auth screen.
- **Custom Watchlists & Watched History**: Track progress, add items to watchlists, and check off watched episodes or movies.
- **Platform-Native UI Card Experience**: Elegant, clean watchlist cards adhering to user-friendly design patterns (e.g., no direct "X" delete button directly on the card interface to prevent accidental deletion).

---

## 📡 How the Mobile App Communicates with the Backend

The React Native mobile app communicates with the Go backend via **HTTP/REST endpoints** delivering standard JSON responses.

### Key Architecture Details:
1. **API Client (`mobile/src/lib/media-api.ts`)**:
   - All network requests are routed through `apiFetch<T>(path, init)`.
   - On request execution, `apiFetch` dynamically constructs backend URLs using the base URL resolution logic.
2. **Environment Variable Configuration (`EXPO_PUBLIC_API_URL`)**:
   - Expo automatically exposes any environment variable prefixed with `EXPO_PUBLIC_` to the client bundle.
   - When `EXPO_PUBLIC_API_URL` is configured in `mobile/.env` or passed via environment variables (e.g. `EXPO_PUBLIC_API_URL=https://api.yourdomain.com`), the app prioritizes this URL for all backend API calls.
   - If `EXPO_PUBLIC_API_URL` is unset, `getBackendBaseUrls()` falls back to host IP discovery and standard development ports (`http://<host-ip>:8080`, `http://10.0.2.2:8080` for Android emulator, or `http://localhost:8080`).
3. **Authentication & JWT Token**:
   - Upon user login or registration (`/api/auth/login` or `/api/auth/signup`), the backend returns a JWT session token.
   - The token is saved in persistent storage (via `expo-secure-store` or `localStorage` fallback on web) and attached as a `Authorization: Bearer <token>` header to all subsequent API calls.
   - If an API request returns `401 Unauthorized`, a global callback clears the session and safely redirects the user to the auth screen.

---

## 📁 Repository Structure

```text
nexton/
├── backend/            # Go Gin web backend (GORM, SQLite, Dokploy Dockerfile)
└── mobile/             # React Native Expo mobile app (Expo Router, Tamagui)
```

---

## ⚙️ Backend Setup & Deployment

The Nexton backend is built with Go, the Gin Web Framework, GORM, and SQLite.

### 1. Environment Configuration (`backend/.env.example`)
Create a `.env` file or export environment variables on your host/server:
```env
PORT=8080
DB_PATH=/data/nexton.db
TMDB_API_KEY=your_tmdb_api_key_or_dummy
OMDB_API_KEY=your_omdb_api_key
JWT_SECRET=your_jwt_secret_key
# Optional. Unset means in-process caching only.
REDIS_URL=redis://redis:6379/0
```

**Optional Redis cache.** The backend runs without Redis. When `REDIS_URL` is
set and reachable it is used as a second-level cache for TMDB responses, the
Discover payload, and each user's derived schedule/watchlist payload; when it is
unset or unreachable the backend logs once at startup and uses its in-process
caches, and a mid-flight outage degrades performance rather than failing
requests. Per-user versioning (which drives ETag revalidation and delta sync)
lives in SQLite, not Redis, so correctness never depends on it.

### 2. Local Quick Start
```bash
cd backend
TMDB_API_KEY=dummy go run .
```

### 3. Delta Sync & ETag Revalidation
User data is served with a per-user version that advances on every mutation:

- `GET /api/sync/state` — cheap "has anything changed?" probe (version + per-collection counts).
- `GET /api/sync/changes?since=<version>` — the change log after the client's cursor, with inlined entity payloads so a client can apply a delta without follow-up requests. `resync_required` is set when the cursor has fallen outside the retained log.
- Derived payloads (`/api/home/schedule`, `/api/watchlist`) carry `ETag: W/"user-<id>-ver-<n>"`. Send it back as `If-None-Match` and an unchanged payload is answered with `304` before any database or TMDB work happens.

`Cache-Control` is set per route (`public` for Discover/media, `private, no-cache`
for per-user data, `no-store` for credentials and mutations), always with
`Vary: Authorization` on routes whose body depends on the caller. Note that React
Native's `fetch` has no HTTP cache, so the 304 win comes from the client sending
`If-None-Match` explicitly; a browser (Expo Web) honours the headers directly.

### 3. Deployment to VPS (e.g., Dokploy / Docker)
The `backend/` directory contains a multi-stage `Dockerfile` ready for deployment:
- **Environment Variables**:
  - `PORT`: Port to listen on (default `8080`)
  - `DB_PATH`: Path to SQLite DB file (default `/data/nexton.db`)
  - `TMDB_API_KEY`: TMDB API key or `dummy`
  - `OMDB_API_KEY`: OMDb API key used for IMDb, Metascore, and Rotten Tomatoes ratings
  - `JWT_SECRET`: Secret key for JWT token signing
- **Persistent Storage**: Mount a persistent volume at `/data` so `nexton.db` persists across container redeployments.

---

## 📱 Mobile App Environment & Setup

The Nexton mobile frontend is built using Expo, Expo Router, Tamagui, and React Native Reanimated.

### Mobile data layer

Four pieces, each with a single responsibility:

| Concern | Where | Notes |
| --- | --- | --- |
| Transport | `mobile/src/lib/http.ts` | Base-URL fallback, auth, timeouts, one retry on transient failures, a 6-request concurrency ceiling, in-flight coalescing for GETs, and conditional (`If-None-Match`) requests. React Native's `fetch` has **no** HTTP cache, so the 304 win comes from the client sending the validator explicitly — the server's `Cache-Control` matters for Expo Web and for a proxy. |
| Read cache | `mobile/src/lib/cache.ts` | Key-value cache with a default 24h TTL on every entry, a 2 MB byte budget with oldest-first eviction, a startup pass that purges dead legacy keys, and an audit that reports bytes per key. Backed by `expo-sqlite/kv-store`. |
| Local-first store | `mobile/src/lib/db/` | SQLite (WAL) holding the user's mutable entities, the sync cursor, and the offline outbox. |
| Delta sync | `mobile/src/lib/sync.ts`, `mobile/src/context/SyncContext.tsx` | Pushes queued mutations, then pulls changes after the stored cursor. Runs on launch, on foreground, and on a slow timer while mutations are pending. |

**Offline behaviour.** Reads fall back to the last cached payload, so Home and
Watchlist open with real data in airplane mode. A mutation that cannot reach the
server is queued in the outbox and replayed on reconnect; the screens update
optimistically either way, so the user sees the change immediately. Replay is
safe without idempotency keys because every mutating endpoint is idempotent by
construction (adding an existing watchlist entry is a no-op; marking an episode
watched is an upsert).

**Artwork budget.** Every image declares a *role* (`mobile/src/lib/images.ts`)
that selects both the TMDB bucket and the cache policy. This is not cosmetic:
the original code requested `w500` for every poster, including 60pt list cells,
which is the largest single contributor to the on-device image cache. Large
one-shot artwork (backdrops, logos) is kept in memory only. `src/lib/image-usage.test.ts`
fails the build if a new image drops its role argument or its cache policy.

The image disk cache cannot be capped or measured from JavaScript — expo-image
exposes no size API — so it is bounded by right-sizing plus a 30-day generational
clear (`mobile/src/lib/image-cache.ts`), with a manual **Clear image cache**
control in Profile → Storage for when a user is low on space.

**Platform-native UI.** Three controls are drawn with **Jetpack Compose on
Android** through `@expo/ui`, while iOS and web keep the implementations they
always had:

| Feature | Shared entry point | Android (`*.android.tsx`) |
| --- | --- | --- |
| Confirmation alerts | `mobile/src/components/ui/ConfirmDialog.tsx` | Material 3 `AlertDialog`; iOS uses `Alert`, web uses `window.confirm` |
| TV show progress | `mobile/src/components/Watchlist/ProgressBarFill.tsx`, `ProgressRing.tsx` | `LinearProgressIndicator` and `CircularProgressIndicator` |
| Notifications toggle | `mobile/src/components/Profile/SettingsSwitch.tsx` | Material 3 `Switch` |

Metro resolves the `.android.tsx` file on Android and the default file
everywhere else, which is the same platform-split the app already uses for
`.web.tsx`. Each pair shares one props module (`progress-props.ts`,
`settings-switch.ts`, `confirm-dialog.types.ts`) so the variants cannot drift,
and every Compose component is passed explicit colours from
`mobile/src/hooks/use-theme.ts` so Material You does not override the app's
palette.

The dialog is declarative rather than an `Alert.alert` call precisely because of
this: Compose's `AlertDialog` has to be mounted inside a `Host` in the tree. The
state reducer behind it is unit-tested (`confirm-dialog-state.test.ts`); the rest
is verified on a device, per the policy in `mobile/jest.config.js`.

### 1. Configure Environment Variables
Copy `.env.example` to `.env` inside the `mobile` directory:
```bash
cd mobile
cp .env.example .env
```
Edit `mobile/.env` and update `EXPO_PUBLIC_API_URL` to point to your live backend endpoint:
```env
EXPO_PUBLIC_API_URL=https://api.yourdomain.com
```

### 2. Install Dependencies & Quick Start
```bash
cd mobile
pnpm install
pnpm run start
```
*Alternatively, run `pnpm run android`, `pnpm run ios`, or `pnpm run web`.*

Run the mobile test suite and linters with:
```bash
cd mobile
pnpm test        # jest (pure logic and storage seams)
pnpm run lint
npx tsc --noEmit
```

> **A new native build is required.** `expo-sqlite` and `@shopify/flash-list`
> were added as native dependencies, so an existing dev client or an OTA update
> will not pick them up. Both are included in Expo Go for SDK 57, so
> `pnpm run start` works for local testing; ship a fresh EAS build for
> `preview`/`production`.
>
> `@expo/ui` is in the same position, and on Android it also needs a **clean
> prebuild** the first time: regenerate the native project with
> `npx expo prebuild --clean -p android` before `npx expo run:android`, so the
> `ExpoUI` module is autolinked. It is included in Expo Go for SDK 57 as well,
> so `pnpm run android` remains the quickest way to check the Compose controls.

### 3. Building for Production / Live Usage
When building native apps (using EAS Build or local native builds) or web distributions, Expo embeds `EXPO_PUBLIC_API_URL` from `.env` into the bundle:
```bash
# Build Expo Web distribution
cd mobile
EXPO_PUBLIC_API_URL=https://api.yourdomain.com pnpm run web

# Or build native apps using EAS
eas build --platform all
```

---

## 🛠️ Development & Support

- Refer to `AGENTS.md` for specific Expo versioning guidelines (v57.0.0).
- Run `pnpm run lint` inside `mobile/` to ensure code adheres to the template standards.
