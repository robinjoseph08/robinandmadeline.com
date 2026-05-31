package config_test

import (
	"testing"
	"time"

	"github.com/robinjoseph08/robinandmadeline.com/pkg/config"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"golang.org/x/crypto/bcrypt"
)

func TestNew(t *testing.T) {
	t.Run("applies local-dev defaults when env is unset", func(t *testing.T) {
		cfg, err := config.New()
		require.NoError(t, err)

		assert.NotEmpty(t, cfg.DatabaseURL)
		assert.Equal(t, 8400, cfg.ServerPort)
		assert.Equal(t, "admin", cfg.AdminUsername)
		assert.NotEmpty(t, cfg.JWTSecret)
		assert.Equal(t, 24*time.Hour, cfg.SessionDuration)
	})

	t.Run("falls back to a usable admin password hash when none is set", func(t *testing.T) {
		// With no ADMIN_PASSWORD_HASH, local dev must still work: the fallback
		// hash must verify against the dev-default password "changeme".
		cfg, err := config.New()
		require.NoError(t, err)

		require.NotEmpty(t, cfg.AdminPasswordHash)
		assert.NoError(t, bcrypt.CompareHashAndPassword([]byte(cfg.AdminPasswordHash), []byte("changeme")))
	})

	t.Run("reads values from environment", func(t *testing.T) {
		t.Setenv("DATABASE_URL", "postgres://custom")
		t.Setenv("PORT", "9999")
		t.Setenv("ADMIN_USERNAME", "robin")
		t.Setenv("ADMIN_PASSWORD_HASH", "$2a$10$abcdefghijklmnopqrstuv")
		t.Setenv("JWT_SECRET", "topsecret")
		t.Setenv("SESSION_DURATION", "2h")

		cfg, err := config.New()
		require.NoError(t, err)

		assert.Equal(t, "postgres://custom", cfg.DatabaseURL)
		assert.Equal(t, 9999, cfg.ServerPort)
		assert.Equal(t, "robin", cfg.AdminUsername)
		assert.Equal(t, "$2a$10$abcdefghijklmnopqrstuv", cfg.AdminPasswordHash)
		assert.Equal(t, "topsecret", cfg.JWTSecret)
		assert.Equal(t, 2*time.Hour, cfg.SessionDuration)
	})

	t.Run("errors on malformed PORT", func(t *testing.T) {
		t.Setenv("PORT", "not-a-number")

		_, err := config.New()
		assert.Error(t, err)
	})

	t.Run("errors on malformed SESSION_DURATION", func(t *testing.T) {
		t.Setenv("SESSION_DURATION", "not-a-duration")

		_, err := config.New()
		assert.Error(t, err)
	})
}
