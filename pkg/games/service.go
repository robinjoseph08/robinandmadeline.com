// Package games is the API and data layer for the games section's server-side
// state: crossword solve sessions and the v1 leaderboard. A session row is
// created when a guest starts a puzzle, updated with the client-reported
// accumulated active-solving time (and any difficulty switches) as they solve,
// and stamped with completed_at when they finish, so a row without one is
// observable as started-but-never-completed. The server stamps created_at and
// completed_at itself but only sanity-checks the reported elapsed_ms (it must
// grow monotonically and stay under a 24-hour cap), so the ranked leaderboard
// times are honor-system, not server-timed.
//
// The endpoints are public (the crossword needs no authentication); the
// session's UUID id doubles as its bearer token, so holding the id is what
// authorizes updates and one session can never address another. When a request
// does carry a valid guest token (the RSVP auth flow), the party is attached
// to the session opportunistically. The persistent model lives in pkg/models;
// this package owns the service writes, request/response types (types.go), and
// HTTP handlers.
package games

import (
	"context"
	"database/sql"
	"time"

	"github.com/google/uuid"
	"github.com/pkg/errors"
	"github.com/robinjoseph08/robinandmadeline.com/pkg/errcodes"
	"github.com/robinjoseph08/robinandmadeline.com/pkg/models"
	"github.com/uptrace/bun"
)

// leaderboardLimit caps how many entries a leaderboard read returns. There is
// no pagination in v1; the cap just keeps the response bounded.
const leaderboardLimit = 100

// Service is the games data layer over a Bun DB. Construct it with NewService.
// Methods return errcodes errors directly; handlers pass them through to the
// shared error handler.
type Service struct {
	db *bun.DB
}

// NewService builds a Service backed by the given Bun DB.
func NewService(db *bun.DB) *Service {
	return &Service{db: db}
}

// newID returns a fresh UUIDv7 string. v7 is time-ordered, which keeps inserts
// index-friendly and makes IDs roughly sortable by creation time. The id is
// also the session's bearer token; a UUID has ample entropy for that.
func newID() string {
	return uuid.Must(uuid.NewV7()).String()
}

// dbNow returns the current time truncated to the microsecond precision of a
// Postgres timestamptz. Stamping rows with the pre-truncated value keeps the
// timestamps a write returns byte-identical to what every later read sees;
// otherwise they drift by the sub-microsecond nanoseconds Linux clocks carry
// (macOS clocks tick in microseconds, which is why the drift hides locally).
func dbNow() time.Time {
	return time.Now().Truncate(time.Microsecond)
}

// CreateSession starts a solve: it inserts a session for the given puzzle at
// the given starting difficulty, capturing the client IP and, when partyID is
// non-blank (a valid guest token rode the request) and the party still exists
// (see attachParty), the party affiliation.
func (s *Service) CreateSession(ctx context.Context, in CreateGameSessionPayload, partyID, ipAddress string) (*models.GameSession, error) {
	now := dbNow()
	session := &models.GameSession{
		ID:         newID(),
		PuzzleID:   in.PuzzleID,
		IPAddress:  ipAddress,
		Difficulty: in.Difficulty,
		ElapsedMS:  0,
		CreatedAt:  now,
		UpdatedAt:  now,
	}
	if err := attachParty(ctx, s.db, session, partyID); err != nil {
		return nil, err
	}
	if _, err := s.db.NewInsert().Model(session).Exec(ctx); err != nil {
		return nil, errors.Wrap(err, "insert game session")
	}
	return session, nil
}

// UpdateSession applies one progress report to a session: the accumulated
// elapsed time (which may only grow; a decrease is a 422), an optional
// difficulty switch (the session keeps the easiest level seen), and an
// optional completion, which sets completed_at server-side exactly once. A
// completed session accepts only an exact no-op resend of its final state (a
// client retry); any update that would change it is a 409. The row is locked
// for the duration so concurrent reports cannot interleave between the read
// and the write. A party is attached opportunistically when partyID is
// non-blank and the session has none yet (e.g. the guest signed in mid-solve);
// see attachParty.
func (s *Service) UpdateSession(ctx context.Context, id string, in UpdateGameSessionPayload, partyID string) (*models.GameSession, error) {
	session := new(models.GameSession)
	err := s.db.RunInTx(ctx, &sql.TxOptions{}, func(ctx context.Context, tx bun.Tx) error {
		loaded, err := loadSessionForUpdate(ctx, tx, id)
		if err != nil {
			return err
		}

		if loaded.CompletedAt != nil {
			if !isCompletedNoop(loaded, in) {
				return errcodes.Conflict("This solve is already completed and can no longer be updated.")
			}
			*session = *loaded
			return nil
		}

		if int64(*in.ElapsedMS) < loaded.ElapsedMS {
			return errcodes.ValidationError("elapsed_ms cannot decrease; send the total accumulated time.")
		}

		now := dbNow()
		loaded.ElapsedMS = int64(*in.ElapsedMS)
		if in.Difficulty != nil {
			loaded.Difficulty = models.EasierDifficulty(loaded.Difficulty, *in.Difficulty)
		}
		if in.Completed {
			loaded.CompletedAt = &now
		}
		if err := attachParty(ctx, tx, loaded, partyID); err != nil {
			return err
		}
		loaded.UpdatedAt = now

		_, err = tx.NewUpdate().Model(loaded).
			Column("elapsed_ms", "difficulty", "completed_at", "party_id", "updated_at").
			WherePK().Exec(ctx)
		if err != nil {
			return errors.Wrap(err, "update game session")
		}
		*session = *loaded
		return nil
	})
	if err != nil {
		return nil, err
	}
	return session, nil
}

// isCompletedNoop reports whether an update to an already-completed session
// would change nothing: it re-asserts completion, carries the exact final
// elapsed time, and names no difficulty that would lower the recorded one.
// Such a resend (a client retrying its final report) succeeds idempotently;
// anything else is a conflict.
func isCompletedNoop(session *models.GameSession, in UpdateGameSessionPayload) bool {
	if !in.Completed || int64(*in.ElapsedMS) != session.ElapsedMS {
		return false
	}
	return in.Difficulty == nil || models.EasierDifficulty(session.Difficulty, *in.Difficulty) == session.Difficulty
}

// PostToLeaderboard publishes a completed solve under the given display name,
// the explicit opt-in that makes the session visible on the leaderboard.
// Posting an uncompleted session is a 422. Re-posting is idempotent when the
// name matches what was already published and a 409 otherwise (the leaderboard
// is append-once; there is no rename in v1). Like UpdateSession, a party is
// attached opportunistically, so a guest who signs in between completing and
// posting still gets their entry affiliated.
func (s *Service) PostToLeaderboard(ctx context.Context, id string, in PostLeaderboardPayload, partyID string) (*models.GameSession, error) {
	session := new(models.GameSession)
	err := s.db.RunInTx(ctx, &sql.TxOptions{}, func(ctx context.Context, tx bun.Tx) error {
		loaded, err := loadSessionForUpdate(ctx, tx, id)
		if err != nil {
			return err
		}
		if loaded.CompletedAt == nil {
			return errcodes.ValidationError("The puzzle must be completed before posting to the leaderboard.")
		}
		if loaded.DisplayName != nil {
			if *loaded.DisplayName != in.DisplayName {
				return errcodes.Conflict("This solve is already on the leaderboard under a different name.")
			}
			*session = *loaded
			return nil
		}

		loaded.DisplayName = &in.DisplayName
		if err := attachParty(ctx, tx, loaded, partyID); err != nil {
			return err
		}
		loaded.UpdatedAt = dbNow()

		_, err = tx.NewUpdate().Model(loaded).
			Column("display_name", "party_id", "updated_at").
			WherePK().Exec(ctx)
		if err != nil {
			return errors.Wrap(err, "post game session to leaderboard")
		}
		*session = *loaded
		return nil
	})
	if err != nil {
		return nil, err
	}
	return session, nil
}

// Leaderboard reads one puzzle's published entries: completed, opted-in
// sessions only, fastest first (ties broken by who completed earlier, then by
// session id so even a full tie orders identically across requests), capped
// at leaderboardLimit. The returned total counts every published entry for the
// puzzle, beyond the cap. The slice is never nil, so it serializes as [].
func (s *Service) Leaderboard(ctx context.Context, in LeaderboardQuery) ([]LeaderboardEntry, int, error) {
	var sessions []*models.GameSession
	total, err := s.db.NewSelect().Model(&sessions).
		Where("gs.puzzle_id = ?", in.PuzzleID).
		Where("gs.display_name IS NOT NULL").
		Where("gs.completed_at IS NOT NULL").
		Order("gs.elapsed_ms ASC", "gs.completed_at ASC", "gs.id ASC").
		Limit(leaderboardLimit).
		ScanAndCount(ctx)
	if err != nil {
		return nil, 0, errors.Wrap(err, "list leaderboard entries")
	}

	entries := make([]LeaderboardEntry, 0, len(sessions))
	for _, session := range sessions {
		entries = append(entries, LeaderboardEntry{
			DisplayName: *session.DisplayName,
			Difficulty:  session.Difficulty,
			ElapsedMS:   session.ElapsedMS,
			CompletedAt: *session.CompletedAt,
		})
	}
	return entries, total, nil
}

// loadSessionForUpdate fetches a session by id with a row lock (FOR UPDATE)
// inside the caller's transaction, so the read-check-write cycles above cannot
// race a concurrent report from the same client. An unknown id is a 404; ids
// are UUIDs, and the handlers reject malformed ones as 404 before any query
// (see pathID), so the text never reaches the uuid column as a failing cast.
func loadSessionForUpdate(ctx context.Context, tx bun.Tx, id string) (*models.GameSession, error) {
	session := new(models.GameSession)
	err := tx.NewSelect().Model(session).Where("gs.id = ?", id).For("UPDATE").Scan(ctx)
	if err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return nil, errcodes.NotFound("session")
		}
		return nil, errors.Wrap(err, "load game session")
	}
	return session, nil
}

// attachParty sets the session's party when a guest token rode the request
// (partyID non-blank), the session is not yet affiliated, and the party row
// still exists. An existing affiliation is never overwritten: the party that
// started the solve keeps it. The existence check matters because a guest
// token outlives its party row: the guest import deletes and recreates every
// party with fresh ids, an admin can delete a party outright, and tokens stay
// valid for months, so attaching a stale claim would violate the party FK and
// turn every session write for that guest into a 500. A stale token must
// instead degrade to an anonymous session. A party deleted between this check
// and the caller's write can still hit the FK; that window is vanishingly
// small and accepted. The query runs only when an attach would actually
// happen, on s.db in CreateSession and on the caller's transaction elsewhere.
func attachParty(ctx context.Context, db bun.IDB, session *models.GameSession, partyID string) error {
	if partyID == "" || session.PartyID != nil {
		return nil
	}
	exists, err := db.NewSelect().Model((*models.Party)(nil)).Where("p.id = ?", partyID).Exists(ctx)
	if err != nil {
		return errors.Wrap(err, "check party exists")
	}
	if exists {
		session.PartyID = &partyID
	}
	return nil
}
