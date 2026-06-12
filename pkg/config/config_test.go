package config_test

import (
	"os"
	"path/filepath"
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
		// Guest sessions last a full year so guests stay logged in across the
		// whole RSVP window without ever re-entering their code.
		assert.Equal(t, 365*24*time.Hour, cfg.GuestSessionDuration)
		assert.InDelta(t, 5.0, cfg.LoginRatePerMinute, 0)
		assert.Equal(t, 5, cfg.LoginRateBurst)
		assert.Equal(t, "https://robinandmadeline.com", cfg.PublicBaseURL)
		// Mailgun credentials default to empty so the worker stays off and
		// webhooks are rejected until they are explicitly configured.
		assert.Empty(t, cfg.MailgunAPIKey)
		assert.Empty(t, cfg.MailgunDomain)
		assert.Empty(t, cfg.MailgunWebhookSigningKey)
		assert.Equal(t, "https://api.mailgun.net", cfg.MailgunBaseURL)
		assert.Equal(t, "Robin & Madeline <hello@robinandmadeline.com>", cfg.EmailFrom)
		assert.Equal(t, 10, cfg.EmailWorkerBatchSize)
		assert.Equal(t, 5*time.Second, cfg.EmailWorkerPollInterval)
		assert.Equal(t, 5*time.Minute, cfg.EmailWorkerStuckThreshold)
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
		t.Setenv("PUBLIC_BASE_URL", "https://staging.example.com")
		t.Setenv("MAILGUN_API_KEY", "key-abc")
		t.Setenv("MAILGUN_DOMAIN", "mg.example.com")
		t.Setenv("MAILGUN_BASE_URL", "https://api.eu.mailgun.net")
		t.Setenv("MAILGUN_WEBHOOK_SIGNING_KEY", "whsec-abc")
		t.Setenv("EMAIL_FROM", "Us <us@example.com>")
		t.Setenv("EMAIL_WORKER_BATCH_SIZE", "25")
		t.Setenv("EMAIL_WORKER_POLL_INTERVAL", "1s")
		t.Setenv("EMAIL_WORKER_STUCK_THRESHOLD", "10m")

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
		assert.Equal(t, "https://staging.example.com", cfg.PublicBaseURL)
		assert.Equal(t, "key-abc", cfg.MailgunAPIKey)
		assert.Equal(t, "mg.example.com", cfg.MailgunDomain)
		assert.Equal(t, "https://api.eu.mailgun.net", cfg.MailgunBaseURL)
		assert.Equal(t, "whsec-abc", cfg.MailgunWebhookSigningKey)
		assert.Equal(t, "Us <us@example.com>", cfg.EmailFrom)
		assert.Equal(t, 25, cfg.EmailWorkerBatchSize)
		assert.Equal(t, time.Second, cfg.EmailWorkerPollInterval)
		assert.Equal(t, 10*time.Minute, cfg.EmailWorkerStuckThreshold)
	})

	t.Run("errors on malformed EMAIL_WORKER_POLL_INTERVAL", func(t *testing.T) {
		t.Setenv("EMAIL_WORKER_POLL_INTERVAL", "not-a-duration")

		_, err := config.New()
		assert.Error(t, err)
	})

	t.Run("uses the canonical database for the main checkout", func(t *testing.T) {
		// Setting DATABASE_URL to "" makes envStr fall back to the computed
		// default; the main checkout's .git is a directory.
		t.Setenv("DATABASE_URL", "")
		dir := t.TempDir()
		require.NoError(t, os.Mkdir(filepath.Join(dir, ".git"), 0o755))
		t.Chdir(dir)

		cfg, err := config.New()
		require.NoError(t, err)
		// Pin the whole DSN (not just the database name) so a regression in the
		// credentials, host, port, or sslmode is caught too.
		assert.Equal(t, "postgres://robinandmadeline_admin:password@localhost:5432/robinandmadeline?sslmode=disable", cfg.DatabaseURL)
	})

	t.Run("derives a per-worktree database inside a linked worktree", func(t *testing.T) {
		t.Setenv("DATABASE_URL", "")
		dir := t.TempDir()
		// A linked worktree's .git is a file pointing into .git/worktrees/<name>;
		// the name is sanitized to a Postgres identifier fragment (the hyphen
		// becomes an underscore).
		gitFile := filepath.Join(dir, ".git")
		require.NoError(t, os.WriteFile(gitFile, []byte("gitdir: /repo/.git/worktrees/my-feature\n"), 0o600))
		t.Chdir(dir)

		cfg, err := config.New()
		require.NoError(t, err)
		assert.Equal(t, "postgres://robinandmadeline_admin:password@localhost:5432/robinandmadeline_wt_my_feature?sslmode=disable", cfg.DatabaseURL)
	})

	// Non-positive worker knobs fail at startup: zero or negative values would
	// otherwise surface as a failing claim query every cycle (batch size) or a
	// hot poll loop against the database (poll interval).
	t.Run("errors on non-positive EMAIL_WORKER_BATCH_SIZE", func(t *testing.T) {
		t.Setenv("EMAIL_WORKER_BATCH_SIZE", "0")

		_, err := config.New()
		assert.Error(t, err)
	})

	t.Run("errors on non-positive EMAIL_WORKER_POLL_INTERVAL", func(t *testing.T) {
		t.Setenv("EMAIL_WORKER_POLL_INTERVAL", "-1s")

		_, err := config.New()
		assert.Error(t, err)
	})

	t.Run("errors on non-positive EMAIL_WORKER_STUCK_THRESHOLD", func(t *testing.T) {
		t.Setenv("EMAIL_WORKER_STUCK_THRESHOLD", "0s")

		_, err := config.New()
		assert.Error(t, err)
	})

	t.Run("errors on MAILGUN_API_KEY without MAILGUN_DOMAIN", func(t *testing.T) {
		// A key with no sending domain would start the worker against a
		// malformed Mailgun URL and permanently fail every queued email.
		t.Setenv("MAILGUN_API_KEY", "key-test")
		t.Setenv("MAILGUN_DOMAIN", "")

		_, err := config.New()
		assert.Error(t, err)
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

	t.Run("deployment settings default off so local dev is unaffected", func(t *testing.T) {
		cfg, err := config.New()
		require.NoError(t, err)

		// No static dir: the Vite dev server serves the frontend in dev.
		assert.Empty(t, cfg.StaticDir)
		// No canonical host: no host redirects on localhost.
		assert.Empty(t, cfg.CanonicalHost)
		// Direct connections only: forwarded-IP headers are spoofable without a
		// trusted proxy in front, so they are ignored by default.
		assert.False(t, cfg.TrustProxyHeaders)
	})

	t.Run("reads deployment settings from environment", func(t *testing.T) {
		t.Setenv("STATIC_DIR", "/app/public")
		t.Setenv("CANONICAL_HOST", "www.robinandmadeline.com")
		t.Setenv("TRUST_PROXY_HEADERS", "true")

		cfg, err := config.New()
		require.NoError(t, err)

		assert.Equal(t, "/app/public", cfg.StaticDir)
		assert.Equal(t, "www.robinandmadeline.com", cfg.CanonicalHost)
		assert.True(t, cfg.TrustProxyHeaders)
	})

	t.Run("errors on malformed TRUST_PROXY_HEADERS", func(t *testing.T) {
		t.Setenv("TRUST_PROXY_HEADERS", "not-a-bool")

		_, err := config.New()
		assert.Error(t, err)
	})

	t.Run("accepts the common boolean spellings for TRUST_PROXY_HEADERS", func(t *testing.T) {
		tests := []struct {
			value string
			want  bool
		}{
			{value: "1", want: true},
			{value: "0", want: false},
			{value: "false", want: false},
		}
		for _, tt := range tests {
			t.Run(tt.value, func(t *testing.T) {
				t.Setenv("TRUST_PROXY_HEADERS", tt.value)

				cfg, err := config.New()
				require.NoError(t, err)
				assert.Equal(t, tt.want, cfg.TrustProxyHeaders)
			})
		}
	})

	t.Run("errors when CANONICAL_HOST is not a bare hostname", func(t *testing.T) {
		// A scheme, port, or path in the canonical host would build redirect
		// targets that can never match the incoming Host again, looping the
		// whole site; config loading must reject them at boot.
		for _, value := range []string{
			"https://robinandmadeline.com",
			"robinandmadeline.com:443",
			"robinandmadeline.com/path",
		} {
			t.Run(value, func(t *testing.T) {
				t.Setenv("CANONICAL_HOST", value)

				_, err := config.New()
				assert.Error(t, err)
			})
		}
	})
}
