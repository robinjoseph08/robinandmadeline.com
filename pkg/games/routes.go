package games

import (
	"github.com/labstack/echo/v4"
	"github.com/robinjoseph08/robinandmadeline.com/pkg/auth"
)

// RegisterRoutes mounts the games endpoints on the given group, which is
// expected to be the open /api group: the crossword requires no
// authentication. The session routes sit behind OptionalGuest so a valid
// guest token attaches the party to the session opportunistically (anonymous
// requests pass through, a presented-but-invalid token is a 401, see
// auth.OptionalGuest); beyond that, the session's UUID id is the bearer
// token, so holding it is what authorizes writes to it. The leaderboard read
// is fully public.
//
// Route shape (relative to the group, i.e. /api):
//
//	POST  /games/sessions                  start a solve (puzzle + starting difficulty)
//	PATCH /games/sessions/:id              report progress (elapsed, difficulty switch, completion)
//	POST  /games/sessions/:id/leaderboard  opt in to publish a completed solve
//	GET   /games/leaderboard?puzzle_id=    one puzzle's entries, fastest first, capped
//	                                       (&difficulty= narrows to one difficulty's board)
func RegisterRoutes(api *echo.Group, mw *auth.Middleware, service *Service) {
	h := &handler{service: service}

	g := api.Group("/games")
	g.POST("/sessions", h.createSession, mw.OptionalGuest)
	g.PATCH("/sessions/:id", h.updateSession, mw.OptionalGuest)
	g.POST("/sessions/:id/leaderboard", h.postToLeaderboard, mw.OptionalGuest)
	g.GET("/leaderboard", h.getLeaderboard)
}
