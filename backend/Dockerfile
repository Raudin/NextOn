# Build stage
FROM golang:1.25-alpine AS builder

WORKDIR /app

# Copy dependency files
COPY go.mod go.sum ./
RUN go mod download

# Copy source code
COPY . .

# Build binary
RUN CGO_ENABLED=0 GOOS=linux go build -o main .

# Final stage
FROM alpine:latest

RUN apk --no-cache add ca-certificates tzdata

WORKDIR /app

# Copy binary from builder
COPY --from=builder /app/main /app/main

# Create directory for persistent SQLite database
RUN mkdir -p /data

# Default environment variables
ENV PORT=8080
ENV DB_PATH=/data/nexton.db
ENV GIN_MODE=release
# Prometheus exposition. Served on its own listener inside the container so that
# routing to the API's public domain cannot reach it; see monitoring/ for the
# scraper. Override or blank it in the service's environment as needed.
ENV METRICS_ADDR=:9090

EXPOSE 8080
# Reachable only from the project network. Deliberately not published and with
# no domain: an in-network scrape is the only intended client.
EXPOSE 9090

CMD ["/app/main"]
