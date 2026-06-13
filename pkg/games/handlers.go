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

// clientIP returns the real client IP for abuse tracing, resolved through the
// server-wide, Fly-aware IPExtractor configured in pkg/server and surfaced via
// c.RealIP(). Behind the production proxy that extractor reads Fly-Client-IP
// (then X-Forwarded-For from the trusted hop), so the value is the connecting
// client and not a header an end client can forge through the proxy; anywhere
// the server is hit directly (local dev, tests) it is the socket peer address
// and forwarded headers are ignored. The same resolution keys the login rate
// limiter (ADR 0006), so the captured IP and the rate-limited IP always agree.
// The result is validated with net.ParseIP before storage so an unparseable
// value (improbable from the extractor) is never persisted as garbage, and a
// valid IP is stored in canonical form.
func clientIP(c echo.Context) string {
	if ip := net.ParseIP(strings.TrimSpace(c.RealIP())); ip != nil {
		return ip.String()
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
// opt-in that sets on_leaderboard on a completed solve and stores its display
// name.
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
// puzzle's opted-in entries, fastest first, capped (no pagination in v1).
// An optional difficulty parameter narrows the board to one difficulty, with
// the cap and total scoped to it; the binder validates the value, so an
// unknown difficulty is a 422 before the service runs. An optional session_id
// asks for the requesting solver's own ranked row in the response's viewer; the
// binder validates it is a well-formed UUID, and the service returns no viewer
// (not an error) for an unknown or ineligible id.
func (h *handler) getLeaderboard(c echo.Context) error {
	var query LeaderboardQuery
	if err := c.Bind(&query); err != nil {
		return errors.WithStack(err)
	}

	entries, total, viewer, err := h.service.Leaderboard(c.Request().Context(), query)
	if err != nil {
		return err
	}
	return c.JSON(http.StatusOK, ListLeaderboardEntriesResponse{Items: entries, Total: total, Viewer: viewer})
}

// adminListSessions handles GET /api/admin/games/sessions: every solve session
// in the admin {items, total} envelope, newest first. Unlike the public
// leaderboard it includes in-progress and completed-but-unposted solves and
// exposes ip_address, so an admin can see and clean up every recorded time. The
// route is mounted on the admin group, so a valid admin token is required.
func (h *handler) adminListSessions(c echo.Context) error {
	items, total, err := h.service.ListSessions(c.Request().Context())
	if err != nil {
		return err
	}
	return c.JSON(http.StatusOK, ListAdminGameSessionsResponse{Items: items, Total: total})
}

// adminDeleteSession handles DELETE /api/admin/games/sessions/:id, returning
// 204 on success. A malformed id is a 404 before any query (pathID), and an
// unknown but well-formed id is a 404 from the delete. This hard-deletes the
// row so a bad-actor or junk solve can be removed without touching the database.
func (h *handler) adminDeleteSession(c echo.Context) error {
	id, err := pathID(c)
	if err != nil {
		return err
	}
	if err := h.service.DeleteSession(c.Request().Context(), id); err != nil {
		return err
	}
	return c.NoContent(http.StatusNoContent)
}
