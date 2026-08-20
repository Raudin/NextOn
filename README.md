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

## 📁 Repository Structure

```text
nexton/
├── backend/            # Go Gin web backend (GORM, SQLite, Dokploy Dockerfile)
└── mobile/             # React Native Expo mobile app (Expo Router, Tamagui)
```

---

## ⚙️ Backend Setup & Deployment

The Nexton backend is built with Go, the Gin Web Framework, GORM, and SQLite.

### Local Quick Start
1. Navigate into the backend directory:
   ```bash
   cd backend
   ```
2. Run the server:
   ```bash
   TMDB_API_KEY=dummy go run .
   ```
   *Note: If you have a valid TMDB API key, replace `dummy` with your actual API key.*

### Deployment to VPS (Dokploy)
The `backend/` directory contains a multi-stage `Dockerfile` ready for deployment on Dokploy / VPS:
- **Environment Variables**:
  - `PORT`: Port to listen on (default `8080`)
  - `DB_PATH`: Path to SQLite DB file (default `/data/nexton.db`)
  - `TMDB_API_KEY`: TMDB API key or `dummy`
  - `JWT_SECRET`: Secret key for JWT token signing
- **Persistent Storage**: Mount a volume at `/data` in Dokploy so `nexton.db` persists across deployments.

---

## 📱 Mobile App Setup

The Nexton mobile frontend is built using Expo, Expo Router, Tamagui, and React Native Reanimated, tailored for native application delivery (iOS and Android).

### Requirements
- Node.js (v18+)
- `pnpm` (recommended package manager)

### Quick Start
1. Navigate into the mobile directory and install dependencies:
   ```bash
   cd mobile
   pnpm install
   ```
2. Start the interactive Expo CLI:
   ```bash
   pnpm run start
   ```
   *Alternatively, run `pnpm run android`, `pnpm run ios`, or `pnpm run web`.*

### Connecting to Deployed Backend
Set the `EXPO_PUBLIC_API_URL` environment variable to your deployed VPS backend URL:
```bash
EXPO_PUBLIC_API_URL=https://api.yourdomain.com pnpm run start
```

---

## 🛠️ Development & Support

- Refer to `AGENTS.md` for specific Expo versioning guidelines (v57.0.0).
- Run `pnpm run lint` inside `mobile/` to ensure code adheres to the template standards.
