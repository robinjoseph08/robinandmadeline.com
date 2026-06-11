// Package auth provides JWT-based authentication for the admin and guest
// roles. Tokens carry a role claim; guest tokens additionally carry the
// party they authenticate. The admin credential is a single username and
// password, both sourced from configuration; guests authenticate with their
// party's RSVP code, defended by a shared per-IP login rate limiter
// (ADR 0006).
package auth

import (
	"crypto/subtle"
	"errors"
	"time"

	"github.com/golang-jwt/jwt/v5"
	"github.com/google/uuid"
)

// Role values carried in the JWT role claim.
const (
	// RoleAdmin authenticates the single site administrator.
	RoleAdmin = "admin"
	// RoleGuest authenticates a party via the RSVP flow.
	RoleGuest = "guest"
)

// ErrInvalidCredentials is returned when admin authentication fails. It is
// intentionally identical for a wrong username and a wrong password so callers
// cannot probe which field was incorrect.
var ErrInvalidCredentials = errors.New("invalid username or password")

// JWTClaims are the custom claims embedded in every issued token.
//
// PartyID is populated only for guest tokens; it is omitted from admin tokens.
type JWTClaims struct {
	Role    string `json:"role"`
	PartyID string `json:"party_id,omitempty"`
	jwt.RegisteredClaims
}

// Service issues and validates JWTs and authenticates the admin credential.
//
// Admin and guest tokens have separate lifetimes: admin sessions are short
// because admin access is sensitive and cannot be revoked individually, while
// guest sessions are long so guests stay logged in across the RSVP window.
type Service struct {
	jwtSecret            []byte
	adminSessionDuration time.Duration
	guestSessionDuration time.Duration
	adminUsername        string
	adminPassword        string
}

// NewService builds a Service from the JWT secret, the per-role token lifetimes,
// and the single admin credential (username and password).
func NewService(jwtSecret string, adminSessionDuration, guestSessionDuration time.Duration, adminUsername, adminPassword string) *Service {
	return &Service{
		jwtSecret:            []byte(jwtSecret),
		adminSessionDuration: adminSessionDuration,
		guestSessionDuration: guestSessionDuration,
		adminUsername:        adminUsername,
		adminPassword:        adminPassword,
	}
}

// GenerateAdminToken issues a signed JWT carrying the admin role.
func (s *Service) GenerateAdminToken() (string, error) {
	return s.generateToken(RoleAdmin, "", s.adminSessionDuration)
}

// GenerateGuestToken issues a signed JWT carrying the guest role and the party
// it authenticates. The guest login handler calls it after resolving an RSVP
// code to its party.
func (s *Service) GenerateGuestToken(partyID string) (string, error) {
	return s.generateToken(RoleGuest, partyID, s.guestSessionDuration)
}

// generateToken mints and signs a JWT for the given role and (optional) party,
// expiring after the supplied duration.
func (s *Service) generateToken(role, partyID string, duration time.Duration) (string, error) {
	id, err := uuid.NewV7()
	if err != nil {
		return "", err
	}

	now := time.Now()
	claims := JWTClaims{
		Role:    role,
		PartyID: partyID,
		RegisteredClaims: jwt.RegisteredClaims{
			ID:        id.String(),
			ExpiresAt: jwt.NewNumericDate(now.Add(duration)),
			IssuedAt:  jwt.NewNumericDate(now),
			NotBefore: jwt.NewNumericDate(now),
		},
	}

	token := jwt.NewWithClaims(jwt.SigningMethodHS256, claims)
	signed, err := token.SignedString(s.jwtSecret)
	if err != nil {
		return "", err
	}
	return signed, nil
}

// ValidateToken parses and verifies a token, returning its claims. It rejects
// tokens that are expired, malformed, wrongly signed, or signed with an
// unexpected (non-HMAC) method.
func (s *Service) ValidateToken(tokenString string) (*JWTClaims, error) {
	token, err := jwt.ParseWithClaims(tokenString, &JWTClaims{}, func(token *jwt.Token) (any, error) {
		if _, ok := token.Method.(*jwt.SigningMethodHMAC); !ok {
			return nil, errors.New("unexpected signing method")
		}
		return s.jwtSecret, nil
	})
	if err != nil {
		return nil, err
	}

	claims, ok := token.Claims.(*JWTClaims)
	if !ok || !token.Valid {
		return nil, errors.New("invalid token")
	}
	return claims, nil
}

// AuthenticateAdmin checks a username and password against the configured admin
// credential. It returns ErrInvalidCredentials on any mismatch. Both fields are
// compared in constant time, and both comparisons always run, so callers cannot
// probe which field was incorrect via timing.
func (s *Service) AuthenticateAdmin(username, password string) error {
	usernameMatch := subtle.ConstantTimeCompare([]byte(username), []byte(s.adminUsername)) == 1
	passwordMatch := subtle.ConstantTimeCompare([]byte(password), []byte(s.adminPassword)) == 1
	if !usernameMatch || !passwordMatch {
		return ErrInvalidCredentials
	}
	return nil
}
