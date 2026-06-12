package games

import (
	"time"

	"github.com/robinjoseph08/robinandmadeline.com/pkg/models"
)

// This file is the single home for the package's request and response types:
// handlers never use anonymous structs, echo.Map, or map[string]any. Each
// payload doubles as the service input.

// CreateGameSessionPayload is the body of POST /api/games/sessions, sent when
// a guest starts a puzzle. Difficulty is the level they start on; the session
// keeps the easiest level seen as they switch (see models.EasierDifficulty).
// PuzzleID is the client-side puzzle slug (e.g. "wedding-mini-v1"); the
// puzzles live in frontend code, so the server accepts any non-blank slug
// rather than checking a list it does not have.
type CreateGameSessionPayload struct {
	PuzzleID   string `json:"puzzle_id" mod:"trim" validate:"required,max=100"`
	Difficulty string `json:"difficulty" validate:"required,oneof=easy medium hard" tstype:"models.GameDifficulty"`
}

// UpdateGameSessionPayload is the body of PATCH /api/games/sessions/:id, the
// periodic progress report while solving. ElapsedMS is the total accumulated
// active-solving milliseconds (not a delta) and may only grow; a value lower
// than what the session already holds is a 422. Difficulty, when present, is
// the level currently selected; the server keeps the easiest level seen.
// Completed marks the solve finished, setting completed_at server-side; once
// set, further updates are rejected except an exact no-op resend (so a client
// retry of the final report is safe). ElapsedMS is a pointer so an omitted
// value is a 422 instead of binding to a 0 that would read as a decrease; its
// max (24 hours of accumulated active solving) is the sanity ceiling, beyond
// any plausible legitimate solve.
type UpdateGameSessionPayload struct {
	ElapsedMS  *int    `json:"elapsed_ms" validate:"required,min=0,max=86400000"`
	Difficulty *string `json:"difficulty" validate:"omitempty,oneof=easy medium hard" tstype:"models.GameDifficulty"`
	Completed  bool    `json:"completed"`
}

// PostLeaderboardPayload is the body of POST /api/games/sessions/:id/leaderboard,
// the explicit opt-in that publishes a completed solve. DisplayName is what the
// leaderboard shows: a signed-in guest's client confirms or prefills it from
// their guest record, an anonymous guest types one, and either way it is stored
// on the session so an anonymous entry can be retroactively affiliated with a
// party later. Posting an uncompleted session is a 422; re-posting the same
// name is an idempotent success, a different name a 409.
type PostLeaderboardPayload struct {
	DisplayName string `json:"display_name" mod:"trim" validate:"required,min=1,max=50"`
}

// LeaderboardQuery is the query string of GET /api/games/leaderboard,
// identifying which puzzle's leaderboard to read. Difficulty optionally
// narrows the board to sessions whose recorded (easiest-used) difficulty
// matches, so the client can render one board per difficulty tab; it is a
// pointer so "absent" (every difficulty, the original single board) is
// distinguishable, and an unknown value is a 422 from the binder, never
// silently ignored.
type LeaderboardQuery struct {
	PuzzleID   string  `query:"puzzle_id" json:"puzzle_id" mod:"trim" validate:"required,max=100"`
	Difficulty *string `query:"difficulty" json:"difficulty" validate:"omitempty,oneof=easy medium hard" tstype:"models.GameDifficulty"`
}

// GameSessionResponse is the body every session endpoint returns: the solver's
// own session. The model's ip_address is json:"-" (a server-side abuse-tracing
// concern), so it never appears here or in the generated TypeScript.
type GameSessionResponse struct {
	models.GameSession `tstype:",extends"`
}

// LeaderboardEntry is one published solve on a puzzle's leaderboard. It
// deliberately does NOT carry the session id: the id is the session's bearer
// token, so exposing other solvers' ids would let anyone rewrite their rows.
// Difficulty is the easiest level used at any point during the solve.
type LeaderboardEntry struct {
	DisplayName string    `json:"display_name"`
	Difficulty  string    `json:"difficulty" tstype:"models.GameDifficulty"`
	ElapsedMS   int64     `json:"elapsed_ms"`
	CompletedAt time.Time `json:"completed_at"`
}

// ListLeaderboardEntriesResponse is the uniform list envelope for a puzzle's
// leaderboard: the fastest entries first, capped at leaderboardLimit items.
// Total counts every published entry the query matched (the whole puzzle, or
// just one difficulty when filtered), beyond the cap, so a client can say
// "top 100 of 250" without a second request.
type ListLeaderboardEntriesResponse struct {
	Items []LeaderboardEntry `json:"items"`
	Total int                `json:"total"`
}
