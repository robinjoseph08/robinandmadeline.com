package games_test

import (
	"context"
	"testing"
	"time"

	"github.com/robinjoseph08/golib/pointerutil"
	"github.com/robinjoseph08/robinandmadeline.com/internal/databasetest"
	"github.com/robinjoseph08/robinandmadeline.com/pkg/errcodes"
	"github.com/robinjoseph08/robinandmadeline.com/pkg/games"
	"github.com/robinjoseph08/robinandmadeline.com/pkg/models"
	"github.com/robinjoseph08/robinandmadeline.com/pkg/parties"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"github.com/uptrace/bun"
)

// newServices returns a games.Service plus the parties service used for
// fixtures, backed by a dedicated Postgres test database (these tests truncate
// parties, which other package binaries own in the shared database).
// Truncating parties cascades nothing into game_sessions (the FK is ON DELETE
// SET NULL, and TRUNCATE CASCADE truncates the referencing table instead), so
// game_sessions is truncated explicitly. Tests using it must not call
// t.Parallel() because the package shares this one database and relies on
// truncation for isolation.
func newServices(t *testing.T) (*games.Service, *parties.Service, *bun.DB) {
	t.Helper()
	db := databasetest.NewIsolated(t, "robinandmadeline_games_test")
	databasetest.Truncate(t, db, "game_sessions", "parties")
	return games.NewService(db), parties.NewService(db), db
}

func ctx() context.Context { return context.Background() }

// assertErrCode asserts that err resolves to an *errcodes.Error with the given
// code.
func assertErrCode(t *testing.T, err error, code errcodes.Code) {
	t.Helper()
	require.Error(t, err)
	var e *errcodes.Error
	require.ErrorAs(t, err, &e)
	require.Equal(t, string(code), e.Code)
}

// createPartyT creates a party fixture via the parties service.
func createPartyT(t *testing.T, svc *parties.Service, name string) *models.Party {
	t.Helper()
	p, err := svc.CreateParty(ctx(), parties.CreatePartyPayload{
		Name:           name,
		Side:           models.SideRobin,
		Relation:       models.RelationFriend,
		InvitationType: models.InvitationDigital,
	})
	require.NoError(t, err)
	return p
}

// startSessionT creates an anonymous session fixture on the mini puzzle.
func startSessionT(t *testing.T, svc *games.Service, difficulty string) *models.GameSession {
	t.Helper()
	session, err := svc.CreateSession(ctx(), games.CreateGameSessionPayload{
		PuzzleID:   "wedding-mini-v1",
		Difficulty: difficulty,
	}, "", "203.0.113.7")
	require.NoError(t, err)
	return session
}

// update is a shorthand for one progress report.
func update(svc *games.Service, id string, elapsed int, difficulty *string, completed bool) (*models.GameSession, error) {
	return svc.UpdateSession(ctx(), id, games.UpdateGameSessionPayload{
		ElapsedMS:  pointerutil.Int(elapsed),
		Difficulty: difficulty,
		Completed:  completed,
	}, "")
}

// completeSessionT drives a fresh session to completion at the given elapsed
// time and difficulty, ready for a leaderboard post.
func completeSessionT(t *testing.T, svc *games.Service, difficulty string, elapsed int) *models.GameSession {
	t.Helper()
	session := startSessionT(t, svc, difficulty)
	completed, err := update(svc, session.ID, elapsed, nil, true)
	require.NoError(t, err)
	return completed
}

// sessionRow reads one game_sessions row straight from the DB.
func sessionRow(t *testing.T, db *bun.DB, id string) *models.GameSession {
	t.Helper()
	row := new(models.GameSession)
	require.NoError(t, db.NewSelect().Model(row).Where("gs.id = ?", id).Scan(ctx()))
	return row
}

func TestCreateSession_CapturesPuzzleDifficultyIPAndNullParty(t *testing.T) {
	svc, _, db := newServices(t)

	session, err := svc.CreateSession(ctx(), games.CreateGameSessionPayload{
		PuzzleID:   "wedding-mini-v1",
		Difficulty: models.GameDifficultyMedium,
	}, "", "203.0.113.7")
	require.NoError(t, err)

	row := sessionRow(t, db, session.ID)
	assert.Equal(t, "wedding-mini-v1", row.PuzzleID)
	assert.Equal(t, models.GameDifficultyMedium, row.Difficulty)
	assert.Equal(t, "203.0.113.7", row.IPAddress)
	assert.Nil(t, row.PartyID, "an anonymous solve has no party")
	assert.EqualValues(t, 0, row.ElapsedMS)
	assert.Nil(t, row.CompletedAt, "a fresh session is started-but-not-completed")
	assert.Nil(t, row.DisplayName)
	assert.False(t, row.CreatedAt.IsZero())
}

func TestCreateSession_AttachesPartyWhenAuthed(t *testing.T) {
	svc, partySvc, db := newServices(t)
	p := createPartyT(t, partySvc, "The Smiths")

	session, err := svc.CreateSession(ctx(), games.CreateGameSessionPayload{
		PuzzleID:   "wedding-mini-v1",
		Difficulty: models.GameDifficultyEasy,
	}, p.ID, "203.0.113.7")
	require.NoError(t, err)

	row := sessionRow(t, db, session.ID)
	require.NotNil(t, row.PartyID)
	assert.Equal(t, p.ID, *row.PartyID)
}

func TestCreateSession_StalePartyClaimDegradesToAnonymous(t *testing.T) {
	svc, _, db := newServices(t)

	// A guest token outlives its party row (the import recreates every party
	// with fresh ids, an admin can delete one), so a claim naming a vanished
	// party must create an anonymous session, not fail the party FK.
	session, err := svc.CreateSession(ctx(), games.CreateGameSessionPayload{
		PuzzleID:   "wedding-mini-v1",
		Difficulty: models.GameDifficultyEasy,
	}, "00000000-0000-0000-0000-000000000000", "203.0.113.7")
	require.NoError(t, err)
	assert.Nil(t, sessionRow(t, db, session.ID).PartyID, "the stale claim degrades to an anonymous session")
}

func TestUpdateSession_StalePartyClaimLeavesSessionAnonymous(t *testing.T) {
	svc, _, db := newServices(t)
	session := startSessionT(t, svc, models.GameDifficultyMedium)

	// The same stale-token degradation applies mid-solve: the report succeeds
	// and the session simply stays unaffiliated.
	updated, err := svc.UpdateSession(ctx(), session.ID, games.UpdateGameSessionPayload{
		ElapsedMS: pointerutil.Int(1000),
	}, "00000000-0000-0000-0000-000000000000")
	require.NoError(t, err)
	assert.EqualValues(t, 1000, updated.ElapsedMS)
	assert.Nil(t, sessionRow(t, db, session.ID).PartyID)
}

func TestUpdateSession_ElapsedAccumulatesAndDecreasesAreRejected(t *testing.T) {
	svc, _, db := newServices(t)
	session := startSessionT(t, svc, models.GameDifficultyMedium)

	_, err := update(svc, session.ID, 5000, nil, false)
	require.NoError(t, err)
	updated, err := update(svc, session.ID, 12000, nil, false)
	require.NoError(t, err)
	assert.EqualValues(t, 12000, updated.ElapsedMS)

	// elapsed_ms is the accumulated total, so it may only grow.
	_, err = update(svc, session.ID, 11999, nil, false)
	assertErrCode(t, err, errcodes.CodeValidationError)
	assert.EqualValues(t, 12000, sessionRow(t, db, session.ID).ElapsedMS, "a rejected report persists nothing")

	// Resending the same total is fine (the client may not have advanced).
	_, err = update(svc, session.ID, 12000, nil, false)
	require.NoError(t, err)
}

func TestUpdateSession_RecordsTheEasiestDifficultySeen(t *testing.T) {
	svc, _, db := newServices(t)
	session := startSessionT(t, svc, models.GameDifficultyMedium)

	// medium -> easy lowers the recorded difficulty.
	updated, err := update(svc, session.ID, 1000, pointerutil.String(models.GameDifficultyEasy), false)
	require.NoError(t, err)
	assert.Equal(t, models.GameDifficultyEasy, updated.Difficulty)

	// easy -> hard does not raise it back: easy help was already used.
	updated, err = update(svc, session.ID, 2000, pointerutil.String(models.GameDifficultyHard), false)
	require.NoError(t, err)
	assert.Equal(t, models.GameDifficultyEasy, updated.Difficulty)
	assert.Equal(t, models.GameDifficultyEasy, sessionRow(t, db, session.ID).Difficulty)
}

func TestUpdateSession_CompletionStampsCompletedAtOnce(t *testing.T) {
	svc, _, db := newServices(t)
	session := startSessionT(t, svc, models.GameDifficultyHard)

	completed, err := update(svc, session.ID, 90000, nil, true)
	require.NoError(t, err)
	require.NotNil(t, completed.CompletedAt, "completion is stamped server-side")
	stamp := *completed.CompletedAt

	// An exact resend of the final report (a client retry) is an idempotent
	// no-op: same 200-path, same stamp, nothing rewritten.
	again, err := update(svc, session.ID, 90000, nil, true)
	require.NoError(t, err)
	require.NotNil(t, again.CompletedAt)
	assert.True(t, stamp.Equal(*again.CompletedAt), "the original completion stamp is kept")

	// Any post-completion change attempt is a conflict: more elapsed time, a
	// difficulty switch that would lower the recorded level, or un-completing.
	_, err = update(svc, session.ID, 95000, nil, true)
	assertErrCode(t, err, errcodes.CodeConflict)
	_, err = update(svc, session.ID, 90000, pointerutil.String(models.GameDifficultyEasy), true)
	assertErrCode(t, err, errcodes.CodeConflict)
	_, err = update(svc, session.ID, 90000, nil, false)
	assertErrCode(t, err, errcodes.CodeConflict)

	row := sessionRow(t, db, session.ID)
	assert.True(t, stamp.Equal(*row.CompletedAt))
	assert.EqualValues(t, 90000, row.ElapsedMS)
	assert.Equal(t, models.GameDifficultyHard, row.Difficulty)
}

func TestUpdateSession_NoopResendMayNameANonLoweringDifficulty(t *testing.T) {
	svc, _, _ := newServices(t)
	session := startSessionT(t, svc, models.GameDifficultyEasy)
	_, err := update(svc, session.ID, 1000, nil, true)
	require.NoError(t, err)

	// The retry carries the difficulty the client last had selected; hard
	// would not lower easy, so the resend is still a no-op.
	again, err := update(svc, session.ID, 1000, pointerutil.String(models.GameDifficultyHard), true)
	require.NoError(t, err)
	assert.Equal(t, models.GameDifficultyEasy, again.Difficulty)
}

func TestUpdateSession_UnknownSessionIs404(t *testing.T) {
	svc, _, _ := newServices(t)
	_, err := update(svc, "00000000-0000-0000-0000-000000000000", 1000, nil, false)
	assertErrCode(t, err, errcodes.CodeNotFound)
}

func TestUpdateSession_AttachesPartyMidSolveButNeverReassigns(t *testing.T) {
	svc, partySvc, db := newServices(t)
	smiths := createPartyT(t, partySvc, "The Smiths")
	joneses := createPartyT(t, partySvc, "The Joneses")

	// An anonymous solve picks up the party when the guest signs in mid-solve.
	session := startSessionT(t, svc, models.GameDifficultyMedium)
	_, err := svc.UpdateSession(ctx(), session.ID, games.UpdateGameSessionPayload{
		ElapsedMS: pointerutil.Int(1000),
	}, smiths.ID)
	require.NoError(t, err)
	row := sessionRow(t, db, session.ID)
	require.NotNil(t, row.PartyID)
	assert.Equal(t, smiths.ID, *row.PartyID)

	// The party that started the solve keeps it.
	_, err = svc.UpdateSession(ctx(), session.ID, games.UpdateGameSessionPayload{
		ElapsedMS: pointerutil.Int(2000),
	}, joneses.ID)
	require.NoError(t, err)
	row = sessionRow(t, db, session.ID)
	require.NotNil(t, row.PartyID)
	assert.Equal(t, smiths.ID, *row.PartyID)
}

func TestPostToLeaderboard_RequiresCompletion(t *testing.T) {
	svc, _, db := newServices(t)
	session := startSessionT(t, svc, models.GameDifficultyMedium)

	_, err := svc.PostToLeaderboard(ctx(), session.ID, games.PostLeaderboardPayload{DisplayName: "Alice"}, "")
	assertErrCode(t, err, errcodes.CodeValidationError)
	assert.Nil(t, sessionRow(t, db, session.ID).DisplayName)
}

func TestPostToLeaderboard_UnknownSessionIs404(t *testing.T) {
	svc, _, _ := newServices(t)
	_, err := svc.PostToLeaderboard(ctx(), "00000000-0000-0000-0000-000000000000", games.PostLeaderboardPayload{DisplayName: "Alice"}, "")
	assertErrCode(t, err, errcodes.CodeNotFound)
}

func TestPostToLeaderboard_SetsNameIdempotentlyAndRejectsRenames(t *testing.T) {
	svc, _, db := newServices(t)
	session := completeSessionT(t, svc, models.GameDifficultyMedium, 45000)

	posted, err := svc.PostToLeaderboard(ctx(), session.ID, games.PostLeaderboardPayload{DisplayName: "Alice"}, "")
	require.NoError(t, err)
	require.NotNil(t, posted.DisplayName)
	assert.Equal(t, "Alice", *posted.DisplayName)

	// A retry of the same post succeeds without change.
	again, err := svc.PostToLeaderboard(ctx(), session.ID, games.PostLeaderboardPayload{DisplayName: "Alice"}, "")
	require.NoError(t, err)
	assert.Equal(t, "Alice", *again.DisplayName)

	// The leaderboard is append-once: posting a different name is a conflict.
	_, err = svc.PostToLeaderboard(ctx(), session.ID, games.PostLeaderboardPayload{DisplayName: "Bob"}, "")
	assertErrCode(t, err, errcodes.CodeConflict)
	assert.Equal(t, "Alice", *sessionRow(t, db, session.ID).DisplayName)
}

func TestPostToLeaderboard_AttachesPartyOpportunistically(t *testing.T) {
	svc, partySvc, db := newServices(t)
	p := createPartyT(t, partySvc, "The Smiths")
	session := completeSessionT(t, svc, models.GameDifficultyEasy, 30000)

	// The guest signed in between completing and posting: the entry is
	// affiliated, and the display name is stored regardless.
	_, err := svc.PostToLeaderboard(ctx(), session.ID, games.PostLeaderboardPayload{DisplayName: "Alice"}, p.ID)
	require.NoError(t, err)
	row := sessionRow(t, db, session.ID)
	require.NotNil(t, row.PartyID)
	assert.Equal(t, p.ID, *row.PartyID)
	require.NotNil(t, row.DisplayName)
	assert.Equal(t, "Alice", *row.DisplayName)
}

func TestLeaderboard_ReturnsOnlyPostedEntriesFastestFirst(t *testing.T) {
	svc, _, _ := newServices(t)

	// Three published solves, posted out of pace order.
	for _, fixture := range []struct {
		name       string
		difficulty string
		elapsed    int
	}{
		{"Bob", models.GameDifficultyMedium, 60000},
		{"Alice", models.GameDifficultyHard, 30000},
		{"Carol", models.GameDifficultyEasy, 90000},
	} {
		session := completeSessionT(t, svc, fixture.difficulty, fixture.elapsed)
		_, err := svc.PostToLeaderboard(ctx(), session.ID, games.PostLeaderboardPayload{DisplayName: fixture.name}, "")
		require.NoError(t, err)
	}
	// Completed but never opted in: must not appear.
	completeSessionT(t, svc, models.GameDifficultyEasy, 1000)
	// Started but never completed: must not appear either.
	startSessionT(t, svc, models.GameDifficultyEasy)
	// A different puzzle's entry stays on its own board.
	other, err := svc.CreateSession(ctx(), games.CreateGameSessionPayload{
		PuzzleID:   "wedding-full-v1",
		Difficulty: models.GameDifficultyEasy,
	}, "", "203.0.113.7")
	require.NoError(t, err)
	_, err = update(svc, other.ID, 500, nil, true)
	require.NoError(t, err)
	_, err = svc.PostToLeaderboard(ctx(), other.ID, games.PostLeaderboardPayload{DisplayName: "Dan"}, "")
	require.NoError(t, err)

	entries, total, err := svc.Leaderboard(ctx(), games.LeaderboardQuery{PuzzleID: "wedding-mini-v1"})
	require.NoError(t, err)
	assert.Equal(t, 3, total)
	require.Len(t, entries, 3)
	assert.Equal(t, "Alice", entries[0].DisplayName)
	assert.Equal(t, "Bob", entries[1].DisplayName)
	assert.Equal(t, "Carol", entries[2].DisplayName)
	assert.Equal(t, models.GameDifficultyHard, entries[0].Difficulty)
	assert.EqualValues(t, 30000, entries[0].ElapsedMS)
	assert.False(t, entries[0].CompletedAt.IsZero())
}

func TestLeaderboard_BreaksElapsedTiesByEarlierCompletion(t *testing.T) {
	svc, _, db := newServices(t)

	first := completeSessionT(t, svc, models.GameDifficultyEasy, 30000)
	second := completeSessionT(t, svc, models.GameDifficultyEasy, 30000)
	// Force a deterministic gap: the first completion is strictly earlier.
	_, err := db.NewUpdate().Model((*models.GameSession)(nil)).
		Set("completed_at = completed_at - INTERVAL '1 minute'").
		Where("id = ?", first.ID).Exec(ctx())
	require.NoError(t, err)
	for name, id := range map[string]string{"First": first.ID, "Second": second.ID} {
		_, err := svc.PostToLeaderboard(ctx(), id, games.PostLeaderboardPayload{DisplayName: name}, "")
		require.NoError(t, err)
	}

	entries, _, err := svc.Leaderboard(ctx(), games.LeaderboardQuery{PuzzleID: "wedding-mini-v1"})
	require.NoError(t, err)
	require.Len(t, entries, 2)
	assert.Equal(t, "First", entries[0].DisplayName)
	assert.Equal(t, "Second", entries[1].DisplayName)
}

func TestLeaderboard_CapsItemsButCountsEveryEntry(t *testing.T) {
	svc, _, db := newServices(t)

	// Bulk-insert 105 published solves directly; driving each through the API
	// surface would dominate the test's runtime.
	now := time.Now()
	rows := make([]*models.GameSession, 0, 105)
	for i := 0; i < 105; i++ {
		rows = append(rows, &models.GameSession{
			ID:          "00000000-0000-4000-8000-" + fmtSerial(i),
			PuzzleID:    "wedding-mini-v1",
			IPAddress:   "203.0.113.7",
			Difficulty:  models.GameDifficultyEasy,
			ElapsedMS:   int64(1000 + i),
			CompletedAt: pointerutil.Time(now),
			DisplayName: pointerutil.String("Solver"),
			CreatedAt:   now,
			UpdatedAt:   now,
		})
	}
	_, err := db.NewInsert().Model(&rows).Exec(ctx())
	require.NoError(t, err)

	entries, total, err := svc.Leaderboard(ctx(), games.LeaderboardQuery{PuzzleID: "wedding-mini-v1"})
	require.NoError(t, err)
	assert.Equal(t, 105, total, "total counts past the cap")
	require.Len(t, entries, 100, "items are capped at the top 100")
	assert.EqualValues(t, 1000, entries[0].ElapsedMS, "the cap keeps the fastest entries")
	assert.EqualValues(t, 1099, entries[99].ElapsedMS)
}

func TestLeaderboard_EmptyBoardSerializesAsEmptyList(t *testing.T) {
	svc, _, _ := newServices(t)

	entries, total, err := svc.Leaderboard(ctx(), games.LeaderboardQuery{PuzzleID: "wedding-mini-v1"})
	require.NoError(t, err)
	assert.Equal(t, 0, total)
	assert.NotNil(t, entries, "items must serialize as [], never null")
	assert.Empty(t, entries)
}

func TestSessions_AbandonedSolvesAreObservable(t *testing.T) {
	svc, _, db := newServices(t)

	abandoned := startSessionT(t, svc, models.GameDifficultyMedium)
	_, err := update(svc, abandoned.ID, 7000, nil, false)
	require.NoError(t, err)
	finished := completeSessionT(t, svc, models.GameDifficultyMedium, 9000)

	var startedNotCompleted []string
	err = db.NewSelect().Model((*models.GameSession)(nil)).
		Column("id").
		Where("completed_at IS NULL").
		Scan(ctx(), &startedNotCompleted)
	require.NoError(t, err)
	assert.Equal(t, []string{abandoned.ID}, startedNotCompleted)
	require.NotNil(t, sessionRow(t, db, finished.ID).CompletedAt)
}

// fmtSerial renders i as a zero-padded 12-character hex string, the last
// segment of a synthetic UUID.
func fmtSerial(i int) string {
	const hexDigits = "0123456789abcdef"
	out := make([]byte, 12)
	for pos := 11; pos >= 0; pos-- {
		out[pos] = hexDigits[i%16]
		i /= 16
	}
	return string(out)
}
