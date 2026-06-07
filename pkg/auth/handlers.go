package auth

import (
	"errors"
	"net/http"

	"github.com/labstack/echo/v4"
	"github.com/robinjoseph08/robinandmadeline.com/pkg/errcodes"
)

// handler holds the dependencies for the auth HTTP handlers.
type handler struct {
	service *Service
}

// adminLoginRequest is the body of POST /api/auth/admin/login.
type adminLoginRequest struct {
	Username string `json:"username"`
	Password string `json:"password"`
}

// loginResponse is returned with a freshly minted JWT on successful login.
type loginResponse struct {
	Token string `json:"token"`
}

// adminLogin validates the admin credential and returns a signed admin JWT.
// It returns 400 for a malformed body and 401 for invalid credentials.
func (h *handler) adminLogin(c echo.Context) error {
	var req adminLoginRequest
	if err := c.Bind(&req); err != nil {
		return errcodes.BadRequest("invalid request body")
	}

	if err := h.service.AuthenticateAdmin(req.Username, req.Password); err != nil {
		if errors.Is(err, ErrInvalidCredentials) {
			return errcodes.Unauthorized("invalid username or password")
		}
		return err
	}

	token, err := h.service.GenerateAdminToken()
	if err != nil {
		return err
	}

	return c.JSON(http.StatusOK, loginResponse{Token: token})
}
