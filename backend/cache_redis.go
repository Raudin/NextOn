package main

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"log"
	"os"
	"strings"
	"sync"
	"sync/atomic"
	"time"

	"github.com/redis/go-redis/v9"
)

// Redis is an optional second-level cache. Every rule here follows from one
// requirement: **Redis must never be able to fail a request.**
//
//  * If REDIS_URL is unset or unreachable at startup, the process runs with the
//    in-process caches only and behaves exactly as it did before.
//  * Every operation is bounded by a short context timeout, so a hung Redis
//    costs latency on one key, not a stalled handler.
//  * Every error path returns "miss"/"no-op" rather than propagating, so a
//    mid-flight Redis outage degrades performance instead of availability.
//
// The value it adds over the in-process caches is (a) survival across deploys
// and (b) sharing between replicas.
//
// Note that per-user versioning — the thing that drives both ETags and delta
// sync — deliberately does NOT live here. It is stored in the database (see
// sync.go) so that correctness never depends on an optional dependency.

const (
	// redisKeyPrefix namespaces these keys so the instance can share a database
	// with anything else.
	redisKeyPrefix = "nexton:"

	// redisOpTimeout bounds a single Redis round trip. Deliberately short: a
	// cache lookup that takes longer than this has already cost the request
	// more than recomputing the value would have.
	redisOpTimeout = 250 * time.Millisecond

	// redisConnectTimeout bounds the startup ping.
	redisConnectTimeout = 2 * time.Second

	// redisErrorLogInterval rate-limits error logging. A Redis outage would
	// otherwise emit one log line per request, which can itself become the
	// outage.
	redisErrorLogInterval = 30 * time.Second
)

type redisCache struct {
	client *redis.Client
}

var (
	redisStore atomic.Pointer[redisCache]

	redisErrorLogMu   sync.Mutex
	redisLastErrorLog time.Time
)

// logRedisError emits at most one line per redisErrorLogInterval.
func logRedisError(format string, args ...any) {
	redisErrorLogMu.Lock()
	defer redisErrorLogMu.Unlock()

	if time.Since(redisLastErrorLog) < redisErrorLogInterval {
		return
	}
	redisLastErrorLog = time.Now()
	log.Printf("Redis: "+format, args...)
}

// initRedis connects when REDIS_URL is configured and reachable. It never
// fails: an unreachable Redis leaves the process on the in-process caches.
func initRedis() {
	rawURL := strings.TrimSpace(os.Getenv("REDIS_URL"))
	if rawURL == "" {
		log.Println("Redis: REDIS_URL not set; using in-process caches only")
		return
	}

	opts, err := redis.ParseURL(rawURL)
	if err != nil {
		log.Printf("Redis: invalid REDIS_URL (%v); using in-process caches only", err)
		return
	}

	client := redis.NewClient(opts)

	ctx, cancel := context.WithTimeout(context.Background(), redisConnectTimeout)
	defer cancel()

	if err := client.Ping(ctx).Err(); err != nil {
		log.Printf("Redis: ping failed (%v); using in-process caches only", err)
		_ = client.Close()
		return
	}

	redisStore.Store(&redisCache{client: client})
	log.Printf("Redis: connected to %s", opts.Addr)
}

func redisEnabled() bool {
	return redisStore.Load() != nil
}

// redisClient returns the client and a bounded context, or ok=false when Redis
// is unavailable. Callers must treat ok=false as a miss.
func redisClient() (*redis.Client, context.Context, context.CancelFunc, bool) {
	store := redisStore.Load()
	if store == nil {
		return nil, nil, nil, false
	}
	ctx, cancel := context.WithTimeout(context.Background(), redisOpTimeout)
	return store.client, ctx, cancel, true
}

// redisKey hashes arbitrary cache keys. TMDB cache keys are full request URLs,
// which are long, contain characters Redis dislikes in keys, and would show up
// verbatim in logs; a hash keeps them short and opaque.
func redisKey(parts ...string) string {
	digest := sha256.Sum256([]byte(strings.Join(parts, "\x00")))
	return redisKeyPrefix + hex.EncodeToString(digest[:])
}

// redisNamedKey builds a readable key for values that are not user-controlled,
// which makes `redis-cli KEYS` usable when debugging.
func redisNamedKey(name string, parts ...string) string {
	return redisKeyPrefix + name + ":" + strings.Join(parts, ":")
}

// redisGet returns a cached value. Any error (including a timeout) is a miss.
func redisGet(key string) ([]byte, bool) {
	client, ctx, cancel, ok := redisClient()
	if !ok {
		return nil, false
	}
	defer cancel()

	value, err := client.Get(ctx, key).Bytes()
	if err != nil {
		if errors.Is(err, redis.Nil) {
			metrics.redisMisses.Add(1)
			return nil, false
		}
		metrics.redisErrors.Add(1)
		logRedisError("get failed: %v", err)
		return nil, false
	}

	metrics.redisHits.Add(1)
	return value, true
}

// redisSet stores a value. Failures are logged and swallowed.
func redisSet(key string, value []byte, ttl time.Duration) {
	client, ctx, cancel, ok := redisClient()
	if !ok {
		return
	}
	defer cancel()

	if err := client.Set(ctx, key, value, ttl).Err(); err != nil {
		metrics.redisErrors.Add(1)
		logRedisError("set failed: %v", err)
	}
}

// redisDelete removes keys. Failures are logged and swallowed — a delete that
// does not land leaves a stale entry that the TTL will retire.
func redisDelete(keys ...string) {
	if len(keys) == 0 {
		return
	}

	client, ctx, cancel, ok := redisClient()
	if !ok {
		return
	}
	defer cancel()

	if err := client.Del(ctx, keys...).Err(); err != nil {
		metrics.redisErrors.Add(1)
		logRedisError("delete failed: %v", err)
	}
}

// closeRedis releases the connection pool on shutdown.
func closeRedis() {
	store := redisStore.Load()
	if store == nil {
		return
	}
	_ = store.client.Close()
}
