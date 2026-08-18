# Build stage
FROM golang:1.24-alpine AS builder

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

EXPOSE 8080

CMD ["/app/main"]
