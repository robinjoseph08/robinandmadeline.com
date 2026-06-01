package auth

import (
	"net/http"
	"strings"

	"github.com/labstack/echo/v4"
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
			return echo.NewHTTPError(http.StatusUnauthorized, "admin access required")
		}
		c.Set(ContextKeyClaims, claims)
		return next(c)
	}
}

// authenticate extracts the bearer token from the Authorization header and
// validates it, returning an unauthorized HTTP error on any failure.
func (m *Middleware) authenticate(c echo.Context) (*JWTClaims, error) {
	token, err := tokenFromHeader(c.Request().Header.Get(echo.HeaderAuthorization))
	if err != nil {
		return nil, echo.NewHTTPError(http.StatusUnauthorized, "authentication required")
	}

	claims, err := m.service.ValidateToken(token)
	if err != nil {
		return nil, echo.NewHTTPError(http.StatusUnauthorized, "invalid or expired token")
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
