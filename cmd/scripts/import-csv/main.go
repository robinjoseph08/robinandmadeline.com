// Command import-csv is a one-time operational script that imports the
// couple's Google Sheets guest-list export into the parties and guests tables.
//
// Usage:
//
//	go run ./cmd/scripts/import-csv [--truncate] <path/to/guest-list.csv>
//
// The CSV is parsed and validated first (guests grouped into parties by the
// "Family (Party)" column; any data problem fails before the database is
// touched), then written in a single transaction. By default the import
// refuses to run against a database that already has parties, so running it
// twice cannot create duplicates; --truncate wipes parties and guests inside
// the same transaction first, for iterating during setup. On success it prints
// a summary plus any warnings (size mismatches, blank cells) to fix in the
// admin afterward. See internal/guestimport for the column mapping.
package main

import (
	"context"
	"flag"
	"fmt"
	"os"

	"github.com/pkg/errors"
	"github.com/robinjoseph08/golib/logger"
	"github.com/robinjoseph08/robinandmadeline.com/internal/guestimport"
	"github.com/robinjoseph08/robinandmadeline.com/pkg/config"
	"github.com/robinjoseph08/robinandmadeline.com/pkg/database"
)

func main() {
	log := logger.New()

	truncate := flag.Bool("truncate", false, "wipe existing parties and guests (inside the import transaction) before importing")
	flag.Usage = usage
	flag.Parse()
	if flag.NArg() != 1 {
		usage()
		os.Exit(2)
	}

	if err := run(context.Background(), flag.Arg(0), *truncate); err != nil {
		log.Err(err).Fatal("import error")
	}
}

// run does the whole import; it is split out from main so the logic returns an
// error rather than calling os.Exit, keeping main a thin shell that only
// translates that error into an exit code (mirroring cmd/migrations).
func run(ctx context.Context, path string, truncate bool) error {
	cfg, err := config.New()
	if err != nil {
		return errors.Wrap(err, "config error")
	}

	db, err := database.New(cfg)
	if err != nil {
		return errors.Wrap(err, "database error")
	}
	defer func() { _ = db.Close() }()

	f, err := os.Open(path) //nolint:gosec // the path is an operator-supplied CLI argument
	if err != nil {
		return errors.Wrap(err, "open csv")
	}
	defer func() { _ = f.Close() }()

	plan, err := guestimport.Parse(f)
	if err != nil {
		return err
	}

	summary, err := guestimport.Import(ctx, db, plan, guestimport.Options{Truncate: truncate})
	if err != nil {
		return err
	}

	fmt.Printf("parties created:    %d\n", summary.PartiesCreated)
	fmt.Printf("guests created:     %d\n", summary.GuestsCreated)
	fmt.Printf("blank rows skipped: %d\n", plan.SkippedBlankRows)
	if len(plan.Warnings) > 0 {
		fmt.Printf("\n%d warning(s):\n", len(plan.Warnings))
		for _, w := range plan.Warnings {
			fmt.Printf("  - %s\n", w)
		}
	}
	return nil
}

func usage() {
	fmt.Fprintln(os.Stderr, "usage: import-csv [--truncate] <path/to/guest-list.csv>")
	flag.PrintDefaults()
}
