package models

import (
	"time"

	"github.com/uptrace/bun"
)

// Crossword difficulty values, stored as TEXT guarded by a CHECK constraint
// (like parties.side/relation). They are ordered: easy < medium < hard. A solve
// session records the EASIEST difficulty used at any point (a guest who peeks
// at the easy clues even briefly has had easy's help for the whole solve), so
// switching difficulty mid-solve can only ever lower the recorded value. The
// //tygo:emit line generates the matching TypeScript union.
const (
	//tygo:emit export type GameDifficulty = typeof GameDifficultyEasy | typeof GameDifficultyMedium | typeof GameDifficultyHard;
	GameDifficultyEasy   = "easy"
	GameDifficultyMedium = "medium"
	GameDifficultyHard   = "hard"
)

// difficultyRank orders the difficulties for EasierDifficulty: lower rank is
// easier.
var difficultyRank = map[string]int{
	GameDifficultyEasy:   0,
	GameDifficultyMedium: 1,
	GameDifficultyHard:   2,
}

// EasierDifficulty returns the easier of two difficulty values (easy < medium
// < hard). Both arguments must be members of the GameDifficulty set, which the
// binder's oneof validation and the schema CHECK guarantee on every path that
// reaches it.
func EasierDifficulty(a, b string) string {
	if difficultyRank[b] < difficultyRank[a] {
		return b
	}
	return a
}

// GameSession is one tracked crossword solve, created when a guest starts a
// puzzle and updated as they solve. Every solve is tracked here regardless of
// whether the guest chose to display a timer in the UI, but the elapsed time
// itself is client-reported (see ElapsedMS below and the pkg/games doc).
//
// The id is a UUID that doubles as the session's bearer token: the crossword
// requires no authentication, so holding the id is what authorizes updates to
// it. PartyID is captured opportunistically when a request carries a valid
// guest token and stays NULL otherwise. Difficulty is the easiest level used
// at any point during the solve (see EasierDifficulty). ElapsedMS is the
// accumulated active-solving milliseconds the client reports; the service only
// lets it grow. CompletedAt is NULL for a started-but-never-finished solve and
// set server-side exactly once. OnLeaderboard is the explicit leaderboard
// opt-in and current visibility: every completed solve is stored regardless,
// and this flag says whether the solve is currently public (the solver can opt
// in, and an admin can later clear it without deleting the time). It replaces
// the old implicit "display_name is set" rule, so an admin view can distinguish
// unposted and hidden solves. DisplayName is the name shown on the leaderboard, set when
// opting in and stored even for signed-in parties so an anonymous entry can be
// retroactively affiliated with a party later. An on-board row always carries a
// DisplayName (a DB CHECK enforces "on_leaderboard implies display_name is set",
// since public leaderboard reads filter on the flag and then read the name),
// but an off-board row may have either: a retained name after an admin hides a
// previously posted solve, or neither (in-progress or completed-but-unposted).
// HiddenAt is the first-class moderation marker. It is set when an admin hides
// a posted solve and stays NULL otherwise; a DB CHECK prevents a hidden row
// from being on the public leaderboard, including under an older app binary.
//
// IPAddress and UserAgent are server-side abuse-tracing concerns. They are
// excluded from JSON and the generated TypeScript on purpose.
type GameSession struct {
	bun.BaseModel `bun:"table:game_sessions,alias:gs" tstype:"-"`

	ID         string  `bun:"id,pk" json:"id"`
	PuzzleID   string  `bun:"puzzle_id" json:"puzzle_id"`
	PartyID    *string `bun:"party_id" json:"party_id"`
	IPAddress  string  `bun:"ip_address" json:"-"`
	UserAgent  string  `bun:"user_agent" json:"-" tstype:"-"`
	Difficulty string  `bun:"difficulty" json:"difficulty" tstype:"GameDifficulty"`
	ElapsedMS  int64   `bun:"elapsed_ms" json:"elapsed_ms"`

	CompletedAt   *time.Time `bun:"completed_at" json:"completed_at"`
	OnLeaderboard bool       `bun:"on_leaderboard" json:"on_leaderboard"`
	DisplayName   *string    `bun:"display_name" json:"display_name"`
	HiddenAt      *time.Time `bun:"hidden_at" json:"-" tstype:"-"`

	CreatedAt time.Time `bun:"created_at,nullzero" json:"created_at"`
	UpdatedAt time.Time `bun:"updated_at,nullzero" json:"updated_at"`
}
