package main

import (
	"fmt"
	"log"
	"os"
	"strings"

	"github.com/glebarez/sqlite"
	"gorm.io/gorm"
)

var db *gorm.DB

// maxOpenConns bounds the SQLite connection pool.
//
// SQLite serialises writers, so a large pool buys nothing and actively hurts:
// every extra connection is another writer that can collide and return
// SQLITE_BUSY. Four is enough for the handler paths plus the four rating
// workers, and small enough that the busy_timeout can actually absorb a
// collision instead of queuing behind it.
const maxOpenConns = 4

func initDB() {
	dbPath := os.Getenv("DB_PATH")
	if dbPath == "" {
		dbPath = "nexton.db"
	}

	// Declare err separately and assign with `=` rather than `:=`.
	//
	// `db, err := gorm.Open(...)` would declare a NEW local `db` shadowing the
	// package-level handle: the function would migrate its own private
	// connection while every handler kept reading a nil global. Tests did not
	// catch it because initTestDB assigns the global directly, so this only
	// appeared when the server was actually run.
	var err error
	db, err = gorm.Open(sqlite.Open(sqliteDSN(dbPath)), &gorm.Config{
		// GORM otherwise wraps every single Create/Update/Delete in its own
		// transaction, which for SQLite means two extra statements and two
		// extra fsyncs per row. Handlers that need atomicity open an explicit
		// transaction, so the implicit one is pure overhead.
		SkipDefaultTransaction: true,
		// Cache compiled statements. Every hot query here is on a fixed-shaped
		// statement, so re-preparing them per call is wasted work.
		PrepareStmt: true,
	})
	if err != nil {
		log.Fatalf("Failed to connect database: %v", err)
	}

	if err := configureDatabase(db); err != nil {
		log.Fatalf("Failed to configure database: %v", err)
	}

	// Auto Migrate
	err = db.AutoMigrate(
		&User{},
		&WatchlistItem{},
		&WatchedItem{},
		&FavoriteItem{},
		&MediaRating{},
		&UserSyncState{},
		&SyncOp{},
	)
	if err != nil {
		log.Fatalf("Failed to auto migrate database: %v", err)
	}

	// Must run after AutoMigrate: on a fresh database GORM would otherwise
	// recreate the index the model no longer declares.
	if err := dropRedundantMediaRatingIndex(db); err != nil {
		// Not fatal. The index is redundant, not required, and failing to start
		// over a missed optimisation would be the wrong trade.
		log.Printf("SQLite: could not drop the redundant media rating index: %v", err)
	}

	log.Println("SQLite Database migrated successfully.")
}

// dropRedundantMediaRatingIndex retires idx_media_rating.
//
// AutoMigrate never drops an index a model stops declaring, so existing
// databases keep the duplicate created when MediaRating carried both a
// composite primary key and a uniqueIndex tag over the same two columns. Every
// insert and update maintained both structures for no benefit, and every rating
// write touches this table.
//
// The primary key's own index (sqlite_autoindex_media_ratings_1) still serves
// the lookup, so dropping this changes no query plan for the worse.
func dropRedundantMediaRatingIndex(conn *gorm.DB) error {
	var count int64
	if err := conn.Raw(
		"SELECT COUNT(*) FROM sqlite_master WHERE type = 'index' AND name = 'idx_media_rating'",
	).Scan(&count).Error; err != nil {
		return fmt.Errorf("checking for the index: %w", err)
	}
	if count == 0 {
		return nil
	}

	if err := conn.Exec("DROP INDEX IF EXISTS idx_media_rating").Error; err != nil {
		return fmt.Errorf("dropping the index: %w", err)
	}
	log.Println("SQLite: dropped redundant index idx_media_rating (covered by the primary key)")
	return nil
}

// sqliteDSN appends the per-connection pragmas the driver runs on every new
// connection.
//
// `_pragma` is the driver's own mechanism (each occurrence becomes one PRAGMA
// statement on connect), so these apply whether or not a connection is the
// first one opened.
//
// Deliberately absent: journal_mode. WAL is a property of the database file
// rather than of a connection, so it is set once in configureDatabase instead;
// running it from every connection would contend for a lock each time one is
// opened. Similarly `cache=shared` is left alone — the driver's default private
// cache is what gives each connection a snapshot-safe view.
func sqliteDSN(path string) string {
	pragmas := []string{
		// Without a busy timeout, a writer that finds the database locked
		// fails immediately with SQLITE_BUSY instead of waiting for the other
		// writer to commit. That is the failure the four rating workers raced
		// into.
		"_pragma=busy_timeout(5000)",
		// NORMAL is the correct pairing with WAL: it keeps the rollback journal
		// behaviour safe against corruption while avoiding an fsync on every
		// commit. FULL would defeat most of WAL's throughput benefit.
		"_pragma=synchronous(NORMAL)",
	}

	base := path
	existing := ""
	if idx := strings.Index(path, "?"); idx >= 0 {
		base = path[:idx]
		existing = path[idx+1:]
	}

	query := strings.Join(pragmas, "&")
	if existing != "" {
		query = existing + "&" + query
	}
	return base + "?" + query
}

// configureDatabase sets the pool bounds and the file-level pragmas.
func configureDatabase(conn *gorm.DB) error {
	sqlDB, err := conn.DB()
	if err != nil {
		return fmt.Errorf("accessing the underlying sql.DB: %w", err)
	}

	sqlDB.SetMaxOpenConns(maxOpenConns)
	sqlDB.SetMaxIdleConns(maxOpenConns)
	sqlDB.SetConnMaxLifetime(0)

	// WAL lets a reader proceed while a writer commits, which is what keeps the
	// read-heavy GET paths from blocking behind a bulk write. It also survives
	// an abrupt exit far better than the default rollback journal.
	if err := conn.Exec("PRAGMA journal_mode = WAL").Error; err != nil {
		return fmt.Errorf("enabling WAL: %w", err)
	}

	// Not every database supports WAL — an in-memory test database cannot, and
	// read-only storage cannot. Report it without failing, since a non-WAL
	// database is slower but still correct.
	var mode string
	if err := conn.Raw("PRAGMA journal_mode").Scan(&mode).Error; err == nil {
		if !strings.EqualFold(mode, "wal") {
			log.Printf("SQLite: journal_mode is %q, not WAL; concurrent writes will block readers", mode)
		} else {
			log.Println("SQLite: WAL enabled, busy_timeout 5000ms, synchronous NORMAL")
		}
	}

	return nil
}
