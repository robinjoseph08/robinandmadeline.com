// Package auth provides JWT-based authentication for the admin and (later)
// guest roles. Tokens carry a role claim; guest tokens additionally carry the
// party they authenticate. The admin credential is a single username plus a
// bcrypt password hash, both sourced from configuration.
package auth

import (
	"crypto/subtle"
	"errors"
	"time"

	"github.com/golang-jwt/jwt/v5"
	"github.com/google/uuid"
	"golang.org/x/crypto/bcrypt"
)

// Role values carried in the JWT role claim.
const (
	// RoleAdmin authenticates the single site administrator.
	RoleAdmin = "admin"
	// RoleGuest authenticates a party via the RSVP flow (built in a later issue).
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
type Service struct {
	jwtSecret         []byte
	sessionDuration   time.Duration
	adminUsername     string
	adminPasswordHash string
}

// NewService builds a Service from the JWT secret, token lifetime, and the
// single admin credential (username plus bcrypt password hash).
func NewService(jwtSecret string, sessionDuration time.Duration, adminUsername, adminPasswordHash string) *Service {
	return &Service{
		jwtSecret:         []byte(jwtSecret),
		sessionDuration:   sessionDuration,
		adminUsername:     adminUsername,
		adminPasswordHash: adminPasswordHash,
	}
}

// GenerateAdminToken issues a signed JWT carrying the admin role.
func (s *Service) GenerateAdminToken() (string, error) {
	return s.generateToken(RoleAdmin, "")
}

// GenerateGuestToken issues a signed JWT carrying the guest role and the party
// it authenticates. The guest login flow that calls this lands in a later
// issue; the method exists now so token plumbing is exercised generically.
func (s *Service) GenerateGuestToken(partyID string) (string, error) {
	return s.generateToken(RoleGuest, partyID)
}

// generateToken mints and signs a JWT for the given role and (optional) party.
func (s *Service) generateToken(role, partyID string) (string, error) {
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
			ExpiresAt: jwt.NewNumericDate(now.Add(s.sessionDuration)),
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
// credential. It returns ErrInvalidCredentials on any mismatch. The username
// comparison is constant-time, and the password is verified with bcrypt, which
// is itself constant-time for a given hash.
func (s *Service) AuthenticateAdmin(username, password string) error {
	usernameMatch := subtle.ConstantTimeCompare([]byte(username), []byte(s.adminUsername)) == 1
	passwordErr := bcrypt.CompareHashAndPassword([]byte(s.adminPasswordHash), []byte(password))
	if !usernameMatch || passwordErr != nil {
		return ErrInvalidCredentials
	}
	return nil
}
