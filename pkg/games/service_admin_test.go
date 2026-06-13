package games_test

import (
	"testing"

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

func TestListSessions_IncludesEveryStateAndExposesIP(t *testing.T) {
	svc, _, _ := newServices(t)

	// One of each state the admin must see: an in-progress (no completed_at)
	// solve, a completed-but-never-posted solve (on_leaderboard false), and a
	// posted solve. All three must appear, with ip_address surfaced.
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
		// Every session carries the captured IP (startSessionT seeds 203.0.113.7).
		assert.Equal(t, "203.0.113.7", it.IPAddress, "the admin view exposes ip_address")
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
	affiliated, err := svc.CreateSession(ctx(), games.CreateGameSessionPayload{
		PuzzleID:   "wedding-mini-v1",
		Difficulty: models.GameDifficultyEasy,
	}, p.ID, "203.0.113.7")
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

func TestDeleteSession_RemovesTheRow(t *testing.T) {
	svc, _, db := newServices(t)
	session := completeSessionT(t, svc, models.GameDifficultyEasy, 30000)

	require.NoError(t, svc.DeleteSession(ctx(), session.ID))

	exists, err := db.NewSelect().Model((*models.GameSession)(nil)).
		Where("id = ?", session.ID).Exists(ctx())
	require.NoError(t, err)
	assert.False(t, exists, "the session row is hard-deleted")
}

func TestDeleteSession_UnknownSessionIs404(t *testing.T) {
	svc, _, _ := newServices(t)

	err := svc.DeleteSession(ctx(), "00000000-0000-0000-0000-000000000000")
	assertErrCode(t, err, errcodes.CodeNotFound)
}
