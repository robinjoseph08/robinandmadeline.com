// Command migrations is a small CLI for inspecting and applying the database
// migrations registered in pkg/migrations.
//
// It deliberately uses only the standard library (an os.Args subcommand switch)
// plus the bun migrate.Migrator API, to avoid pulling a CLI framework into the
// dependency set. Subcommands:
//
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

	"github.com/robinjoseph08/robinandmadeline.com/pkg/config"
	"github.com/robinjoseph08/robinandmadeline.com/pkg/database"
	"github.com/robinjoseph08/robinandmadeline.com/pkg/migrations"
)

func main() {
	if len(os.Args) < 2 {
		usage()
		os.Exit(2)
	}

	if err := run(context.Background(), os.Args[1], os.Args[2:]); err != nil {
		fmt.Fprintf(os.Stderr, "migrations: %v\n", err)
		os.Exit(1)
	}
}

// run dispatches a subcommand. It is split out from main so the dispatch is
// covered by a unit test (main itself calls os.Exit, which a test cannot).
func run(ctx context.Context, cmd string, args []string) error {
	cfg, err := config.New()
	if err != nil {
		return fmt.Errorf("config error: %w", err)
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
	fmt.Fprintln(os.Stderr, "usage: migrations <migrate|rollback|status|create [name]>")
}
