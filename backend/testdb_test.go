package main

import (
	"strings"
	"testing"

	"github.com/glebarez/sqlite"
	"gorm.io/gorm"
	"gorm.io/gorm/logger"
)

// initTestDB points the package-level `db` handle at a fresh in-memory SQLite
// database for the duration of one test.
//
// The handle is global (that is how every handler reaches the database), so
// tests must restore it. t.Cleanup handles both the restore and closing the
// connection, which also drops the in-memory database.
func initTestDB(t *testing.T) {
	t.Helper()

	previous := db
	// Each test gets its own named in-memory database so tests cannot see each
	// other's rows. Subtest names contain "/", which is not valid in a DSN
	// filename, hence the sanitising.
	name := strings.NewReplacer("/", "_", " ", "_").Replace(t.Name())
	dsn := "file:" + name + "?mode=memory&cache=shared"

	conn, err := gorm.Open(sqlite.Open(dsn), &gorm.Config{
		Logger: logger.Discard,
	})
	if err != nil {
		t.Fatalf("failed to open test database: %v", err)
	}

	if err := conn.AutoMigrate(
		&User{},
		&WatchlistItem{},
		&WatchedItem{},
		&FavoriteItem{},
		&MediaRating{},
		&UserSyncState{},
		&SyncOp{},
	); err != nil {
		t.Fatalf("failed to migrate test database: %v", err)
	}

	// Keep one connection open for the test's lifetime: a pooled in-memory
	// database is discarded as soon as its last connection closes.
	sqlDB, err := conn.DB()
	if err != nil {
		t.Fatalf("failed to access the underlying sql.DB: %v", err)
	}
	sqlDB.SetMaxOpenConns(1)

	db = conn

	t.Cleanup(func() {
		_ = sqlDB.Close()
		db = previous
	})
}

// createTestUser inserts a user and returns its id.
func createTestUser(t *testing.T) uint {
	t.Helper()

	user := User{Email: "test@example.com", PasswordHash: "x", Name: "Test"}
	if err := db.Create(&user).Error; err != nil {
		t.Fatalf("failed to create test user: %v", err)
	}
	return user.ID
}
