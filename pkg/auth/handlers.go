package auth

import (
	stderrors "errors"
	"net/http"

	"github.com/labstack/echo/v4"
	"github.com/pkg/errors"
	"github.com/robinjoseph08/robinandmadeline.com/pkg/errcodes"
)

// handler holds the dependencies for the auth HTTP handlers.
type handler struct {
	service *Service
}

// adminLoginRequest is the body of POST /api/auth/admin/login. The custom binder
// validates both fields as required from these tags.
type adminLoginRequest struct {
	Username string `json:"username" validate:"required"`
	Password string `json:"password" validate:"required"`
}

// loginResponse is returned with a freshly minted JWT on successful login.
type loginResponse struct {
	Token string `json:"token"`
}

// adminLogin validates the admin credential and returns a signed admin JWT. The
// binder rejects a bad request first (422 for a missing field, 400 for a
// malformed body); this returns 401 for invalid credentials.
func (h *handler) adminLogin(c echo.Context) error {
	var req adminLoginRequest
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

	return c.JSON(http.StatusOK, loginResponse{Token: token})
}
