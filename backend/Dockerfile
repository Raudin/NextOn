# syntax=docker/dockerfile:1

# ---------------------------------------------------------------------------
# Build stage
# ---------------------------------------------------------------------------
# Pinned to an exact patch version. `golang:1.25-alpine`, which this replaced,
# is a moving tag: the same Dockerfile produced a different toolchain on every
# rebuild, so a build could start failing with no change to this repository.
FROM golang:1.25.0-alpine3.21 AS builder

WORKDIR /app

# Dependencies first, so a source-only change does not re-download the module
# graph. The module cache is a BuildKit cache mount rather than a layer, so it
# is reused across builds without being baked into an image layer.
COPY go.mod go.sum ./
RUN --mount=type=cache,target=/go/pkg/mod \
    go mod download

COPY . .

# -trimpath removes local filesystem paths from the binary; -s -w drops the
# symbol table and DWARF data. Together they cut the binary substantially and
# stop build-machine paths from leaking into the artifact.
# CGO is off so the result is a static binary with no libc dependency.
RUN --mount=type=cache,target=/go/pkg/mod \
    --mount=type=cache,target=/root/.cache/go-build \
    CGO_ENABLED=0 GOOS=linux \
    go build -trimpath -ldflags="-s -w" -o /out/nexton .

# ---------------------------------------------------------------------------
# Runtime stage
# ---------------------------------------------------------------------------
# Also pinned. `alpine:latest` is a moving target that can change libc or
# busybox behaviour underneath a running deployment.
FROM alpine:3.21

# ca-certificates for outbound TLS (TMDB/OMDb), tzdata so the schedule's
# date handling is not silently UTC-only, and wget for the healthcheck below.
RUN apk --no-cache add ca-certificates tzdata wget

# Create the data directory and an unprivileged user up front. The container
# previously ran as root, so anything that escaped the application had root
# inside the container and, with a mounted volume, write access to it.
RUN mkdir -p /data && \
    addgroup -S -g 10001 nexton && \
    adduser -S -u 10001 -G nexton -H -s /sbin/nologin nexton && \
    chown -R nexton:nexton /data

WORKDIR /app

COPY --from=builder /out/nexton /app/nexton

# Default environment variables
ENV PORT=8080
ENV DB_PATH=/data/nexton.db
ENV GIN_MODE=release
# Prometheus exposition. Served on its own listener inside the container so that
# routing to the API's public domain cannot reach it; see monitoring/ for the
# scraper. Override or blank it in the service's environment as needed.
ENV METRICS_ADDR=:9090

# NOTE: because GIN_MODE=release, the server validates JWT_SECRET at boot and
# refuses to start with an unset value or a known placeholder. That is
# deliberate — a container signing tokens with the in-repo default secret would
# accept a forged token for any user id — so JWT_SECRET must be supplied by the
# deployment (see docker-compose.yml and .env.example).

EXPOSE 8080
# Reachable only from the project network. Deliberately not published and with
# no domain: an in-network scrape is the only intended client.
EXPOSE 9090

USER nexton

# Liveness only: readiness (which also pings the database) is at /ready, and a
# failing readiness should take the container out of rotation rather than make
# the orchestrator restart it.
HEALTHCHECK --interval=30s --timeout=3s --start-period=10s --retries=3 \
    CMD wget --no-verbose --tries=1 --spider http://127.0.0.1:8080/health || exit 1

CMD ["/app/nexton"]
