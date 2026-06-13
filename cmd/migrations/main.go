// Command migrations is a small CLI for inspecting and applying the database
// migrations registered in pkg/migrations.
//
// It deliberately uses only the standard library (an os.Args subcommand switch)
// plus the bun migrate.Migrator API, to avoid pulling a CLI framework into the
// dependency set. Subcommands:
//
//	createdb  create the configured database if it does not exist
//	dropdb    drop the configured database if it exists
//	url       print the resolved DATABASE_URL (used by the db:clone task)
//	migrate   apply all pending migrations
//	rollback  roll back the last applied migration group
//	status    print applied / unapplied migrations
//	create    scaffold a new Go migration file in pkg/migrations
package main

import (
	"context"
	"errors"
	"fmt"
	"os"
	"strings"

	"github.com/robinjoseph08/golib/logger"
	"github.com/robinjoseph08/robinandmadeline.com/pkg/config"
	"github.com/robinjoseph08/robinandmadeline.com/pkg/database"
	"github.com/robinjoseph08/robinandmadeline.com/pkg/migrations"
)

func main() {
	log := logger.New()

	if len(os.Args) < 2 {
		usage()
		os.Exit(2)
	}

	if err := run(context.Background(), os.Args[1], os.Args[2:]); err != nil {
		log.Err(err).Fatal("migrations error")
	}
}

// run dispatches a subcommand. It is split out from main so the dispatch logic
// returns an error rather than calling os.Exit, keeping main a thin shell that
// only translates that error into an exit code.
func run(ctx context.Context, cmd string, args []string) error {
	cfg, err := config.New()
	if err != nil {
		return fmt.Errorf("config error: %w", err)
	}

	// These subcommands run before the target connection below: createdb/dropdb
	// connect to the maintenance database (the target may not exist), and url
	// only needs the resolved config.
	switch cmd {
	case "createdb":
		if err := database.EnsureExists(ctx, cfg.DatabaseURL); err != nil {
			return err
		}
		fmt.Println("database ready")
		return nil
	case "dropdb":
		if err := database.DropIfExists(ctx, cfg.DatabaseURL); err != nil {
			return err
		}
		fmt.Println("database dropped")
		return nil
	case "url":
		fmt.Println(cfg.DatabaseURL)
		return nil
	}

	db, err := database.New(cfg)
	if err != nil {
		return fmt.Errorf("database error: %w", err)
	}
	defer func() { _ = db.Close() }()

	migrator := migrations.NewMigrator(db)
	if err := migrator.Init(ctx); err != nil {
		return fmt.Errorf("init migrator: %w", err)
	}

	switch cmd {
	case "migrate":
		group, err := migrator.Migrate(ctx)
		if err != nil {
			return err
		}
		if group.ID == 0 {
			fmt.Println("there are no new migrations to run")
			return nil
		}
		fmt.Printf("migrated to %s\n", group)
		return nil

	case "rollback":
		group, err := migrator.Rollback(ctx)
		if err != nil {
			return err
		}
		if group.ID == 0 {
			fmt.Println("there are no groups to roll back")
			return nil
		}
		fmt.Printf("rolled back %s\n", group)
		return nil

	case "status":
		ms, err := migrator.MigrationsWithStatus(ctx)
		if err != nil {
			return err
		}
		fmt.Printf("migrations: %s\n", ms)
		fmt.Printf("unapplied migrations: %s\n", ms.Unapplied())
		fmt.Printf("last migration group: %s\n", ms.LastGroup())
		return nil

	case "create":
		name := strings.Join(args, "_")
		if name == "" {
			return errors.New("create requires a migration name, e.g. create add_widgets")
		}
		mf, err := migrator.CreateGoMigration(ctx, name)
		if err != nil {
			return err
		}
		fmt.Printf("created migration %s (%s)\n", mf.Name, mf.Path)
		return nil

	default:
		usage()
		return fmt.Errorf("unknown command %q", cmd)
	}
}

func usage() {
	fmt.Fprintln(os.Stderr, "usage: migrations <createdb|dropdb|url|migrate|rollback|status|create [name]>")
}
