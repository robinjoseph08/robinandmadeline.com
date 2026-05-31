package auth_test

import (
	"testing"
	"time"

	"github.com/golang-jwt/jwt/v5"
	"github.com/robinjoseph08/robinandmadeline.com/pkg/auth"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

const (
	testSecret   = "test-secret"
	testUsername = "admin"
	testPassword = "correct-horse"
)

// newTestService builds a Service with a known admin credential for tests.
func newTestService(t *testing.T) *auth.Service {
	t.Helper()
	return auth.NewService(testSecret, time.Hour, time.Hour, testUsername, testPassword)
}

func TestGenerateAdminToken(t *testing.T) {
	t.Parallel()
	svc := newTestService(t)

	token, err := svc.GenerateAdminToken()
	require.NoError(t, err)
	require.NotEmpty(t, token)

	claims, err := svc.ValidateToken(token)
	require.NoError(t, err)
	assert.Equal(t, auth.RoleAdmin, claims.Role)
	assert.Empty(t, claims.PartyID)
	assert.NotEmpty(t, claims.ID, "a JWT ID should be set")
	assert.NotNil(t, claims.ExpiresAt, "an expiry should be set")
}

func TestGenerateGuestToken(t *testing.T) {
	t.Parallel()
	svc := newTestService(t)
	partyID := "0190b8e0-0000-7000-8000-000000000001"

	token, err := svc.GenerateGuestToken(partyID)
	require.NoError(t, err)

	claims, err := svc.ValidateToken(token)
	require.NoError(t, err)
	assert.Equal(t, auth.RoleGuest, claims.Role)
	assert.Equal(t, partyID, claims.PartyID)
	assert.NotEmpty(t, claims.ID)
}

func TestTokenExpiry_DiffersByRole(t *testing.T) {
	t.Parallel()
	// Admin and guest tokens are minted with separate lifetimes; each must use
	// its own duration so the split actually takes effect.
	const (
		adminDuration = time.Hour
		guestDuration = 100 * time.Hour
	)
	svc := auth.NewService(testSecret, adminDuration, guestDuration, testUsername, testPassword)

	adminToken, err := svc.GenerateAdminToken()
	require.NoError(t, err)
	guestToken, err := svc.GenerateGuestToken("0190b8e0-0000-7000-8000-000000000001")
	require.NoError(t, err)

	adminClaims, err := svc.ValidateToken(adminToken)
	require.NoError(t, err)
	guestClaims, err := svc.ValidateToken(guestToken)
	require.NoError(t, err)

	assert.True(t, guestClaims.ExpiresAt.After(adminClaims.ExpiresAt.Time),
		"guest token should expire later than admin token given a longer guest duration")
}

func TestValidateToken_RejectsExpired(t *testing.T) {
	t.Parallel()
	// A service with a negative admin duration mints already-expired tokens.
	svc := auth.NewService(testSecret, -time.Hour, time.Hour, testUsername, testPassword)

	token, err := svc.GenerateAdminToken()
	require.NoError(t, err)

	_, err = svc.ValidateToken(token)
	assert.Error(t, err)
}

func TestValidateToken_RejectsMalformed(t *testing.T) {
	t.Parallel()
	svc := newTestService(t)

	_, err := svc.ValidateToken("not-a-real-jwt")
	assert.Error(t, err)
}

func TestValidateToken_RejectsWrongSignature(t *testing.T) {
	t.Parallel()
	svc := newTestService(t)
	token, err := svc.GenerateAdminToken()
	require.NoError(t, err)

	// A service with a different secret must reject the token.
	other := auth.NewService("other-secret", time.Hour, time.Hour, testUsername, "")
	_, err = other.ValidateToken(token)
	assert.Error(t, err)
}

func TestValidateToken_RejectsUnexpectedSigningMethod(t *testing.T) {
	t.Parallel()
	svc := newTestService(t)

	// Forge a token with the "none" algorithm; validation must reject it.
	claims := jwt.MapClaims{
		"role": auth.RoleAdmin,
		"exp":  time.Now().Add(time.Hour).Unix(),
	}
	token := jwt.NewWithClaims(jwt.SigningMethodNone, claims)
	signed, err := token.SignedString(jwt.UnsafeAllowNoneSignatureType)
	require.NoError(t, err)

	_, err = svc.ValidateToken(signed)
	assert.Error(t, err)
}

func TestAuthenticateAdmin(t *testing.T) {
	t.Parallel()
	svc := newTestService(t)

	t.Run("accepts correct credentials", func(t *testing.T) {
		t.Parallel()
		assert.NoError(t, svc.AuthenticateAdmin(testUsername, testPassword))
	})

	t.Run("rejects wrong password", func(t *testing.T) {
		t.Parallel()
		assert.Error(t, svc.AuthenticateAdmin(testUsername, "wrong"))
	})

	t.Run("rejects wrong username", func(t *testing.T) {
		t.Parallel()
		assert.Error(t, svc.AuthenticateAdmin("intruder", testPassword))
	})
}
