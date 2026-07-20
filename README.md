# Nexton 🎬

Nexton is a comprehensive movie and TV show discovery, tracking, and watchlist application. It is structured as a monorepo consisting of a high-performance **Go (Gin) backend** and a modern **React Native/Expo frontend** powered by Tamagui.

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
├── backend/            # Go Gin web backend (GORM, SQLite)
└── src/                # React Native Expo frontend (Expo Router, Tamagui)
```

---

## ⚙️ Backend Setup

The Nexton backend is built with Go, the Gin Web Framework, GORM, and SQLite.

### Requirements
- Go (1.20+)

### Quick Start
1. Navigate into the backend directory:
   ```bash
   cd backend
   ```
2. Run the server using the high-fidelity dummy TMDB mock data fallback:
   ```bash
   TMDB_API_KEY=dummy go run main.go
   ```
   *Note: If you have a valid TMDB API key, replace `dummy` with your actual API key.*

### Configuration Details
- **Port**: Runs on `http://localhost:8080` by default.
- **Database**: Uses SQLite, writing to `nexton.db`.
- **Security**: Endpoint access is secured via JWT. Passwords are safely hashed using bcrypt.

---

## 📱 Frontend Setup

The Nexton frontend is built using Expo, Expo Router, Tamagui, and React Native Reanimated, tailored for universal platform delivery (iOS, Android, and Web).

### Requirements
- Node.js (v18+)
- `pnpm` (recommended package manager)

### Quick Start
1. Install dependencies from the root directory:
   ```bash
   pnpm install
   ```
2. Start the Metro Bundler and run in React Native Web mode:
   ```bash
   pnpm run web
   ```
   *Alternatively, run `pnpm run start` to open the interactive Expo CLI for iOS simulators/Android emulators.*

### Technical Highlights
- **Build Tooling**: Metro Bundler runs on port `8081`.
- **Styling**: Utilizes **Tamagui** and Tailwind/global CSS for ultra-responsive, fluid components and layouts.
- **Navigation**: Uses **Expo Router** for file-based native routing.
- **Token Management**: Utilizes `expo-secure-store` on native devices to securely store user authentication JWTs, falling back gracefully to `localStorage` on web platforms.

---

## 🛠️ Development & Support

- Refer to `AGENTS.md` for specific Expo versioning guidelines (v57.0.0).
- Run `pnpm run lint` or `npx expo lint` to ensure code adheres to the template standards.
