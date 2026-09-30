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
  - `METRICS_ADDR`: Address for the Prometheus exposition listener (the image defaults to `:9090`; unset disables it entirely)
  - `METRICS_TOKEN`: Optional bearer token for that listener. Leave unset for an in-network scrape
  - `APP_VERSION`: Optional label reported as `nexton_build_info{version=...}`
- **Persistent Storage**: Mount a persistent volume at `/data` so `nexton.db` persists across container redeployments.

See [Monitoring](#4-monitoring-prometheus--grafana) for the metrics the service exposes and how to stand up Prometheus and Grafana next to it.

### 4. Monitoring (Prometheus + Grafana)

`backend/metrics.go` has always maintained the numbers that matter for this service — per-route latency and errors, outbound TMDB/OMDb call counts, Redis hit and error rates. Until now the only way to read them was `/api/debug/stats`, which release mode deliberately does not register, so production was unobservable. `backend/prometheus.go` is the scrapeable view of those same counters.

**Design rules worth knowing before changing any of it:**

- **The counters are not duplicated.** The process-wide totals are read from the existing atomics through `CounterFunc` at scrape time, so `/api/debug/stats` and Prometheus cannot disagree, and the request path gained no extra increments. Only the per-request observations (status, latency, response size) are recorded separately, because a histogram cannot be reconstructed from a total.
- **The exposition is on its own listener**, `METRICS_ADDR` (the image sets `:9090`), not a route on the API router. The API answers on a public domain; keeping metrics off it means a routing mistake cannot expose traffic patterns, and it is why an in-network scrape needs no credentials.
- **Unset means off**, the same convention `REDIS_URL` uses: one log line and no listener.
- **Labels are bounded by construction.** `route` is always a gin route pattern or the literal `unmatched`, never a raw URL.

**Metrics exposed**

| Metric | Type | Notes |
| --- | --- | --- |
| `nexton_http_requests_total{route,method,status}` | counter | 304s are included, so the ETag revalidation win is a `status` filter away |
| `nexton_http_request_duration_seconds{route,method}` | histogram | Buckets reach 10s because TMDB fan-out dominates |
| `nexton_http_response_size_bytes{route}` | histogram | The only direct measurement of the payload budget |
| `nexton_http_requests_in_flight` | gauge | A sustained climb points at outbound calls, not inbound traffic |
| `nexton_route_tmdb_calls_total{route}` | counter | Outbound fan-out per route — divide by the request rate for calls *per request* |
| `nexton_route_omdb_calls_total{route}`, `nexton_route_omdb_store_lookups_total{route}` | counter | The same, for OMDb |
| `nexton_tmdb_fetches_total`, `nexton_tmdb_cache_hits_total`, `nexton_tmdb_cache_misses_total` | counter | The caching design's scoreboard |
| `nexton_omdb_fetches_total`, `nexton_omdb_store_hits_total`, `nexton_omdb_store_misses_total` | counter | Ratings resolved in the background rather than on the request path |
| `nexton_redis_cache_hits_total`, `nexton_redis_cache_misses_total`, `nexton_redis_errors_total` | counter | `nexton_redis_errors_total` is the only visible signal of a bad `REDIS_URL`, because the fallback is silent by design |
| `nexton_uptime_seconds`, `nexton_build_info` | gauge | Uptime resets, and which rollout is running |
| `go_*`, `process_*` | — | Goroutines, heap, GC, RSS and file descriptors from the standard collectors |

The deployment artifacts live in `monitoring/`: `prometheus.yml` (the scrape config, which becomes the `prometheus.yml` File Mount), `dokploy/prometheus.compose.yml` and `dokploy/grafana.compose.yml` (the two template stacks as they should be configured, ready to paste into Dokploy), `grafana-datasource.yml` and `grafana-dashboards.yml` (the optional file-based Grafana provisioning) and `dashboards/nexton-api.json` (18 panels covering traffic, latency, ETag revalidation, cache effectiveness, outbound pressure, runtime health, and a scrape-target up/down indicator).

### 5. Deploying Prometheus and Grafana in Dokploy

Both were created with Dokploy's **+ Create service → template**, which gives each of them its own Docker Compose stack. The chain being built is:

```
Grafana  ──asks──▶  Prometheus  ──reads──▶  backend:9090/metrics
```

The templates get the software running. Four things still have to be done by hand, because a template cannot know about your backend:

| Step | Why |
| --- | --- |
| Redeploy the `backend` service | The image that is running predates the metrics endpoint, so there is nothing to scrape yet |
| Paste `monitoring/dokploy/prometheus.compose.yml` into the Prometheus service | Adds the shared network, and drops the template's `--web.enable-lifecycle` |
| Paste `monitoring/dokploy/grafana.compose.yml` into the Grafana service | Adds the shared network, the admin password and the public URL |
| Replace the content of the `prometheus.yml` **File Mount** | The template's default config scrapes Prometheus itself only; this adds the backend job |

**Why the network block matters.** The templates create each service as an isolated stack, so by default Prometheus cannot see the backend (a Dokploy Application, i.e. a Swarm service) and Grafana cannot see Prometheus. Both committed compose files add `dokploy-network` — the network Traefik already uses to reach your applications — which makes all three mutually resolvable **without publishing a single port**.

**The one line that must be edited.** Dokploy names Swarm services with a generated suffix, so the backend's real name has to come from the server:

```bash
docker service ls
```

Then, in the Prometheus service's **Advanced → Mounts → `prometheus.yml`**, replace the content with `monitoring/prometheus.yml` and set:

```yaml
      - targets: ["<backend-swarm-service-name>:9090"]
```

**⚠️ Delete the Prometheus domain.** The Prometheus template declares a public domain on port 9090, and Prometheus has no authentication of its own — that address would let anyone read your route names, latency and cache behaviour. Prometheus service → **Domains** → delete it. Grafana is the UI; Prometheus only needs to be reachable by the other containers. The committed compose also removes `--web.enable-lifecycle`, which the template turns on: that flag exposes `/-/reload` and `/-/quit` over HTTP, so a public domain plus that flag is a remote shutdown switch.

**Then in Grafana** (open its domain and sign in as `admin` with the password from the compose file):

1. **Connections → Data sources → Add data source → Prometheus**, URL `http://prometheus:9090`, then **Save & test**.
   If that name does not resolve, Docker deployed that service as a Stack rather than a Compose project — use the Prometheus container name from `docker ps --format '{{.Names}}'` instead.
2. **Dashboards → New → Import → Upload JSON file** → `monitoring/dashboards/nexton-api.json`.

Optionally turn on **Advanced → Security → Basic Auth** on the Grafana service as a second lock in front of the login page.

**Provisioning as code instead of clicking.** `monitoring/grafana-datasource.yml`, `monitoring/grafana-dashboards.yml` and `monitoring/dashboards/nexton-api.json` are the file-based equivalent of steps 1 and 2, for when doing it through the UI becomes tedious. Each header names the mount path it needs; the datasource must keep uid `prometheus`, because the dashboard refers to it.

**What the templates already give you**, so that it does not need adding: the volumes `prometheus-data` (`/prometheus`) and `grafana-storage` (`/var/lib/grafana`), the `prometheus.yml` File Mount, and the Grafana domain. The images are `prom/prometheus:latest` and `grafana/grafana-enterprise:12.4`; Enterprise runs unlicensed as an OSS equivalent, so it is fine to keep — swap it for `grafana/grafana:12.4` if you would rather not see features you have not licensed.

### 6. Verifying the monitoring stack

1. **The backend serves metrics inside its container network:**
   ```bash
   docker ps --format '{{.Names}}'                                   # find the backend container
   docker exec <backend-container> wget -qO- http://127.0.0.1:9090/metrics | head -20
   ```
   If that fails, `METRICS_ADDR` did not reach the container. The image sets it to `:9090`, so a failure here means an override is blanking it.
2. **The three services share a network:**
   ```bash
   docker network inspect dokploy-network | grep -iE "nexton|prometheus|grafana"
   ```
   All three should appear. A missing one is why a scrape target or the datasource would fail to resolve.
3. **Prometheus → Status → Targets** should show the backend target as **UP**. **Status → Configuration** shows the config it actually loaded, which is the quickest way to confirm the File Mount content landed rather than being silently empty. A **DOWN** target with a good config means the target name is wrong, and the error message names it.
4. **Grafana** should open **Nexton / Nexton API** with data. The **Scrape target** panel turns green when the scrape works. If every panel is empty while the target is up, the datasource URL — or its uid — is the thing to check.
5. **Generate traffic** (`GET /api/discover`) and watch `nexton_http_requests_total` move. A `status="304"` series appearing confirms the ETag path is being exercised by the client, which is the behaviour the caching work depends on.

**Useful queries** (Grafana Explore, or Prometheus):

```promql
# requests per second by route
sum by (route) (rate(nexton_http_requests_total[5m]))

# outbound TMDB calls per inbound request, by route
sum by (route) (rate(nexton_route_tmdb_calls_total[5m]))
  / (sum by (route) (rate(nexton_http_requests_total[5m])) > 0)

# p95 latency by route
histogram_quantile(0.95, sum by (route, le) (rate(nexton_http_request_duration_seconds_bucket[5m])))

# share of requests answered with a cheap 304
sum(rate(nexton_http_requests_total{status="304"}[5m]))
  / clamp_min(sum(rate(nexton_http_requests_total[5m])), 1)

# anything wrong with Redis at all (should be flat zero)
rate(nexton_redis_errors_total[5m])
```

**Alerts worth adding** in Grafana (Alerting → Alert rules, delivered through a contact point such as Discord or Telegram — Dokploy's own notifications only cover server thresholds, not request health):

- `up{job="nexton-backend"} == 0` for 5m — the scrape is failing
- `increase(nexton_redis_errors_total[10m]) > 0` — requests are being served without the second-level cache
- p95 latency above ~2s for 10m — outbound calls are the usual cause
- a 5xx ratio above a few percent for 5m

**Not included, and the natural next step:** `redis_exporter` for Redis server-side memory, connections and keyspace, and `node_exporter` if you want host CPU, RAM and disk on the same dashboard.

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
