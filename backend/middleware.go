package main

import (
	"fmt"
	"net/http"
	"os"
	"strings"

	"github.com/gin-gonic/gin"
	"github.com/golang-jwt/jwt/v5"
)

var jwtSecret = []byte("nexton-secret-key-1234567890")

func initJWT() {
	if secret := os.Getenv("JWT_SECRET"); secret != "" {
		jwtSecret = []byte(secret)
	}
}

// jwtKeyFunc pins token verification to HMAC so a token signed with a
// different algorithm family cannot be accepted.
func jwtKeyFunc(token *jwt.Token) (interface{}, error) {
	if _, ok := token.Method.(*jwt.SigningMethodHMAC); !ok {
		return nil, fmt.Errorf("unexpected signing method: %v", token.Header["alg"])
	}
	return jwtSecret, nil
}

// userIDFromAuthorization returns the authenticated user id, or 0 when the
// request carries no valid bearer token. Shared by the required and optional
// middlewares so there is exactly one token-parsing implementation.
func userIDFromAuthorization(c *gin.Context) uint {
	authHeader := c.GetHeader("Authorization")
	if authHeader == "" {
		return 0
	}

	parts := strings.SplitN(authHeader, " ", 2)
	if len(parts) != 2 || parts[0] != "Bearer" {
		return 0
	}

	token, err := jwt.Parse(parts[1], jwtKeyFunc)
	if err != nil || !token.Valid {
		return 0
	}

	claims, ok := token.Claims.(jwt.MapClaims)
	if !ok {
		return 0
	}
	userIDFloat, ok := claims["user_id"].(float64)
	if !ok {
		return 0
	}
	return uint(userIDFloat)
}

// AuthMiddleware validates JWT bearer token and injects user_id into context
func AuthMiddleware() gin.HandlerFunc {
	return func(c *gin.Context) {
		authHeader := c.GetHeader("Authorization")
		if authHeader == "" {
			c.JSON(http.StatusUnauthorized, gin.H{"error": "Authorization header is required"})
			c.Abort()
			return
		}

		parts := strings.SplitN(authHeader, " ", 2)
		if !(len(parts) == 2 && parts[0] == "Bearer") {
			c.JSON(http.StatusUnauthorized, gin.H{"error": "Authorization header must be Bearer token"})
			c.Abort()
			return
		}

		userUID := userIDFromAuthorization(c)
		if userUID == 0 {
			c.JSON(http.StatusUnauthorized, gin.H{"error": "Invalid or expired token"})
			c.Abort()
			return
		}

		c.Set("user_id", userUID)
		c.Next()
	}
}

// OptionalAuthMiddleware injects user_id when a valid token is present and lets
// the request through anonymously otherwise.
//
// Endpoints like /api/watched/status are public but personalise their response
// for signed-in users. That route previously parsed the JWT inline, which meant
// two implementations of token verification that could drift apart.
func OptionalAuthMiddleware() gin.HandlerFunc {
	return func(c *gin.Context) {
		if userUID := userIDFromAuthorization(c); userUID != 0 {
			c.Set("user_id", userUID)
		}
		c.Next()
	}
}
