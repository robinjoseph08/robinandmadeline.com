package config_test

import (
	"testing"
	"time"

	"github.com/robinjoseph08/robinandmadeline.com/pkg/config"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestNew(t *testing.T) {
	t.Run("applies local-dev defaults when env is unset", func(t *testing.T) {
		cfg, err := config.New()
		require.NoError(t, err)

		assert.NotEmpty(t, cfg.DatabaseURL)
		assert.Equal(t, 8400, cfg.ServerPort)
		assert.Equal(t, "admin", cfg.AdminUsername)
		assert.Equal(t, "changeme", cfg.AdminPassword)
		assert.NotEmpty(t, cfg.JWTSecret)
		assert.Equal(t, 7*24*time.Hour, cfg.AdminSessionDuration)
		// Guest sessions are long-lived so guests stay logged in across the RSVP
		// window, but bounded to the issue's 30-60 day range.
		assert.Equal(t, 60*24*time.Hour, cfg.GuestSessionDuration)
		assert.InDelta(t, 5.0, cfg.LoginRatePerMinute, 0)
		assert.Equal(t, 5, cfg.LoginRateBurst)
	})

	t.Run("reads values from environment", func(t *testing.T) {
		t.Setenv("DATABASE_URL", "postgres://custom")
		t.Setenv("PORT", "9999")
		t.Setenv("ADMIN_USERNAME", "robin")
		t.Setenv("ADMIN_PASSWORD", "hunter2")
		t.Setenv("JWT_SECRET", "topsecret")
		t.Setenv("ADMIN_SESSION_DURATION", "2h")
		t.Setenv("GUEST_SESSION_DURATION", "720h")
		t.Setenv("LOGIN_RATE_PER_MINUTE", "120")
		t.Setenv("LOGIN_RATE_BURST", "20")

		cfg, err := config.New()
		require.NoError(t, err)

		assert.Equal(t, "postgres://custom", cfg.DatabaseURL)
		assert.Equal(t, 9999, cfg.ServerPort)
		assert.Equal(t, "robin", cfg.AdminUsername)
		assert.Equal(t, "hunter2", cfg.AdminPassword)
		assert.Equal(t, "topsecret", cfg.JWTSecret)
		assert.Equal(t, 2*time.Hour, cfg.AdminSessionDuration)
		assert.Equal(t, 720*time.Hour, cfg.GuestSessionDuration)
		assert.InDelta(t, 120.0, cfg.LoginRatePerMinute, 0)
		assert.Equal(t, 20, cfg.LoginRateBurst)
	})

	t.Run("errors on malformed PORT", func(t *testing.T) {
		t.Setenv("PORT", "not-a-number")

		_, err := config.New()
		assert.Error(t, err)
	})

	t.Run("errors on malformed ADMIN_SESSION_DURATION", func(t *testing.T) {
		t.Setenv("ADMIN_SESSION_DURATION", "not-a-duration")

		_, err := config.New()
		assert.Error(t, err)
	})

	t.Run("errors on malformed GUEST_SESSION_DURATION", func(t *testing.T) {
		t.Setenv("GUEST_SESSION_DURATION", "not-a-duration")

		_, err := config.New()
		assert.Error(t, err)
	})

	t.Run("errors on malformed LOGIN_RATE_PER_MINUTE", func(t *testing.T) {
		t.Setenv("LOGIN_RATE_PER_MINUTE", "not-a-number")

		_, err := config.New()
		assert.Error(t, err)
	})
}
