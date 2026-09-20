package main

import (
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/gin-gonic/gin"
)

func TestETagMatchesWeakComparison(t *testing.T) {
	cases := []struct {
		name   string
		header string
		etag   string
		want   bool
	}{
		{"exact", `W/"abc"`, `W/"abc"`, true},
		{"weak vs strong prefix", `"abc"`, `W/"abc"`, true},
		{"strong vs weak prefix", `W/"abc"`, `"abc"`, true},
		{"mismatch", `W/"abc"`, `W/"def"`, false},
		{"wildcard", `*`, `W/"abc"`, true},
		{"empty header", ``, `W/"abc"`, false},
		{"list containing a match", `W/"x", W/"abc", W/"y"`, `W/"abc"`, true},
		{"list without a match", `W/"x", W/"y"`, `W/"abc"`, false},
		{"surrounding whitespace", `  W/"abc"  `, `W/"abc"`, true},
		{"version etag", `W/"user-7-ver-12"`, `W/"user-7-ver-12"`, true},
		{"stale version etag", `W/"user-7-ver-11"`, `W/"user-7-ver-12"`, false},
	}

	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			if got := etagMatches(tc.header, tc.etag); got != tc.want {
				t.Fatalf("etagMatches(%q, %q) = %v, want %v", tc.header, tc.etag, got, tc.want)
			}
		})
	}
}

func TestUserEntityTagReflectsVersion(t *testing.T) {
	initTestDB(t)
	userID := createTestUser(t)

	before := userEntityTag(userID)
	bumpUserVersion(userID)
	after := userEntityTag(userID)

	if before == after {
		t.Fatal("the entity tag must change when the user's version advances, or clients would never see updates")
	}
	if before == userEntityTag(userID+1) {
		t.Fatal("two users must not share an entity tag")
	}
}

// withPublicBodyETagRoute builds a real gin engine so the middleware is
// exercised through the same call path as production.
func withPublicBodyETagRoute() *gin.Engine {
	gin.SetMode(gin.TestMode)
	r := gin.New()
	r.GET("/api/discover", CachePolicyMiddleware(publicCachePolicy), func(c *gin.Context) {
		c.JSON(http.StatusOK, gin.H{"trending": []string{"a", "b"}})
	})
	return r
}

func TestCachePolicyBodyETagEmitsValidator(t *testing.T) {
	r := withPublicBodyETagRoute()

	w := httptest.NewRecorder()
	r.ServeHTTP(w, httptest.NewRequest(http.MethodGet, "/api/discover", nil))

	if w.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d", w.Code)
	}
	if w.Header().Get("ETag") == "" {
		t.Fatal("a successful body response must carry an ETag")
	}
	if got := w.Header().Get("Cache-Control"); got != publicCachePolicy.cacheControl {
		t.Fatalf("unexpected Cache-Control: %q", got)
	}
	if w.Body.Len() == 0 {
		t.Fatal("the body must be forwarded on a 200")
	}
}

func TestCachePolicyBodyETagAnswers304(t *testing.T) {
	r := withPublicBodyETagRoute()

	first := httptest.NewRecorder()
	r.ServeHTTP(first, httptest.NewRequest(http.MethodGet, "/api/discover", nil))
	etag := first.Header().Get("ETag")

	request := httptest.NewRequest(http.MethodGet, "/api/discover", nil)
	request.Header.Set("If-None-Match", etag)

	second := httptest.NewRecorder()
	r.ServeHTTP(second, request)

	if second.Code != http.StatusNotModified {
		t.Fatalf("expected 304 for a matching If-None-Match, got %d", second.Code)
	}
	if second.Body.Len() != 0 {
		t.Fatalf("a 304 must not carry a body, got %d bytes", second.Body.Len())
	}
}

func TestCachePolicyBodyETagIgnoresStaleValidator(t *testing.T) {
	r := withPublicBodyETagRoute()

	request := httptest.NewRequest(http.MethodGet, "/api/discover", nil)
	request.Header.Set("If-None-Match", `W/"something-else"`)

	w := httptest.NewRecorder()
	r.ServeHTTP(w, request)

	if w.Code != http.StatusOK {
		t.Fatalf("expected 200 for a stale validator, got %d", w.Code)
	}
	if w.Body.Len() == 0 {
		t.Fatal("a stale validator must receive the full body")
	}
}

// An error response must never be stored as if it were content, and must not be
// given a validator that a client could later match against.
func TestCachePolicyBodyETagPassesErrorsThrough(t *testing.T) {
	gin.SetMode(gin.TestMode)
	r := gin.New()
	r.GET("/api/discover", CachePolicyMiddleware(publicCachePolicy), func(c *gin.Context) {
		c.JSON(http.StatusBadGateway, gin.H{"error": "upstream unavailable"})
	})

	w := httptest.NewRecorder()
	r.ServeHTTP(w, httptest.NewRequest(http.MethodGet, "/api/discover", nil))

	if w.Code != http.StatusBadGateway {
		t.Fatalf("expected the error status to survive, got %d", w.Code)
	}
	if w.Header().Get("ETag") != "" {
		t.Fatal("an error response must not be given an ETag")
	}
	if w.Body.Len() == 0 {
		t.Fatal("the error body must still reach the client")
	}
}

func TestPrivateCachePolicyVariesOnAuthorization(t *testing.T) {
	gin.SetMode(gin.TestMode)
	r := gin.New()
	r.GET("/api/watchlist", CachePolicyMiddleware(privateCachePolicy), func(c *gin.Context) {
		c.JSON(http.StatusOK, gin.H{"items": []string{}})
	})

	w := httptest.NewRecorder()
	r.ServeHTTP(w, httptest.NewRequest(http.MethodGet, "/api/watchlist", nil))

	// Without Vary: Authorization a shared cache could hand one user's
	// watchlist to another.
	if got := w.Header().Get("Vary"); got != "Authorization" {
		t.Fatalf("private routes must set Vary: Authorization, got %q", got)
	}
	if got := w.Header().Get("Cache-Control"); got != "private, no-cache" {
		t.Fatalf("unexpected Cache-Control: %q", got)
	}
}

func TestNoStorePolicyDoesNotEmitETag(t *testing.T) {
	gin.SetMode(gin.TestMode)
	r := gin.New()
	r.POST("/api/auth/login", CachePolicyMiddleware(noStoreCachePolicy), func(c *gin.Context) {
		c.JSON(http.StatusOK, gin.H{"token": "x"})
	})

	w := httptest.NewRecorder()
	r.ServeHTTP(w, httptest.NewRequest(http.MethodPost, "/api/auth/login", nil))

	if got := w.Header().Get("Cache-Control"); got != "no-store" {
		t.Fatalf("unexpected Cache-Control: %q", got)
	}
	if got := w.Header().Get("ETag"); got != "" {
		t.Fatalf("credential responses must not be given a validator, got %q", got)
	}
}

// VersionedETagMiddleware must short-circuit to 304 without invoking the
// handler, which is the entire point: no database read, no TMDB lookup.
func TestVersionedETagShortCircuitsHandler(t *testing.T) {
	initTestDB(t)
	userID := createTestUser(t)

	gin.SetMode(gin.TestMode)
	handlerCalls := 0

	r := gin.New()
	r.GET("/api/home/schedule",
		CachePolicyMiddleware(privateCachePolicy),
		func(c *gin.Context) {
			// Stand in for AuthMiddleware.
			c.Set("user_id", userID)
			c.Next()
		},
		VersionedETagMiddleware(),
		func(c *gin.Context) {
			handlerCalls++
			c.JSON(http.StatusOK, gin.H{"shows_ready": []string{}})
		})

	// First request: the handler runs and an ETag is issued.
	first := httptest.NewRecorder()
	r.ServeHTTP(first, httptest.NewRequest(http.MethodGet, "/api/home/schedule", nil))
	if handlerCalls != 1 {
		t.Fatalf("expected the handler to run once, ran %d times", handlerCalls)
	}
	etag := first.Header().Get("ETag")
	if etag == "" {
		t.Fatal("expected a versioned ETag")
	}

	// Conditional request at the same version: 304 and the handler is skipped.
	request := httptest.NewRequest(http.MethodGet, "/api/home/schedule", nil)
	request.Header.Set("If-None-Match", etag)

	second := httptest.NewRecorder()
	r.ServeHTTP(second, request)

	if second.Code != http.StatusNotModified {
		t.Fatalf("expected 304, got %d", second.Code)
	}
	if handlerCalls != 1 {
		t.Fatalf("the handler must not run for a 304, ran %d times", handlerCalls)
	}

	// After a mutation the version changes, so the same validator must no
	// longer match and the handler must run again.
	recordSyncOp(userID, syncCollectionWatchlist, syncOpUpsert, "movie:1", nil)

	third := httptest.NewRecorder()
	r.ServeHTTP(third, request)

	if third.Code != http.StatusOK {
		t.Fatalf("expected 200 after a mutation, got %d", third.Code)
	}
	if handlerCalls != 2 {
		t.Fatalf("expected the handler to run again after a mutation, ran %d times", handlerCalls)
	}
}
