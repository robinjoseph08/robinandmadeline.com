package games_test

import (
	"testing"

	"github.com/robinjoseph08/golib/pointerutil"
	"github.com/robinjoseph08/robinandmadeline.com/pkg/errcodes"
	"github.com/robinjoseph08/robinandmadeline.com/pkg/games"
	"github.com/robinjoseph08/robinandmadeline.com/pkg/models"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestListSessions_NewestFirst(t *testing.T) {
	svc, _, db := newServices(t)

	// Three sessions created in order; the list must come back newest first
	// (created_at DESC). Force a deterministic gap so ordering is unambiguous
	// rather than relying on sub-microsecond insert timing.
	first := startSessionT(t, svc, models.GameDifficultyEasy)
	second := startSessionT(t, svc, models.GameDifficultyEasy)
	third := startSessionT(t, svc, models.GameDifficultyEasy)
	_, err := db.NewUpdate().Model((*models.GameSession)(nil)).
		Set("created_at = created_at - INTERVAL '2 minutes'").
		Where("id = ?", first.ID).Exec(ctx())
	require.NoError(t, err)
	_, err = db.NewUpdate().Model((*models.GameSession)(nil)).
		Set("created_at = created_at - INTERVAL '1 minute'").
		Where("id = ?", second.ID).Exec(ctx())
	require.NoError(t, err)

	items, total, err := svc.ListSessions(ctx())
	require.NoError(t, err)
	assert.Equal(t, 3, total)
	require.Len(t, items, 3)
	assert.Equal(t, third.ID, items[0].ID, "the most recently created solve sorts first")
	assert.Equal(t, second.ID, items[1].ID)
	assert.Equal(t, first.ID, items[2].ID)
}

func TestListSessions_IncludesEveryStateAndExposesClientDetails(t *testing.T) {
	svc, _, _ := newServices(t)

	// One of each state the admin must see: an in-progress (no completed_at)
	// solve, a completed-but-never-posted solve (on_leaderboard false), and a
	// posted solve. All three must appear, with the captured client details
	// surfaced.
	inProgress := startSessionT(t, svc, models.GameDifficultyMedium)
	completedUnposted := completeSessionT(t, svc, models.GameDifficultyMedium, 42000)
	posted := postSessionT(t, svc, "Alice", models.GameDifficultyEasy, 30000)

	items, total, err := svc.ListSessions(ctx())
	require.NoError(t, err)
	assert.Equal(t, 3, total)
	require.Len(t, items, 3)

	byID := make(map[string]games.AdminGameSessionResponse, len(items))
	for _, it := range items {
		byID[it.ID] = it
		// startSessionT seeds both captured client fields.
		assert.Equal(t, "203.0.113.7", it.IPAddress, "the admin view exposes ip_address")
		assert.Equal(t, "games-service-test", it.UserAgent, "the admin view exposes user_agent")
	}

	// The in-progress solve: no completed_at, not on the board, no name.
	ip := byID[inProgress.ID]
	assert.Nil(t, ip.CompletedAt, "an in-progress solve has no completed_at")
	assert.False(t, ip.OnLeaderboard)
	assert.Nil(t, ip.DisplayName)

	// The completed-but-unposted solve: completed_at set, but opted out.
	cu := byID[completedUnposted.ID]
	require.NotNil(t, cu.CompletedAt, "a completed solve carries its completion time")
	assert.False(t, cu.OnLeaderboard, "a completed-but-unposted solve stays off the board")
	assert.Nil(t, cu.DisplayName, "no name is stored until the solver opts in")

	// The posted solve: on the board with its name.
	p := byID[posted.ID]
	require.NotNil(t, p.CompletedAt)
	assert.True(t, p.OnLeaderboard)
	require.NotNil(t, p.DisplayName)
	assert.Equal(t, "Alice", *p.DisplayName)
}

func TestListSessions_PartyNameForAffiliatedAndNullForAnonymous(t *testing.T) {
	svc, partySvc, db := newServices(t)

	// An affiliated solve (a signed-in guest's token rode it) carries the
	// party's id and name; an anonymous solve carries neither.
	p := createPartyT(t, partySvc, "The Smiths")
	affiliated, err := svc.CreateSession(ctx(), games.CreateGameSessionInput{
		Payload: games.CreateGameSessionPayload{
			PuzzleID:   "wedding-mini-v1",
			Difficulty: models.GameDifficultyEasy,
		},
		PartyID:   p.ID,
		IPAddress: "203.0.113.7",
		UserAgent: "games-service-test",
	})
	require.NoError(t, err)
	require.NotNil(t, sessionRow(t, db, affiliated.ID).PartyID, "fixture precondition: the solve is affiliated")

	anonymous := startSessionT(t, svc, models.GameDifficultyEasy)

	items, _, err := svc.ListSessions(ctx())
	require.NoError(t, err)
	byID := make(map[string]games.AdminGameSessionResponse, len(items))
	for _, it := range items {
		byID[it.ID] = it
	}

	aff := byID[affiliated.ID]
	require.NotNil(t, aff.PartyID)
	assert.Equal(t, p.ID, *aff.PartyID)
	require.NotNil(t, aff.PartyName, "an affiliated solve carries its party's name")
	assert.Equal(t, "The Smiths", *aff.PartyName)

	anon := byID[anonymous.ID]
	assert.Nil(t, anon.PartyID, "an anonymous solve has no party id")
	assert.Nil(t, anon.PartyName, "an anonymous solve has no party name")
}

func TestListSessions_EmptySerializesAsEmptyList(t *testing.T) {
	svc, _, _ := newServices(t)

	items, total, err := svc.ListSessions(ctx())
	require.NoError(t, err)
	assert.Equal(t, 0, total)
	assert.NotNil(t, items, "items must serialize as [], never null")
	assert.Empty(t, items)
}

func TestHideSession_RetainsTheSolveAndRemovesItFromTheBoard(t *testing.T) {
	svc, _, db := newServices(t)
	session := postSessionT(t, svc, "Alice", models.GameDifficultyEasy, 30000)

	require.NoError(t, svc.HideSession(ctx(), session.ID))

	row := sessionRow(t, db, session.ID)
	assert.False(t, row.OnLeaderboard)
	require.NotNil(t, row.HiddenAt)
	require.NotNil(t, row.DisplayName)
	assert.Equal(t, "Alice", *row.DisplayName)
	assert.EqualValues(t, 30000, row.ElapsedMS)
	require.NotNil(t, row.CompletedAt)
}

func TestHideSession_LeavesAnUnpostedSolveUnmoderated(t *testing.T) {
	svc, _, db := newServices(t)
	session := completeSessionT(t, svc, models.GameDifficultyEasy, 30000)

	require.NoError(t, svc.HideSession(ctx(), session.ID))

	row := sessionRow(t, db, session.ID)
	assert.False(t, row.OnLeaderboard)
	assert.Nil(t, row.HiddenAt)
	assert.Nil(t, row.DisplayName)
}

func TestHideSession_UnknownSessionIs404(t *testing.T) {
	svc, _, _ := newServices(t)

	err := svc.HideSession(ctx(), "00000000-0000-0000-0000-000000000000")
	assertErrCode(t, err, errcodes.CodeNotFound)
}

func TestUnhideSession_RestoresHiddenSolveToTheBoard(t *testing.T) {
	svc, _, db := newServices(t)
	session := postSessionT(t, svc, "Alice", models.GameDifficultyEasy, 30000)
	require.NoError(t, svc.HideSession(ctx(), session.ID))

	require.NoError(t, svc.UnhideSession(ctx(), session.ID))

	row := sessionRow(t, db, session.ID)
	assert.True(t, row.OnLeaderboard)
	assert.Nil(t, row.HiddenAt)
	require.NotNil(t, row.DisplayName)
	assert.Equal(t, "Alice", *row.DisplayName)
	assert.EqualValues(t, 30000, row.ElapsedMS)

	entries, total, viewer, err := svc.Leaderboard(ctx(), games.LeaderboardQuery{
		PuzzleID:   "wedding-mini-v1",
		Difficulty: pointerutil.String(models.GameDifficultyEasy),
	})
	require.NoError(t, err)
	assert.Equal(t, 1, total)
	require.Len(t, entries, 1)
	assert.Equal(t, "Alice", entries[0].DisplayName)
	assert.Nil(t, viewer)
}

func TestUnhideSession_LeavesUnpostedSolveOffTheBoard(t *testing.T) {
	svc, _, db := newServices(t)
	session := completeSessionT(t, svc, models.GameDifficultyEasy, 30000)

	require.NoError(t, svc.UnhideSession(ctx(), session.ID))

	row := sessionRow(t, db, session.ID)
	assert.False(t, row.OnLeaderboard)
	assert.Nil(t, row.HiddenAt)
	assert.Nil(t, row.DisplayName)
}

func TestUnhideSession_UnknownSessionIs404(t *testing.T) {
	svc, _, _ := newServices(t)

	err := svc.UnhideSession(ctx(), "00000000-0000-0000-0000-000000000000")
	assertErrCode(t, err, errcodes.CodeNotFound)
}

func TestRenameSession_ChangesOnlyTheName(t *testing.T) {
	svc, _, db := newServices(t)
	session := postSessionT(t, svc, "Alice", models.GameDifficultyEasy, 30000)
	before := sessionRow(t, db, session.ID)

	require.NoError(t, svc.RenameSession(ctx(), session.ID, games.RenameGameSessionPayload{DisplayName: "Alicia"}))

	row := sessionRow(t, db, session.ID)
	require.NotNil(t, row.DisplayName)
	assert.Equal(t, "Alicia", *row.DisplayName)
	assert.True(t, row.OnLeaderboard)
	assert.Nil(t, row.HiddenAt)
	assert.EqualValues(t, 30000, row.ElapsedMS)
	assert.Equal(t, before.CompletedAt, row.CompletedAt)
}

func TestRenameSession_KeepsAHiddenSolveHidden(t *testing.T) {
	svc, _, db := newServices(t)
	session := postSessionT(t, svc, "Alice", models.GameDifficultyEasy, 30000)
	require.NoError(t, svc.HideSession(ctx(), session.ID))

	require.NoError(t, svc.RenameSession(ctx(), session.ID, games.RenameGameSessionPayload{DisplayName: "Alicia"}))

	row := sessionRow(t, db, session.ID)
	assert.Equal(t, "Alicia", *row.DisplayName)
	assert.False(t, row.OnLeaderboard)
	require.NotNil(t, row.HiddenAt)
}

func TestRenameSession_UnpostedSolveIs422(t *testing.T) {
	svc, _, db := newServices(t)
	session := completeSessionT(t, svc, models.GameDifficultyEasy, 30000)

	err := svc.RenameSession(ctx(), session.ID, games.RenameGameSessionPayload{DisplayName: "Alice"})
	assertErrCode(t, err, errcodes.CodeValidationError)

	row := sessionRow(t, db, session.ID)
	assert.Nil(t, row.DisplayName, "the admin cannot publish a solve on the solver's behalf")
	assert.False(t, row.OnLeaderboard)
}

func TestRenameSession_UnknownSessionIs404(t *testing.T) {
	svc, _, _ := newServices(t)

	err := svc.RenameSession(ctx(), "00000000-0000-0000-0000-000000000000", games.RenameGameSessionPayload{DisplayName: "Alice"})
	assertErrCode(t, err, errcodes.CodeNotFound)
}

func TestSetSessionParty_SetsReplacesAndClears(t *testing.T) {
	svc, partySvc, db := newServices(t)
	smiths := createPartyT(t, partySvc, "The Smiths")
	joneses := createPartyT(t, partySvc, "The Joneses")
	session := postSessionT(t, svc, "Alice", models.GameDifficultyEasy, 30000)

	require.NoError(t, svc.SetSessionParty(ctx(), session.ID, games.SetGameSessionPartyPayload{PartyID: pointerutil.String(smiths.ID)}))
	row := sessionRow(t, db, session.ID)
	require.NotNil(t, row.PartyID)
	assert.Equal(t, smiths.ID, *row.PartyID)

	// Unlike the opportunistic attach, the admin can overwrite an affiliation.
	require.NoError(t, svc.SetSessionParty(ctx(), session.ID, games.SetGameSessionPartyPayload{PartyID: pointerutil.String(joneses.ID)}))
	row = sessionRow(t, db, session.ID)
	require.NotNil(t, row.PartyID)
	assert.Equal(t, joneses.ID, *row.PartyID)

	// Only the affiliation changes.
	assert.Equal(t, "Alice", *row.DisplayName)
	assert.True(t, row.OnLeaderboard)
	assert.EqualValues(t, 30000, row.ElapsedMS)

	require.NoError(t, svc.SetSessionParty(ctx(), session.ID, games.SetGameSessionPartyPayload{}))
	assert.Nil(t, sessionRow(t, db, session.ID).PartyID)
}

func TestSetSessionParty_GuestSignInDoesNotOverrideIt(t *testing.T) {
	svc, partySvc, db := newServices(t)
	smiths := createPartyT(t, partySvc, "The Smiths")
	joneses := createPartyT(t, partySvc, "The Joneses")
	session := postSessionT(t, svc, "Alice", models.GameDifficultyEasy, 30000)
	require.NoError(t, svc.SetSessionParty(ctx(), session.ID, games.SetGameSessionPartyPayload{PartyID: pointerutil.String(smiths.ID)}))

	_, err := svc.PostToLeaderboard(ctx(), session.ID, games.PostLeaderboardPayload{DisplayName: "Alicia"}, joneses.ID)
	require.NoError(t, err)

	row := sessionRow(t, db, session.ID)
	require.NotNil(t, row.PartyID)
	assert.Equal(t, smiths.ID, *row.PartyID)
}

func TestSetSessionParty_WorksOnAnUnpostedSolve(t *testing.T) {
	svc, partySvc, db := newServices(t)
	smiths := createPartyT(t, partySvc, "The Smiths")
	session := completeSessionT(t, svc, models.GameDifficultyEasy, 30000)

	require.NoError(t, svc.SetSessionParty(ctx(), session.ID, games.SetGameSessionPartyPayload{PartyID: pointerutil.String(smiths.ID)}))

	row := sessionRow(t, db, session.ID)
	require.NotNil(t, row.PartyID)
	assert.Equal(t, smiths.ID, *row.PartyID)
	assert.False(t, row.OnLeaderboard, "affiliating never publishes")
	assert.Nil(t, row.DisplayName)
}

func TestSetSessionParty_UnknownPartyIs422(t *testing.T) {
	svc, _, db := newServices(t)
	session := postSessionT(t, svc, "Alice", models.GameDifficultyEasy, 30000)

	err := svc.SetSessionParty(ctx(), session.ID, games.SetGameSessionPartyPayload{PartyID: pointerutil.String("00000000-0000-0000-0000-000000000000")})
	assertErrCode(t, err, errcodes.CodeValidationError)
	assert.Nil(t, sessionRow(t, db, session.ID).PartyID)
}

func TestSetSessionParty_UnknownSessionIs404(t *testing.T) {
	svc, _, _ := newServices(t)

	err := svc.SetSessionParty(ctx(), "00000000-0000-0000-0000-000000000000", games.SetGameSessionPartyPayload{})
	assertErrCode(t, err, errcodes.CodeNotFound)
}

func TestListSessions_DescribesTheUserAgent(t *testing.T) {
	svc, _, _ := newServices(t)

	session, err := svc.CreateSession(ctx(), games.CreateGameSessionInput{
		Payload: games.CreateGameSessionPayload{
			PuzzleID:   "wedding-mini-v1",
			Difficulty: models.GameDifficultyEasy,
		},
		IPAddress: "203.0.113.7",
		UserAgent: "Mozilla/5.0 (iPhone; CPU iPhone OS 18_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.1 Mobile/15E148 Safari/604.1",
	})
	require.NoError(t, err)

	items, _, err := svc.ListSessions(ctx())
	require.NoError(t, err)
	require.Len(t, items, 1)
	assert.Equal(t, session.ID, items[0].ID)
	assert.Equal(t, "Safari 18", items[0].ClientBrowser)
	assert.Equal(t, "iOS 18.1", items[0].ClientOS)
	assert.Equal(t, "iPhone", items[0].ClientDevice)
}
