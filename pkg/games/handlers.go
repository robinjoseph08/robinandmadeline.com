package games

import (
	"net"
	"net/http"
	"strings"

	"github.com/google/uuid"
	"github.com/labstack/echo/v4"
	"github.com/pkg/errors"
	"github.com/robinjoseph08/robinandmadeline.com/pkg/auth"
	"github.com/robinjoseph08/robinandmadeline.com/pkg/errcodes"
)

// flyClientIPHeader is the header Fly.io's proxy sets to the real client IP.
// The app runs behind that proxy in production (ADR 0001), so it is the most
// trustworthy source when present.
const flyClientIPHeader = "Fly-Client-IP"

// handler holds the dependencies for the games HTTP handlers. It is
// unexported; routes are wired via RegisterRoutes. Handlers return errcodes
// errors directly (and the *Error the service produces flows through), which
// the shared error handler renders.
type handler struct {
	service *Service
}

// pathID returns the :id route param when it parses as a UUID, or a 404
// otherwise. Session ids are UUIDs, so a malformed one can never name an
// existing row; without this check it would reach Postgres as a failing
// text-to-uuid cast and render a 500 instead of the 404 a missing row gets.
// The id is returned in canonical form so the query sees exactly what was
// parsed.
func pathID(c echo.Context) (string, error) {
	id, err := uuid.Parse(c.Param("id"))
	if err != nil {
		return "", errcodes.NotFound("session")
	}
	return id.String(), nil
}

// clientIP extracts the real client IP for abuse tracing. In production the
// app sits behind Fly.io's proxy, which sets Fly-Client-IP to the connecting
// client (a header an end client cannot forge through the proxy, unlike an
// appended X-Forwarded-For). Anywhere the app is reached without that proxy
// (local dev, a direct hit) the headers are client-controlled text, so every
// candidate must parse as an IP before it is stored; otherwise a client could
// persist arbitrary text as its "IP" and defeat the tracing. The precedence is
// the Fly header, then Echo's RealIP (X-Forwarded-For first, then X-Real-IP,
// then the socket's RemoteAddr), then the socket's RemoteAddr host directly
// (covering a garbage forwarded header), then "". Valid IPs are stored in
// net.ParseIP's canonical form. A server-wide Echo IPExtractor for Fly (which
// would also feed the login rate limiter, ADR 0006) is issue #15's scope; this
// stays a local concern until that lands.
func clientIP(c echo.Context) string {
	if ip := net.ParseIP(strings.TrimSpace(c.Request().Header.Get(flyClientIPHeader))); ip != nil {
		return ip.String()
	}
	if ip := net.ParseIP(strings.TrimSpace(c.RealIP())); ip != nil {
		return ip.String()
	}
	if host, _, err := net.SplitHostPort(c.Request().RemoteAddr); err == nil {
		if ip := net.ParseIP(host); ip != nil {
			return ip.String()
		}
	}
	return ""
}

// createSession handles POST /api/games/sessions: a guest starting a puzzle.
// It captures the puzzle, the starting difficulty, the client IP, and (behind
// OptionalGuest) the party when a valid guest token rode the request. The
// returned session's id is the bearer token for every later report.
func (h *handler) createSession(c echo.Context) error {
	var body CreateGameSessionPayload
	if err := c.Bind(&body); err != nil {
		// The custom binder already returns the right errcode (422/400); preserve it.
		return errors.WithStack(err)
	}

	session, err := h.service.CreateSession(c.Request().Context(), body, auth.GuestPartyID(c), clientIP(c))
	if err != nil {
		return err
	}
	return c.JSON(http.StatusCreated, GameSessionResponse{GameSession: *session})
}

// updateSession handles PATCH /api/games/sessions/:id: a progress report
// (accumulated elapsed time, optional difficulty switch, optional completion).
// Holding the id is the authorization; see the package comment.
func (h *handler) updateSession(c echo.Context) error {
	id, err := pathID(c)
	if err != nil {
		return err
	}
	var body UpdateGameSessionPayload
	if err := c.Bind(&body); err != nil {
		return errors.WithStack(err)
	}

	session, err := h.service.UpdateSession(c.Request().Context(), id, body, auth.GuestPartyID(c))
	if err != nil {
		return err
	}
	return c.JSON(http.StatusOK, GameSessionResponse{GameSession: *session})
}

// postToLeaderboard handles POST /api/games/sessions/:id/leaderboard: the
// opt-in that publishes a completed solve under a display name.
func (h *handler) postToLeaderboard(c echo.Context) error {
	id, err := pathID(c)
	if err != nil {
		return err
	}
	var body PostLeaderboardPayload
	if err := c.Bind(&body); err != nil {
		return errors.WithStack(err)
	}

	session, err := h.service.PostToLeaderboard(c.Request().Context(), id, body, auth.GuestPartyID(c))
	if err != nil {
		return err
	}
	return c.JSON(http.StatusOK, GameSessionResponse{GameSession: *session})
}

// getLeaderboard handles GET /api/games/leaderboard?puzzle_id=...: one
// puzzle's published entries, fastest first, capped (no pagination in v1).
// An optional difficulty parameter narrows the board to one difficulty, with
// the cap and total scoped to it; the binder validates the value, so an
// unknown difficulty is a 422 before the service runs.
func (h *handler) getLeaderboard(c echo.Context) error {
	var query LeaderboardQuery
	if err := c.Bind(&query); err != nil {
		return errors.WithStack(err)
	}

	entries, total, err := h.service.Leaderboard(c.Request().Context(), query)
	if err != nil {
		return err
	}
	return c.JSON(http.StatusOK, ListLeaderboardEntriesResponse{Items: entries, Total: total})
}
