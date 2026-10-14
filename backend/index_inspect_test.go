package main

import (
	"path/filepath"
	"strings"
	"testing"

	"github.com/glebarez/sqlite"
	"gorm.io/gorm"
	"gorm.io/gorm/logger"
)

// openTempDB opens a file-backed database in a temp dir and closes it during
// cleanup. The close matters on Windows, where an open handle makes the
// directory impossible to remove.
func openTempDB(t *testing.T) *gorm.DB {
	t.Helper()

	dsn := filepath.Join(t.TempDir(), "schema.db")
	conn, err := gorm.Open(sqlite.Open(dsn), &gorm.Config{Logger: logger.Discard})
	if err != nil {
		t.Fatalf("open: %v", err)
	}

	t.Cleanup(func() {
		if sqlDB, err := conn.DB(); err == nil {
			_ = sqlDB.Close()
		}
	})
	return conn
}

// mediaRatingIndexes returns the explicit (non-implicit) indexes on
// media_ratings.
func mediaRatingIndexes(t *testing.T, conn *gorm.DB) []string {
	t.Helper()

	var names []string
	if err := conn.Raw(
		"SELECT name FROM sqlite_master WHERE type = 'index' AND tbl_name = 'media_ratings' AND name NOT LIKE 'sqlite_autoindex%'",
	).Scan(&names).Error; err != nil {
		t.Fatalf("reading indexes: %v", err)
	}
	return names
}

// The composite primary key already gives media_ratings a unique index over
// (media_type, media_id). Declaring a second one made every rating write
// maintain two identical structures, and AutoMigrate will not remove one on its
// own once the model stops declaring it — hence this guard.
func TestMediaRatingHasNoRedundantIndex(t *testing.T) {
	conn := openTempDB(t)

	if err := conn.AutoMigrate(&MediaRating{}); err != nil {
		t.Fatalf("migrate: %v", err)
	}

	if names := mediaRatingIndexes(t, conn); len(names) != 0 {
		t.Fatalf("a fresh database must not create a redundant index, got %v", names)
	}

	// The primary key's index must still exist, or the lookup loses its plan.
	var schema string
	if err := conn.Raw("SELECT sql FROM sqlite_master WHERE name = 'media_ratings'").Scan(&schema).Error; err != nil {
		t.Fatalf("reading schema: %v", err)
	}
	if !strings.Contains(schema, "PRIMARY KEY (`media_type`,`media_id`)") {
		t.Fatalf("expected a composite primary key, got: %s", schema)
	}
}

// A database created before the fix still carries idx_media_rating, and the
// migration must retire it at startup.
func TestDropRedundantMediaRatingIndexRemovesLegacyIndex(t *testing.T) {
	conn := openTempDB(t)

	if err := conn.AutoMigrate(&MediaRating{}); err != nil {
		t.Fatalf("migrate: %v", err)
	}

	// Recreate the legacy index the old model declared.
	if err := conn.Exec(
		"CREATE UNIQUE INDEX `idx_media_rating` ON `media_ratings`(`media_type`,`media_id`)",
	).Error; err != nil {
		t.Fatalf("creating the legacy index: %v", err)
	}
	if names := mediaRatingIndexes(t, conn); len(names) != 1 {
		t.Fatalf("expected the legacy index to be present, got %v", names)
	}

	if err := dropRedundantMediaRatingIndex(conn); err != nil {
		t.Fatalf("migration failed: %v", err)
	}

	if names := mediaRatingIndexes(t, conn); len(names) != 0 {
		t.Fatalf("the legacy index must be dropped, still present: %v", names)
	}

	// Running it again must be a no-op rather than an error.
	if err := dropRedundantMediaRatingIndex(conn); err != nil {
		t.Fatalf("the migration must be idempotent: %v", err)
	}

	// Uniqueness must survive the drop: the primary key still enforces it.
	first := MediaRating{MediaType: "movie", MediaID: 1}
	if err := conn.Create(&first).Error; err != nil {
		t.Fatalf("insert: %v", err)
	}
	duplicate := MediaRating{MediaType: "movie", MediaID: 1}
	if err := conn.Create(&duplicate).Error; err == nil {
		t.Fatal("the primary key must still reject a duplicate rating row")
	}
}
