package migrations

import (
	"context"
	"fmt"

	"github.com/uptrace/bun"
)

func init() {
	up := func(ctx context.Context, db *bun.DB) error {
		// parties: a group that receives a single invitation and shares one
		// mailing address and one RSVP code.
		//
		// side / relation / invitation_type are stored as TEXT guarded by CHECK
		// constraints rather than native PG enums: the value set is still young
		// and CHECK constraints are far cheaper to evolve (a plain ALTER) than
		// enum types, while app-level validation gives friendlier errors.
		//
		// circle is a Postgres text[] (multi-valued, see CONTEXT.md).
		//
		// The address columns are nullable because they only matter for physical
		// invitations and are filled in during info collection; the
		// info-collection status logic, not the schema, enforces when they are
		// required.
		//
		// info_collection_requested / info_collection_confirmed are the two
		// stored booleans behind the derived/affirmed status model (ADR 0005).
		// The status itself is never stored; it is derived in Go.
		_, err := db.ExecContext(ctx, `
			CREATE TABLE parties (
				id UUID PRIMARY KEY,
				name TEXT NOT NULL,
				side TEXT NOT NULL CHECK (side IN ('robin', 'madeline')),
				relation TEXT NOT NULL CHECK (relation IN ('family', 'friend')),
				circle TEXT[] NOT NULL DEFAULT '{}',
				invitation_type TEXT NOT NULL CHECK (invitation_type IN ('physical', 'digital')),
				address_line_1 TEXT,
				address_line_2 TEXT,
				city TEXT,
				state_or_province TEXT,
				postal_code TEXT,
				country TEXT,
				info_token TEXT NOT NULL,
				rsvp_code TEXT,
				info_collection_requested BOOLEAN NOT NULL DEFAULT FALSE,
				info_collection_confirmed BOOLEAN NOT NULL DEFAULT FALSE,
				created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
				updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
			)
		`)
		if err != nil {
			return fmt.Errorf("create parties table: %w", err)
		}

		// info_token is the opaque per-party link token; it must be unique so a
		// token resolves to exactly one party.
		_, err = db.ExecContext(ctx, `CREATE UNIQUE INDEX ux_parties_info_token ON parties (info_token)`)
		if err != nil {
			return fmt.Errorf("create parties info_token index: %w", err)
		}

		// rsvp_code is optional, but unique when present (a code authenticates a
		// single party). A partial index lets multiple parties have a NULL code
		// while still enforcing uniqueness across the set codes.
		_, err = db.ExecContext(ctx, `CREATE UNIQUE INDEX ux_parties_rsvp_code ON parties (rsvp_code) WHERE rsvp_code IS NOT NULL`)
		if err != nil {
			return fmt.Errorf("create parties rsvp_code index: %w", err)
		}

		// guests: an individual person belonging to exactly one party.
		//
		// party_id cascades on delete so removing a party removes its guests.
		// email / phone are per-guest (the address lives on the party). tags is
		// a text[] of relationship tags. The is_* booleans are NOT NULL with
		// sensible defaults; is_primary in particular is constrained to at most
		// one true per party by a partial unique index below.
		//
		// placeholder_text is the permanent descriptor of an unnamed plus-one
		// slot ("Guest of John Doe"); a guest is a placeholder iff it is
		// non-NULL. There is no stored boolean: clearing the text turns the row
		// back into a regular guest.
		_, err = db.ExecContext(ctx, `
			CREATE TABLE guests (
				id UUID PRIMARY KEY,
				party_id UUID NOT NULL REFERENCES parties (id) ON DELETE CASCADE,
				full_name TEXT NOT NULL,
				email TEXT,
				phone TEXT,
				tags TEXT[] NOT NULL DEFAULT '{}',
				is_primary BOOLEAN NOT NULL DEFAULT FALSE,
				is_child BOOLEAN NOT NULL DEFAULT FALSE,
				is_drinking BOOLEAN NOT NULL DEFAULT FALSE,
				placeholder_text TEXT,
				dietary_restrictions TEXT,
				table_number INTEGER,
				seat_number INTEGER,
				created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
				updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
			)
		`)
		if err != nil {
			return fmt.Errorf("create guests table: %w", err)
		}

		// Fetching a party's guests is the most common guest query.
		_, err = db.ExecContext(ctx, `CREATE INDEX ix_guests_party_id ON guests (party_id)`)
		if err != nil {
			return fmt.Errorf("create guests party_id index: %w", err)
		}

		// At most one primary guest per party. This is a hard, DB-level backstop
		// for the single-primary invariant the service enforces transactionally;
		// even a buggy write path cannot create two primaries for one party.
		_, err = db.ExecContext(ctx, `CREATE UNIQUE INDEX ux_guests_one_primary_per_party ON guests (party_id) WHERE is_primary`)
		if err != nil {
			return fmt.Errorf("create guests primary index: %w", err)
		}

		return nil
	}

	down := func(ctx context.Context, db *bun.DB) error {
		// guests first: it references parties.
		_, err := db.ExecContext(ctx, `DROP TABLE IF EXISTS guests`)
		if err != nil {
			return fmt.Errorf("drop guests table: %w", err)
		}
		_, err = db.ExecContext(ctx, `DROP TABLE IF EXISTS parties`)
		if err != nil {
			return fmt.Errorf("drop parties table: %w", err)
		}
		return nil
	}

	Migrations.MustRegister(up, down)
}
