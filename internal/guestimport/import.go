package guestimport

import (
	"context"
	"database/sql"
	"time"

	"github.com/google/uuid"
	"github.com/pkg/errors"
	"github.com/robinjoseph08/golib/pointerutil"
	"github.com/robinjoseph08/robinandmadeline.com/pkg/models"
	"github.com/robinjoseph08/robinandmadeline.com/pkg/parties"
	"github.com/uptrace/bun"
)

// Options controls how Import treats existing data.
type Options struct {
	// Truncate wipes the parties and guests tables (inside the import's own
	// transaction) before inserting, supporting iterate-and-re-run during
	// setup. Without it, Import refuses to run against a database that already
	// has parties, so running the script twice cannot create duplicates.
	Truncate bool
}

// Summary reports what an Import wrote. GuestsCreated counts every guest row,
// named and placeholder alike; PlaceholdersCreated is the subset expanded from
// Size cells (unnamed plus-ones with is_placeholder set).
type Summary struct {
	PartiesCreated      int
	GuestsCreated       int
	PlaceholdersCreated int
}

// maxGenerateAttempts bounds the retry loop for generated RSVP codes and info
// tokens colliding within the import batch. Token collisions are astronomically
// unlikely and code collisions rare at wedding scale (~10^2 parties against a
// 3.2M code space), so a handful of retries is plenty.
const maxGenerateAttempts = 5

// Import writes a parsed Plan to the database in a single transaction, so a
// failure anywhere leaves the database untouched. It fills in everything Parse
// left blank: IDs (time-ordered UUIDv7s assigned in sheet order, so guests keep
// their sheet order under the created_at/id sort the API uses), a fresh unique
// info token per party, and a generated RSVP code for every party without an
// explicit one. Explicit codes were validated unique by Parse; generated values
// are checked against everything else in the batch. The info_collection_* flags
// are left false, so every imported party starts not-requested and its status
// derives from the imported data (ADR 0005).
func Import(ctx context.Context, db *bun.DB, plan *Plan, opts Options) (*Summary, error) {
	summary := &Summary{}
	err := db.RunInTx(ctx, &sql.TxOptions{}, func(ctx context.Context, tx bun.Tx) error {
		if opts.Truncate {
			// Refuse a destructive no-op: truncating on behalf of a plan with
			// nothing in it would just wipe the data (an emptied or wrong file
			// can still parse cleanly when its headers match).
			if len(plan.Parties) == 0 {
				return errors.New("refusing to truncate: the parsed plan has no parties to import")
			}
			// Both tables are named explicitly (rather than CASCADE) so that if a
			// future table ever references parties, this stale script fails loudly
			// instead of silently wiping it.
			if _, err := tx.ExecContext(ctx, "TRUNCATE TABLE parties, guests"); err != nil {
				return errors.Wrap(err, "truncate parties and guests")
			}
		} else {
			count, err := tx.NewSelect().Model((*models.Party)(nil)).Count(ctx)
			if err != nil {
				return errors.Wrap(err, "count existing parties")
			}
			if count > 0 {
				return errors.Errorf("database already contains %d parties; re-run with --truncate to wipe and re-import", count)
			}
		}

		partyRecords, guestRecords, err := buildRecords(plan)
		if err != nil {
			return err
		}
		if len(partyRecords) == 0 {
			return nil
		}

		if _, err := tx.NewInsert().Model(&partyRecords).Exec(ctx); err != nil {
			return errors.Wrap(err, "insert parties")
		}
		if _, err := tx.NewInsert().Model(&guestRecords).Exec(ctx); err != nil {
			return errors.Wrap(err, "insert guests")
		}

		summary.PartiesCreated = len(partyRecords)
		summary.GuestsCreated = len(guestRecords)
		for _, guest := range guestRecords {
			if guest.IsPlaceholder {
				summary.PlaceholdersCreated++
			}
		}
		return nil
	})
	if err != nil {
		return nil, err
	}
	return summary, nil
}

// buildRecords flattens the plan into insertable party and guest rows,
// assigning IDs, timestamps, info tokens, and generated RSVP codes. The
// database is empty at this point (checked or truncated above), so uniqueness
// only has to hold within the batch: explicit codes are pre-seeded into the
// used set, and generated codes and tokens retry on an in-batch collision.
func buildRecords(plan *Plan) ([]*models.Party, []*models.Guest, error) {
	usedCodes := make(map[string]bool)
	for _, pp := range plan.Parties {
		if pp.Party.RSVPCode != nil {
			usedCodes[*pp.Party.RSVPCode] = true
		}
	}
	usedTokens := make(map[string]bool)

	totalGuests := 0
	for _, pp := range plan.Parties {
		totalGuests += len(pp.Guests)
	}

	now := time.Now()
	partyRecords := make([]*models.Party, 0, len(plan.Parties))
	guestRecords := make([]*models.Guest, 0, totalGuests)
	for _, pp := range plan.Parties {
		party := pp.Party
		party.ID = newID()
		party.CreatedAt, party.UpdatedAt = now, now

		token, err := generateUnique(usedTokens, parties.GenerateInfoToken)
		if err != nil {
			return nil, nil, errors.Wrap(err, "generate info token")
		}
		party.InfoToken = token

		if party.RSVPCode == nil {
			code, err := generateUnique(usedCodes, parties.GenerateRSVPCode)
			if err != nil {
				return nil, nil, errors.Wrap(err, "generate rsvp code")
			}
			party.RSVPCode = pointerutil.String(code)
		}

		partyRecords = append(partyRecords, party)
		for _, guest := range pp.Guests {
			guest.ID = newID()
			guest.PartyID = party.ID
			guest.CreatedAt, guest.UpdatedAt = now, now
			guestRecords = append(guestRecords, guest)
		}
	}
	return partyRecords, guestRecords, nil
}

// generateUnique draws from gen until it produces a value not already in used,
// claims it, and returns it. The used set spans the whole import batch, which
// is the only uniqueness scope needed against an empty table.
func generateUnique(used map[string]bool, gen func() (string, error)) (string, error) {
	for attempt := 0; attempt < maxGenerateAttempts; attempt++ {
		v, err := gen()
		if err != nil {
			return "", err
		}
		if used[v] {
			continue
		}
		used[v] = true
		return v, nil
	}
	return "", errors.Errorf("exhausted %d attempts generating a unique value", maxGenerateAttempts)
}

// newID returns a fresh UUIDv7 string, matching the service's ID scheme: v7 is
// time-ordered, so IDs assigned in sheet order keep sheet order as the
// created_at/id sort tiebreak.
func newID() string {
	return uuid.Must(uuid.NewV7()).String()
}
