package main

import (
	"log"
	"os"

	"github.com/glebarez/sqlite"
	"gorm.io/gorm"
)

var db *gorm.DB

func initDB() {
	dbPath := os.Getenv("DB_PATH")
	if dbPath == "" {
		dbPath = "nexton.db"
	}

	var err error
	db, err = gorm.Open(sqlite.Open(dbPath), &gorm.Config{})
	if err != nil {
		log.Fatalf("Failed to connect database: %v", err)
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
	log.Println("SQLite Database migrated successfully.")
}
