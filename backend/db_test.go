package main

import (
	"path/filepath"
	"strings"
	"testing"

	"github.com/glebarez/sqlite"
	"gorm.io/gorm"
	"gorm.io/gorm/logger"
)

// openConfiguredDB mirrors what initDB does, so the connection settings and the
// DSN pragmas can be asserted without the process-wide side effects of calling
// initDB itself (which also migrates the global handle and starts nothing else
// but does replace the global `db`).
//
// This exists because the settings are easy to write and easy to lose: the
// pragmas are the difference between serialised writes failing with
// SQLITE_BUSY and waiting, and the pool bound is what keeps that from
// happening in the first place. A bug that dropped them would be invisible to
// every handler test, which runs against initTestDB's own connection.
func openConfiguredDB(t *testing.T) *gorm.DB {
	t.Helper()

	dsn := filepath.Join(t.TempDir(), "configured.db")
	conn, err := gorm.Open(sqlite.Open(sqliteDSN(dsn)), &gorm.Config{
		SkipDefaultTransaction: true,
		PrepareStmt:            true,
		Logger:                 logger.Discard,
	})
	if err != nil {
		t.Fatalf("open: %v", err)
	}
	if err := configureDatabase(conn); err != nil {
		t.Fatalf("configure: %v", err)
	}

	t.Cleanup(func() {
		if sqlDB, err := conn.DB(); err == nil {
			_ = sqlDB.Close()
		}
	})
	return conn
}

func TestSQLiteDSNAppliesPerConnectionPragmas(t *testing.T) {
	dsn := sqliteDSN("nexton.db")

	// The driver runs each `_pragma=` occurrence as a PRAGMA on every new
	// connection, so both must be present on every connection — not just the
	// first, which is why journal_mode is handled separately.
	if !strings.Contains(dsn, "_pragma=busy_timeout(5000)") {
		t.Fatalf("the DSN must set a busy timeout, got %q", dsn)
	}
	if !strings.Contains(dsn, "_pragma=synchronous(NORMAL)") {
		t.Fatalf("the DSN must set synchronous=NORMAL, got %q", dsn)
	}
	if !strings.HasPrefix(dsn, "nexton.db?") {
		t.Fatalf("unexpected DSN shape: %q", dsn)
	}
}

func TestSQLiteDSNNormalisesAnExistingQueryString(t *testing.T) {
	// A DB_PATH that already carries options must not end up with two "?".
	dsn := sqliteDSN("file:nexton.db?cache=shared")

	if strings.Count(dsn, "?") != 1 {
		t.Fatalf("expected exactly one query separator, got %q", dsn)
	}
	if !strings.Contains(dsn, "cache=shared") {
		t.Fatalf("the original option was dropped: %q", dsn)
	}
	if !strings.Contains(dsn, "busy_timeout(5000)") {
		t.Fatalf("the pragmas were dropped: %q", dsn)
	}
}

func TestConfigureDatabaseEnablesWALAndBoundsThePool(t *testing.T) {
	conn := openConfiguredDB(t)

	// WAL is what lets a reader proceed while a writer commits.
	var mode string
	if err := conn.Raw("PRAGMA journal_mode").Scan(&mode).Error; err != nil {
		t.Fatalf("read journal_mode: %v", err)
	}
	if !strings.EqualFold(mode, "wal") {
		t.Fatalf("expected WAL, got %q", mode)
	}

	// The busy timeout is per connection and is what makes a contended write
	// wait instead of failing immediately.
	var busyTimeout int
	if err := conn.Raw("PRAGMA busy_timeout").Scan(&busyTimeout).Error; err != nil {
		t.Fatalf("read busy_timeout: %v", err)
	}
	if busyTimeout != 5000 {
		t.Fatalf("expected a 5000ms busy timeout, got %d", busyTimeout)
	}

	// The pool must be bounded, or SQLite serialises writers through
	// contention rather than through a queue the timeout can absorb.
	sqlDB, err := conn.DB()
	if err != nil {
		t.Fatalf("underlying handle: %v", err)
	}
	if got := sqlDB.Stats().MaxOpenConnections; got != maxOpenConns {
		t.Fatalf("expected the pool capped at %d, got %d", maxOpenConns, got)
	}
}

// The global handle that every handler reads must actually be the one initDB
// configures. Writing `db, err := gorm.Open(...)` inside initDB instead of
// assigning the package variable compiles, migrates successfully, logs success,
// and leaves every handler reading a nil global — which is exactly the mistake
// this guards against.
func TestInitDBAssignsThePackageHandle(t *testing.T) {
	t.Setenv("DB_PATH", filepath.Join(t.TempDir(), "global.db"))

	// initDB replaces the process-wide handle; restore whatever was there so
	// other tests keep the handle initTestDB installed. The connection it opens
	// is closed too — t.TempDir cleanup cannot remove a file Windows still has
	// open, so leaving it would fail the test on a cleanup error unrelated to
	// what it asserts.
	previous := db
	t.Cleanup(func() {
		if db != nil {
			if sqlDB, err := db.DB(); err == nil {
				_ = sqlDB.Close()
			}
		}
		db = previous
	})

	initDB()

	if db == nil {
		t.Fatal("initDB must assign the package-level db handle that handlers read")
	}
	if _, err := db.DB(); err != nil {
		t.Fatalf("the assigned handle is not usable: %v", err)
	}

	// And it must be the migrated one, so the schema exists.
	for _, model := range []any{&User{}, &WatchedItem{}, &SyncOp{}} {
		if !db.Migrator().HasTable(model) {
			t.Fatalf("the assigned database is missing a migrated table for %T", model)
		}
	}
}
