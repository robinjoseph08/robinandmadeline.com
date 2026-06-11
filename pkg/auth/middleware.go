package auth

import (
	"strings"

	"github.com/labstack/echo/v4"
	"github.com/robinjoseph08/robinandmadeline.com/pkg/errcodes"
)

// Context keys under which validated claims are stashed on the Echo context.
const (
	// ContextKeyClaims holds the validated *JWTClaims for the request.
	ContextKeyClaims = "auth_claims"
)

const bearerPrefix = "Bearer "

// Middleware guards routes using the auth Service.
type Middleware struct {
	service *Service
}

// NewMiddleware builds a Middleware backed by the given Service.
func NewMiddleware(service *Service) *Middleware {
	return &Middleware{service: service}
}

// RequireAdmin rejects any request that does not carry a valid, unexpired JWT
// with the admin role. On success it stores the claims on the context and calls
// the next handler.
func (m *Middleware) RequireAdmin(next echo.HandlerFunc) echo.HandlerFunc {
	return func(c echo.Context) error {
		claims, err := m.authenticate(c)
		if err != nil {
			return err
		}
		if claims.Role != RoleAdmin {
			return errcodes.Unauthorized("Admin access is required.")
		}
		c.Set(ContextKeyClaims, claims)
		return next(c)
	}
}

// RequireGuest rejects any request that does not carry a valid, unexpired JWT
// with the guest role and a party id. On success it stores the claims on the
// context (PartyIDFromContext reads them back) and calls the next handler.
func (m *Middleware) RequireGuest(next echo.HandlerFunc) echo.HandlerFunc {
	return func(c echo.Context) error {
		claims, err := m.authenticate(c)
		if err != nil {
			return err
		}
		if claims.Role != RoleGuest || claims.PartyID == "" {
			return errcodes.Unauthorized("Guest access is required.")
		}
		c.Set(ContextKeyClaims, claims)
		return next(c)
	}
}

// PartyIDFromContext returns the party id of the authenticated guest, stashed
// on the context by RequireGuest. Handlers behind RequireGuest can rely on it;
// a missing or party-less claim (a route mounted outside the middleware, a
// programming error) reads as unauthorized rather than panicking.
func PartyIDFromContext(c echo.Context) (string, error) {
	claims, ok := c.Get(ContextKeyClaims).(*JWTClaims)
	if !ok || claims.PartyID == "" {
		return "", errcodes.Unauthorized("Guest access is required.")
	}
	return claims.PartyID, nil
}

// authenticate extracts the bearer token from the Authorization header and
// validates it, returning an unauthorized HTTP error on any failure.
func (m *Middleware) authenticate(c echo.Context) (*JWTClaims, error) {
	token, err := tokenFromHeader(c.Request().Header.Get(echo.HeaderAuthorization))
	if err != nil {
		return nil, errcodes.Unauthorized("Authentication is required.")
	}

	claims, err := m.service.ValidateToken(token)
	if err != nil {
		return nil, errcodes.Unauthorized("Invalid or expired token.")
	}
	return claims, nil
}

// tokenFromHeader extracts a bearer token from an Authorization header value.
func tokenFromHeader(header string) (string, error) {
	if !strings.HasPrefix(header, bearerPrefix) {
		return "", echo.ErrUnauthorized
	}
	token := strings.TrimSpace(strings.TrimPrefix(header, bearerPrefix))
	if token == "" {
		return "", echo.ErrUnauthorized
	}
	return token, nil
}
