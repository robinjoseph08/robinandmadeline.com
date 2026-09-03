// Package games is the API and data layer for the games section's server-side
// state: crossword solve sessions and the v1 leaderboard. A session row is
// created when a guest starts a puzzle, updated with the client-reported
// accumulated active-solving time (and any difficulty switches) as they solve,
// and stamped with completed_at when they finish, so a row without one is
// observable as started-but-never-completed. Every completed solve is stored
// regardless of whether the solver posts; the leaderboard opt-in is a separate
// explicit flag (on_leaderboard), so the collected times and the choice to
// appear on the board are independent (an admin view can list the completed
// solves that opted out). The server stamps created_at and completed_at itself
// but only sanity-checks the reported elapsed_ms (it must grow monotonically
// and stay under a 24-hour cap), so the ranked leaderboard times are
// honor-system, not server-timed.
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
	"github.com/robinjoseph08/golib/pointerutil"
	"github.com/robinjoseph08/robinandmadeline.com/pkg/errcodes"
	"github.com/robinjoseph08/robinandmadeline.com/pkg/models"
	"github.com/uptrace/bun"
)

// leaderboardLimit caps how many entries a leaderboard read returns. There is
// no pagination in v1; the cap is a defensive ceiling against abuse, set well
// above any real board (at wedding scale every entry is returned), so it bounds
// the response without truncating a legitimate leaderboard.
const leaderboardLimit = 500

// adminSessionLimit caps how many rows the admin sessions list returns. The
// admin surface is trusted and the data is bounded (one wedding's worth of
// solves), so there is no pagination in v1; this is purely a defensive ceiling
// so a runaway row count can never return an unbounded response. It is set far
// above any plausible real total, so in practice every session is returned and
// the total equals the item count.
const adminSessionLimit = 10000

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

// CreateGameSessionInput combines the bound client payload with request
// metadata captured by the server. The named fields keep PartyID, IPAddress,
// and UserAgent distinct at service call sites.
type CreateGameSessionInput struct {
	Payload   CreateGameSessionPayload
	PartyID   string
	IPAddress string
	UserAgent string
}

// CreateSession starts a solve: it inserts a session for the given puzzle at
// the given starting difficulty, capturing the client IP and user agent. When
// PartyID is non-blank (a valid guest token rode the request) and the party
// still exists (see attachParty), it also captures the party affiliation.
func (s *Service) CreateSession(ctx context.Context, in CreateGameSessionInput) (*models.GameSession, error) {
	now := dbNow()
	session := &models.GameSession{
		ID:         newID(),
		PuzzleID:   in.Payload.PuzzleID,
		IPAddress:  in.IPAddress,
		UserAgent:  in.UserAgent,
		Difficulty: in.Payload.Difficulty,
		ElapsedMS:  0,
		CreatedAt:  now,
		UpdatedAt:  now,
	}
	if err := attachParty(ctx, s.db, session, in.PartyID); err != nil {
		return nil, err
	}
	if _, err := s.db.NewInsert().Model(session).Exec(ctx); err != nil {
		return nil, errors.Wrap(err, "insert game session")
	}
	return session, nil
}

// UpdateSession applies one progress report to a session: the accumulated
// elapsed time and explicit check counts (which may only grow), an optional
// difficulty switch (the session keeps the easiest level seen), and an
// optional completion, which sets completed_at server-side exactly once. A
// completed session accepts a no-op resend whose cumulative totals do not
// exceed the frozen state; any update that would change it is a 409. The row is locked
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

		now := dbNow()
		loaded.ElapsedMS = max(loaded.ElapsedMS, int64(*in.ElapsedMS))
		applyCheckCounts(loaded, in)
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
			Column(
				"elapsed_ms",
				"square_checks",
				"word_checks",
				"grid_checks",
				"difficulty",
				"completed_at",
				"party_id",
				"updated_at",
			).
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
// elapsed time no greater than the frozen total, does not advance any check
// count, and names no difficulty that would lower the recorded one. A stale
// client may resend lower cumulative totals; accepting that retry preserves
// the frozen server values.
func isCompletedNoop(session *models.GameSession, in UpdateGameSessionPayload) bool {
	if !in.Completed || int64(*in.ElapsedMS) > session.ElapsedMS || checkCountsAdvance(session, in) {
		return false
	}
	return in.Difficulty == nil || models.EasierDifficulty(session.Difficulty, *in.Difficulty) == session.Difficulty
}

// applyCheckCounts keeps each server total monotonic. Stale reports are common
// after retries or another browser tab reports first, so lower values are
// accepted but never overwrite the larger stored total.
func applyCheckCounts(session *models.GameSession, in UpdateGameSessionPayload) {
	if in.SquareChecks != nil && int64(*in.SquareChecks) > session.SquareChecks {
		session.SquareChecks = int64(*in.SquareChecks)
	}
	if in.WordChecks != nil && int64(*in.WordChecks) > session.WordChecks {
		session.WordChecks = int64(*in.WordChecks)
	}
	if in.GridChecks != nil && int64(*in.GridChecks) > session.GridChecks {
		session.GridChecks = int64(*in.GridChecks)
	}
}

func checkCountsAdvance(session *models.GameSession, in UpdateGameSessionPayload) bool {
	return (in.SquareChecks != nil && int64(*in.SquareChecks) > session.SquareChecks) ||
		(in.WordChecks != nil && int64(*in.WordChecks) > session.WordChecks) ||
		(in.GridChecks != nil && int64(*in.GridChecks) > session.GridChecks)
}

// PostToLeaderboard publishes a completed solve under the given display name:
// it sets on_leaderboard (the explicit opt-in that makes the session visible)
// and stores the display_name shown on the board. Posting an uncompleted
// session is a 422. Re-posting is idempotent when the name matches what was
// first published and a 409 otherwise (the leaderboard is append-once; there
// is no rename in v1). An admin-hidden row retains its display name and
// hidden_at marker with on_leaderboard false, so an idempotent retry must not
// make it public again.
// Like UpdateSession, a party is attached opportunistically,
// so a guest who signs in between completing and posting still gets their entry
// affiliated.
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
		// A retained display name means this solve has already been published,
		// even when an admin later hid it by clearing on_leaderboard. The name is
		// append-once and a same-name retry is a no-op, so a client retry can never
		// accidentally unhide a moderated entry.
		if loaded.DisplayName != nil {
			if *loaded.DisplayName != in.DisplayName {
				return errcodes.Conflict("This solve is already on the leaderboard under a different name.")
			}
			*session = *loaded
			return nil
		}

		loaded.OnLeaderboard = true
		loaded.DisplayName = &in.DisplayName
		loaded.HiddenAt = nil
		if err := attachParty(ctx, tx, loaded, partyID); err != nil {
			return err
		}
		loaded.UpdatedAt = dbNow()

		_, err = tx.NewUpdate().Model(loaded).
			Column("on_leaderboard", "display_name", "hidden_at", "party_id", "updated_at").
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

// Leaderboard reads one puzzle's public entries: completed sessions with
// on_leaderboard set, fastest first (ties broken by who completed earlier, then
// by session id so even a full tie orders identically across requests), capped
// at leaderboardLimit. When a session bearer is supplied, its previously posted
// solve is added to that personalized response even if an admin hid it. An
// optional difficulty filter narrows the board to sessions whose recorded
// (easiest-used) difficulty matches; the cap and returned total then both apply
// within that difficulty. The slice is never nil, so it serializes as []. The
// partial leaderboard index
// covers (puzzle_id, elapsed_ms) without difficulty; the filter rides it as a
// row recheck, which is plenty at wedding scale (a board holds at most a few
// hundred rows).
//
// When in.SessionID is set it also computes the viewer: the requesting solver's
// own ranked entry (see leaderboardViewer), so the client can always show that
// solver their own row with its true rank even when the solver falls off the
// capped list. An admin-hidden entry is included in items and total only when
// the read carries that exact session bearer; it never enters another user's
// or an anonymous response. The viewer is nil when no session_id was given,
// when the id names no row, or when the named session was never posted or does
// not belong to the board being read.
func (s *Service) Leaderboard(ctx context.Context, in LeaderboardQuery) ([]LeaderboardEntry, int, *LeaderboardViewer, error) {
	var entries []LeaderboardEntry
	var total int
	var viewer *LeaderboardViewer
	err := s.db.RunInTx(ctx, &sql.TxOptions{
		Isolation: sql.LevelRepeatableRead,
		ReadOnly:  true,
	}, func(ctx context.Context, tx bun.Tx) error {
		var err error
		entries, total, viewer, err = leaderboard(ctx, tx, in)
		return err
	})
	if err != nil {
		return nil, 0, nil, err
	}
	return entries, total, viewer, nil
}

// leaderboard performs the list and viewer-rank reads against one database
// handle. Leaderboard passes a repeatable-read transaction so both halves of
// the response describe the same board snapshot even while solves are posted,
// hidden, or restored concurrently.
func leaderboard(ctx context.Context, db bun.IDB, in LeaderboardQuery) ([]LeaderboardEntry, int, *LeaderboardViewer, error) {
	var sessions []*models.GameSession
	q := db.NewSelect().Model(&sessions).
		Where("gs.puzzle_id = ?", in.PuzzleID).
		Where("gs.completed_at IS NOT NULL")
	if in.SessionID == nil {
		q = q.Where("gs.on_leaderboard = ?", true)
	} else {
		// Personalize only with the exact session bearer: public rows plus this
		// solver's previously posted row, even when an admin hid it. No other
		// hidden row can enter the response.
		q = q.Where(
			"(gs.on_leaderboard = ? OR (gs.id = ? AND gs.hidden_at IS NOT NULL))",
			true, *in.SessionID,
		)
	}
	if in.Difficulty != nil {
		q = q.Where("gs.difficulty = ?", *in.Difficulty)
	}
	total, err := q.
		Order("gs.elapsed_ms ASC", "gs.completed_at ASC", "gs.id ASC").
		Limit(leaderboardLimit).
		ScanAndCount(ctx)
	if err != nil {
		return nil, 0, nil, errors.Wrap(err, "list leaderboard entries")
	}

	entries := make([]LeaderboardEntry, 0, len(sessions))
	for _, session := range sessions {
		// The list predicate guarantees every public row has a name through the
		// DB CHECK, and the personalized hidden branch explicitly requires one.
		if session.DisplayName == nil {
			return nil, 0, nil, errcodes.Internal("leaderboard session is missing display_name")
		}
		entries = append(entries, leaderboardEntry(session))
	}

	viewer, err := leaderboardViewer(ctx, db, in)
	if err != nil {
		return nil, 0, nil, err
	}
	return entries, total, viewer, nil
}

// leaderboardViewer resolves the requesting solver's own ranked entry for a
// Leaderboard read, or nil when there is none to show. It returns nil (never an
// error) for every non-eligible case so a viewer that simply does not belong on
// the board reads as "no viewer," not a failure: no session_id given, an id
// that names no row, or a session that was never posted, is incomplete, or is
// not on this exact board (the same puzzle, and the same difficulty when the
// read is filtered, so a solver only appears on their own difficulty tab). An
// admin-hidden row remains eligible because its retained display_name proves it
// was posted; only its bearer-aware list includes it. The lookup is a plain
// read with no row lock inside the leaderboard's repeatable-read transaction.
// When the session is eligible, the rank is one more than the
// count of opted-in entries that sort strictly before it in the list's
// (elapsed_ms ASC, completed_at ASC, id ASC) ordering, counted within the same
// scope as the list, so the rank stays correct even past the returned cap. That
// count rides the same partial (puzzle_id, elapsed_ms) index the list uses; no
// new index is needed at wedding scale.
func leaderboardViewer(ctx context.Context, db bun.IDB, in LeaderboardQuery) (*LeaderboardViewer, error) {
	if in.SessionID == nil {
		return nil, nil
	}

	session := new(models.GameSession)
	err := db.NewSelect().Model(session).Where("gs.id = ?", *in.SessionID).Scan(ctx)
	if err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return nil, nil
		}
		return nil, errors.Wrap(err, "load viewer session")
	}

	eligible := session.PuzzleID == in.PuzzleID &&
		(session.OnLeaderboard || session.HiddenAt != nil) &&
		session.DisplayName != nil &&
		session.CompletedAt != nil &&
		(in.Difficulty == nil || session.Difficulty == *in.Difficulty)
	if !eligible {
		return nil, nil
	}

	// "Strictly before the viewer" in the list's (elapsed_ms ASC, completed_at
	// ASC, id ASC) ordering, with the same base predicates as the list. The ?N
	// placeholders are 0-indexed into this clause's own args, so the viewer's
	// (elapsed_ms, completed_at, id) tuple binds once each and is reused across
	// the three OR branches. The id comparison is the uuid column against the
	// session's id string, exactly like the existing gs.id = ? reads.
	q := db.NewSelect().Model((*models.GameSession)(nil)).
		Where("gs.puzzle_id = ?", in.PuzzleID).
		Where("gs.on_leaderboard = ?", true).
		Where("gs.completed_at IS NOT NULL").
		Where(
			"(gs.elapsed_ms < ?0"+
				" OR (gs.elapsed_ms = ?0 AND gs.completed_at < ?1)"+
				" OR (gs.elapsed_ms = ?0 AND gs.completed_at = ?1 AND gs.id < ?2))",
			session.ElapsedMS, *session.CompletedAt, session.ID,
		)
	if in.Difficulty != nil {
		q = q.Where("gs.difficulty = ?", *in.Difficulty)
	}
	ahead, err := q.Count(ctx)
	if err != nil {
		return nil, errors.Wrap(err, "count entries ahead of viewer")
	}

	return &LeaderboardViewer{
		Rank:    ahead + 1,
		InItems: ahead < leaderboardLimit,
		Entry:   leaderboardEntry(session),
	}, nil
}

func leaderboardEntry(session *models.GameSession) LeaderboardEntry {
	return LeaderboardEntry{
		DisplayName: *session.DisplayName,
		Difficulty:  session.Difficulty,
		ElapsedMS:   session.ElapsedMS,
		CompletedAt: *session.CompletedAt,
		UsedChecks:  session.HasUsedChecks(),
	}
}

// adminSessionRow is the scan target for ListSessions: the full session row
// plus the affiliated party's name, joined in. It embeds models.GameSession so
// every stored column (including the request metadata that the session's own
// JSON hides) lands on the struct, and adds PartyName from the LEFT JOIN. PartyName is a
// pointer so it stays NULL for an anonymous session, matching party_id. It
// repeats the game_sessions table/alias so bun targets that table and the gs.*
// / join clauses resolve, rather than deriving a table name from this struct.
// It is an internal type, never serialized: the handler maps it to the
// dedicated AdminGameSessionResponse.
type adminSessionRow struct {
	bun.BaseModel `bun:"table:game_sessions,alias:gs"`

	models.GameSession
	PartyName *string `bun:"party_name"`
}

// ListSessions returns every solve session for the admin view, newest first
// (created_at DESC, then id as a stable tiebreak), and the total count. Unlike
// the leaderboard read it filters nothing: completed and in-progress solves,
// posted and unposted, all appear, since the admin view exists to see and clean
// up every recorded time. The affiliated party's name rides a LEFT JOIN to
// parties, so party_name is the party's name (parties.name) for an affiliated
// solve and NULL for an anonymous one, exactly tracking party_id. The result is
// capped at adminSessionLimit purely as a defensive ceiling; at wedding scale
// every session is returned and the total equals the item count. The returned
// slice is never nil, so it serializes as [].
func (s *Service) ListSessions(ctx context.Context) ([]AdminGameSessionResponse, int, error) {
	var rows []adminSessionRow
	total, err := s.db.NewSelect().Model(&rows).
		ColumnExpr("gs.*").
		ColumnExpr("p.name AS party_name").
		Join("LEFT JOIN parties AS p ON p.id = gs.party_id").
		Order("gs.created_at DESC", "gs.id DESC").
		Limit(adminSessionLimit).
		ScanAndCount(ctx)
	if err != nil {
		return nil, 0, errors.Wrap(err, "list game sessions")
	}

	items := make([]AdminGameSessionResponse, 0, len(rows))
	for _, row := range rows {
		items = append(items, AdminGameSessionResponse{
			ID:            row.ID,
			PuzzleID:      row.PuzzleID,
			Difficulty:    row.Difficulty,
			ElapsedMS:     row.ElapsedMS,
			SquareChecks:  row.SquareChecks,
			WordChecks:    row.WordChecks,
			GridChecks:    row.GridChecks,
			CompletedAt:   row.CompletedAt,
			OnLeaderboard: row.OnLeaderboard,
			DisplayName:   row.DisplayName,
			HiddenAt:      row.HiddenAt,
			PartyID:       row.PartyID,
			PartyName:     row.PartyName,
			IPAddress:     row.IPAddress,
			UserAgent:     row.UserAgent,
			CreatedAt:     row.CreatedAt,
			UpdatedAt:     row.UpdatedAt,
		})
	}
	return items, total, nil
}

// HideSession removes one published solve from public leaderboards while
// retaining its time, bearer id, display name, and attribution. The retained
// name lets the solver continue seeing the entry through a viewer-aware read
// and prevents a posting retry from making it public again. Hiding an unknown
// session is a 404; hiding an already-hidden row is idempotent. An unposted row
// is retained unchanged because it is already absent from public boards.
func (s *Service) HideSession(ctx context.Context, id string) error {
	return s.db.RunInTx(ctx, &sql.TxOptions{}, func(ctx context.Context, tx bun.Tx) error {
		session, err := loadSessionForUpdate(ctx, tx, id)
		if err != nil {
			return err
		}
		if session.HiddenAt != nil || !session.OnLeaderboard {
			return nil
		}

		now := dbNow()
		session.OnLeaderboard = false
		session.HiddenAt = pointerutil.Time(now)
		session.UpdatedAt = now
		_, err = tx.NewUpdate().Model(session).
			Column("on_leaderboard", "hidden_at", "updated_at").
			WherePK().Exec(ctx)
		if err != nil {
			return errors.Wrap(err, "hide game session")
		}
		return nil
	})
}

// UnhideSession restores a previously posted, admin-hidden solve to public
// leaderboards. The retained display name proves the solver had opted in before
// moderation. Ordinary unposted sessions are left unchanged, so this admin
// action cannot publish a solve on the solver's behalf. Restoring an unknown
// session is a 404; restoring an already-visible row is idempotent.
func (s *Service) UnhideSession(ctx context.Context, id string) error {
	return s.db.RunInTx(ctx, &sql.TxOptions{}, func(ctx context.Context, tx bun.Tx) error {
		session, err := loadSessionForUpdate(ctx, tx, id)
		if err != nil {
			return err
		}
		if session.HiddenAt == nil {
			return nil
		}
		if session.DisplayName == nil || session.CompletedAt == nil {
			return errcodes.Internal("hidden game session is missing leaderboard data")
		}

		now := dbNow()
		session.OnLeaderboard = true
		session.HiddenAt = nil
		session.UpdatedAt = now
		_, err = tx.NewUpdate().Model(session).
			Column("on_leaderboard", "hidden_at", "updated_at").
			WherePK().Exec(ctx)
		if err != nil {
			return errors.Wrap(err, "unhide game session")
		}
		return nil
	})
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
