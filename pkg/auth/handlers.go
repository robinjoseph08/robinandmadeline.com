package auth

import (
	"context"
	"database/sql"
	stderrors "errors"
	"net/http"

	"github.com/labstack/echo/v4"
	"github.com/pkg/errors"
	"github.com/robinjoseph08/robinandmadeline.com/pkg/errcodes"
	"github.com/robinjoseph08/robinandmadeline.com/pkg/models"
	"github.com/uptrace/bun"
)

// handler holds the dependencies for the auth HTTP handlers. The db backs the
// guest login's party-by-RSVP-code lookup; the admin login is config-only and
// never touches it.
type handler struct {
	service *Service
	db      *bun.DB
}

// adminLogin validates the admin credential and returns a signed admin JWT. The
// binder rejects a bad request first (422 for a missing field, 400 for a
// malformed body); this returns 401 for invalid credentials.
func (h *handler) adminLogin(c echo.Context) error {
	var req AdminLoginPayload
	if err := c.Bind(&req); err != nil {
		// The custom binder already returns the right errcode (422/400); preserve it.
		return errors.WithStack(err)
	}

	if err := h.service.AuthenticateAdmin(req.Username, req.Password); err != nil {
		if stderrors.Is(err, ErrInvalidCredentials) {
			return errcodes.Unauthorized("Invalid username or password.")
		}
		return err
	}

	token, err := h.service.GenerateAdminToken()
	if err != nil {
		return err
	}

	return c.JSON(http.StatusOK, LoginResponse{Token: token})
}

// guestLogin authenticates a party by its RSVP code and returns a signed,
// long-lived guest JWT carrying the party id. An unknown code is a 401; the
// per-IP login rate limiter (ADR 0006) is what keeps the deliberately
// low-entropy codes (ADR 0003) safe to guess against.
func (h *handler) guestLogin(c echo.Context) error {
	var req GuestLoginPayload
	if err := c.Bind(&req); err != nil {
		// The custom binder already returns the right errcode (422/400); preserve it.
		return errors.WithStack(err)
	}

	partyID, err := h.partyIDForRSVPCode(c.Request().Context(), req.Code)
	if err != nil {
		return err
	}

	token, err := h.service.GenerateGuestToken(partyID)
	if err != nil {
		return err
	}

	return c.JSON(http.StatusOK, LoginResponse{Token: token})
}

// partyIDForRSVPCode resolves an RSVP code to its party. The binder has
// already uppercased the input; the comparison still folds the stored value so
// a manually seeded lowercase code keeps working. A code that matches no party
// is a 401 (never a 404: the response must not distinguish "no such code" from
// any other authentication failure).
func (h *handler) partyIDForRSVPCode(ctx context.Context, code string) (string, error) {
	var id string
	err := h.db.NewSelect().Model((*models.Party)(nil)).Column("id").
		Where("upper(rsvp_code) = ?", code).Limit(1).Scan(ctx, &id)
	if err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return "", errcodes.Unauthorized("Invalid RSVP code.")
		}
		return "", errors.Wrap(err, "look up party by rsvp code")
	}
	return id, nil
}
