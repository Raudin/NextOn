package main

import (
	"net/http"
	"strconv"

	"github.com/gin-gonic/gin"
)

// Delta sync endpoints.
//
// The client keeps a full local copy of its watchlist, watched history and
// favourites. Bringing that copy up to date previously meant re-downloading
// everything (and, before Phase 1, re-resolving every title server-side too).
// These endpoints let a client that already holds version N ask only for what
// changed, using the change log written by recordSyncOp.

// handleSyncState is the cheap probe: "has anything changed for me?"
//
// It is intentionally tiny — two indexed reads — so a client can call it on
// every foreground without cost, and only request a delta when the version has
// actually moved.
func handleSyncState(c *gin.Context) {
	userID, ok := c.Get("user_id")
	if !ok {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "Unauthorized"})
		return
	}
	userUID := userID.(uint)

	collections := map[string]SyncCollectionState{}
	for _, collection := range []string{
		syncCollectionWatchlist,
		syncCollectionWatched,
		syncCollectionFavorites,
	} {
		var count int64
		if err := db.Model(syncOpModelFor(collection)).Where("user_id = ?", userUID).Count(&count).Error; err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to read sync state"})
			return
		}
		collections[collection] = SyncCollectionState{
			Version: highestCollectionVersion(userUID, collection),
			Count:   count,
		}
	}

	etag := userEntityTag(userUID)
	c.Header("ETag", etag)
	if etagMatches(c.GetHeader("If-None-Match"), etag) {
		c.Status(http.StatusNotModified)
		return
	}

	c.JSON(http.StatusOK, SyncStateResponse{
		Version:     currentUserVersion(userUID),
		Collections: collections,
	})
}

// syncOpModelFor maps a sync collection name to its GORM model, for the count
// in the state endpoint.
func syncOpModelFor(collection string) any {
	switch collection {
	case syncCollectionWatchlist:
		return &WatchlistItem{}
	case syncCollectionWatched:
		return &WatchedItem{}
	case syncCollectionFavorites:
		return &FavoriteItem{}
	}
	return &WatchlistItem{}
}

// handleSyncChanges returns every change recorded after the client's cursor.
func handleSyncChanges(c *gin.Context) {
	userID, ok := c.Get("user_id")
	if !ok {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "Unauthorized"})
		return
	}
	userUID := userID.(uint)

	since := uint64(0)
	if raw := c.Query("since"); raw != "" {
		parsed, err := strconv.ParseUint(raw, 10, 64)
		if err != nil {
			c.JSON(http.StatusBadRequest, gin.H{"error": "Invalid since value"})
			return
		}
		since = parsed
	}

	currentVersion := currentUserVersion(userUID)
	resyncRequired := needsFullResync(userUID, since)

	response := SyncChangeResponse{
		Version:        currentVersion,
		Changes:        []SyncOp{},
		ResyncRequired: resyncRequired,
	}

	if !resyncRequired && since < currentVersion {
		var ops []SyncOp
		if err := db.Where("user_id = ? AND version > ?", userUID, since).
			Order("version ASC").
			Find(&ops).Error; err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to read changes"})
			return
		}
		response.Changes = ops
	}

	etag := userEntityTag(userUID)
	c.Header("ETag", etag)
	if etagMatches(c.GetHeader("If-None-Match"), etag) {
		c.Status(http.StatusNotModified)
		return
	}

	c.JSON(http.StatusOK, response)
}
