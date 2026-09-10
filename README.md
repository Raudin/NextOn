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
```

### 2. Local Quick Start
```bash
cd backend
TMDB_API_KEY=dummy go run .
```

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
