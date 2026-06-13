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
// the request that opts a completed solve onto the leaderboard (it sets the
// session's on_leaderboard flag). DisplayName is what the leaderboard shows: a
// signed-in guest's client confirms or prefills it from their guest record, an
// anonymous guest types one, and either way it is stored on the session so an
// anonymous entry can be retroactively affiliated with a party later. Posting an
// uncompleted session is a 422; re-posting the same name is an idempotent
// success, a different name a 409.
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
//
// SessionID optionally identifies the requesting solver's own session so the
// response can carry that solver's rank (see LeaderboardViewer); absent means
// no viewer. It is the version-agnostic uuid validator, not uuid4, because
// session ids are UUIDv7 and uuid4 would 422 every real id. A malformed value
// is a 422 from the binder (consistent with how Difficulty is handled), while
// a well-formed but unknown id is simply no viewer, not an error.
type LeaderboardQuery struct {
	PuzzleID   string  `query:"puzzle_id" json:"puzzle_id" mod:"trim" validate:"required,max=100"`
	Difficulty *string `query:"difficulty" json:"difficulty" validate:"omitempty,oneof=easy medium hard" tstype:"models.GameDifficulty"`
	SessionID  *string `query:"session_id" json:"session_id" validate:"omitempty,uuid"`
}

// GameSessionResponse is the body every session endpoint returns: the solver's
// own session. The model's ip_address is json:"-" (a server-side abuse-tracing
// concern), so it never appears here or in the generated TypeScript.
type GameSessionResponse struct {
	models.GameSession `tstype:",extends"`
}

// LeaderboardEntry is one opted-in solve on a puzzle's leaderboard (a completed
// session whose solver set on_leaderboard). It deliberately does NOT carry the
// session id: the id is the session's bearer token, so exposing other solvers'
// ids would let anyone rewrite their rows. Difficulty is the easiest level used
// at any point during the solve.
type LeaderboardEntry struct {
	DisplayName string    `json:"display_name"`
	Difficulty  string    `json:"difficulty" tstype:"models.GameDifficulty"`
	ElapsedMS   int64     `json:"elapsed_ms"`
	CompletedAt time.Time `json:"completed_at"`
}

// LeaderboardViewer is the requesting solver's own ranked entry, returned
// when the leaderboard read carries that solver's session_id and the
// session is an opted-in, completed solve on the board being read (the same
// puzzle and, when filtered, the same difficulty). Rank is its 1-based
// position in the full ordering, which may exceed the returned items when
// the solver is slower than the displayed entries (the cap is a defensive
// ceiling well above any real board, so this overflow only arises under
// abuse). It lets the client always show the solver their own row with the
// correct number, even off the visible list. It is omitted (null) when no
// eligible session_id was given.
type LeaderboardViewer struct {
	Rank  int              `json:"rank"`
	Entry LeaderboardEntry `json:"entry"`
}

// ListLeaderboardEntriesResponse is the uniform list envelope for a puzzle's
// leaderboard: the fastest entries first, capped at leaderboardLimit items.
// Total counts every opted-in entry the query matched (the whole puzzle, or
// just one difficulty when filtered), beyond the cap, so a client can say
// "showing N of M" without a second request. The cap is a defensive ceiling
// well above any real board, so at wedding scale Items holds every opted-in
// entry and Total equals len(Items). Viewer is an additive, nullable field:
// when the read carries an eligible session_id it carries that solver's own
// ranked entry (see LeaderboardViewer), so the client can always show the
// solver their own row with the correct rank, highlighting it when it is
// already in items and appending it when it falls off the visible list. Items
// and Total keep their original meaning regardless of Viewer.
type ListLeaderboardEntriesResponse struct {
	Items  []LeaderboardEntry `json:"items"`
	Total  int                `json:"total"`
	Viewer *LeaderboardViewer `json:"viewer"`
}
