// Package config loads application configuration from environment variables.
//
// All settings have sensible local-development defaults so the server runs
// out of the box against the docker-compose Postgres instance. Override any
// value by setting the corresponding environment variable.
package config

import (
	"fmt"
	"os"
	"strconv"
	"time"
)

// Config holds all application configuration.
type Config struct {
	// DatabaseURL is the Postgres connection string.
	DatabaseURL string

	// ServerPort is the port the HTTP server listens on.
	ServerPort int

	// AdminUsername is the admin account username.
	AdminUsername string

	// AdminPassword is the admin account password, sourced from ADMIN_PASSWORD.
	// It is stored in plaintext in the environment, which we already treat as a
	// secret store; in local dev an unset value falls back to a dev default so
	// login works out of the box.
	AdminPassword string

	// JWTSecret signs authentication tokens. Must be overridden in production.
	JWTSecret string

	// AdminSessionDuration is how long an issued admin JWT stays valid. Admin
	// access is sensitive (it can edit all guest data and send email), and these
	// tokens cannot be revoked individually, so this is kept short.
	AdminSessionDuration time.Duration

	// GuestSessionDuration is how long an issued guest JWT stays valid. Guests
	// authenticate once with their RSVP code and should stay logged in across
	// visits without re-entering it, so this is long-lived.
	GuestSessionDuration time.Duration

	// LoginRatePerMinute is how many login attempts per minute one IP can
	// sustain across both login endpoints, the compensating control for the
	// low-entropy RSVP codes (ADR 0006).
	LoginRatePerMinute float64

	// LoginRateBurst is how many login attempts one IP may make back to back
	// before the per-minute rate applies, absorbing a fumbled code or two
	// without throttling a legitimate guest.
	LoginRateBurst int
}

// Default values used for local development when an env var is unset.
const (
	// Local-only Postgres credentials matching docker-compose; never used in prod.
	defaultDatabaseURL   = "postgres://robinandmadeline_admin:password@localhost:5432/robinandmadeline?sslmode=disable" //nolint:gosec // local dev default, overridden via DATABASE_URL
	defaultServerPort    = 8400
	defaultAdminUsername = "admin"
	// defaultAdminPassword and defaultJWTSecret are development-only conveniences.
	// CHANGE THESE IN PRODUCTION by setting ADMIN_PASSWORD and JWT_SECRET.
	defaultAdminPassword = "changeme"
	defaultJWTSecret     = "dev-secret-change-me-in-production"
	// Admin sessions are short for safety; guest sessions are long so guests
	// stay logged in across the whole RSVP window without re-entering their
	// code (issue #7 specifies a 30-60 day guest expiry).
	defaultAdminSessionDuration = 7 * 24 * time.Hour
	defaultGuestSessionDuration = 60 * 24 * time.Hour
	// A handful of login attempts per minute per IP, with a small burst
	// (ADR 0006). The e2e harness raises the rate so specs never trip it.
	defaultLoginRatePerMinute = 5.0
	defaultLoginRateBurst     = 5
)

// New builds a Config from the environment, applying defaults for any unset
// values. It returns an error only when a provided value is malformed (e.g. a
// non-numeric PORT or an unparseable session duration).
func New() (*Config, error) {
	port, err := envInt("PORT", defaultServerPort)
	if err != nil {
		return nil, err
	}

	adminSessionDuration, err := envDuration("ADMIN_SESSION_DURATION", defaultAdminSessionDuration)
	if err != nil {
		return nil, err
	}

	guestSessionDuration, err := envDuration("GUEST_SESSION_DURATION", defaultGuestSessionDuration)
	if err != nil {
		return nil, err
	}

	loginRatePerMinute, err := envFloat("LOGIN_RATE_PER_MINUTE", defaultLoginRatePerMinute)
	if err != nil {
		return nil, err
	}

	loginRateBurst, err := envInt("LOGIN_RATE_BURST", defaultLoginRateBurst)
	if err != nil {
		return nil, err
	}

	return &Config{
		DatabaseURL:          envStr("DATABASE_URL", defaultDatabaseURL),
		ServerPort:           port,
		AdminUsername:        envStr("ADMIN_USERNAME", defaultAdminUsername),
		AdminPassword:        envStr("ADMIN_PASSWORD", defaultAdminPassword),
		JWTSecret:            envStr("JWT_SECRET", defaultJWTSecret),
		AdminSessionDuration: adminSessionDuration,
		GuestSessionDuration: guestSessionDuration,
		LoginRatePerMinute:   loginRatePerMinute,
		LoginRateBurst:       loginRateBurst,
	}, nil
}

// envStr returns the environment variable value or a fallback when unset/empty.
func envStr(key, fallback string) string {
	if v := os.Getenv(key); v != "" {
		return v
	}
	return fallback
}

// envInt returns the environment variable parsed as an int or a fallback when
// unset/empty. A malformed value is a configuration error.
func envInt(key string, fallback int) (int, error) {
	v := os.Getenv(key)
	if v == "" {
		return fallback, nil
	}
	n, err := strconv.Atoi(v)
	if err != nil {
		return 0, fmt.Errorf("invalid %s: %q is not a valid integer: %w", key, v, err)
	}
	return n, nil
}

// envFloat returns the environment variable parsed as a float64 or a fallback
// when unset/empty. A malformed value is a configuration error.
func envFloat(key string, fallback float64) (float64, error) {
	v := os.Getenv(key)
	if v == "" {
		return fallback, nil
	}
	f, err := strconv.ParseFloat(v, 64)
	if err != nil {
		return 0, fmt.Errorf("invalid %s: %q is not a valid number: %w", key, v, err)
	}
	return f, nil
}

// envDuration returns the environment variable parsed as a Go duration (e.g.
// "24h", "30m") or a fallback when unset/empty. A malformed value is a
// configuration error.
func envDuration(key string, fallback time.Duration) (time.Duration, error) {
	v := os.Getenv(key)
	if v == "" {
		return fallback, nil
	}
	d, err := time.ParseDuration(v)
	if err != nil {
		return 0, fmt.Errorf("invalid %s: %q is not a valid duration: %w", key, v, err)
	}
	return d, nil
}
