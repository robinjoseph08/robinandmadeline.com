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

	"golang.org/x/crypto/bcrypt"
)

// Config holds all application configuration.
type Config struct {
	// DatabaseURL is the Postgres connection string.
	DatabaseURL string

	// ServerPort is the port the HTTP server listens on.
	ServerPort int

	// AdminUsername is the admin account username.
	AdminUsername string

	// AdminPasswordHash is the bcrypt hash of the admin account password.
	// In production it is supplied via ADMIN_PASSWORD_HASH; in local dev an
	// unset value falls back to a hash of the dev-default password so login
	// works out of the box.
	AdminPasswordHash string

	// JWTSecret signs authentication tokens. Must be overridden in production.
	JWTSecret string

	// SessionDuration is how long an issued JWT stays valid.
	SessionDuration time.Duration
}

// Default values used for local development when an env var is unset.
const (
	// Local-only Postgres credentials matching docker-compose; never used in prod.
	defaultDatabaseURL   = "postgres://robinandmadeline_admin:password@localhost:5432/robinandmadeline?sslmode=disable" //nolint:gosec // local dev default, overridden via DATABASE_URL
	defaultServerPort    = 8400
	defaultAdminUsername = "admin"
	// defaultAdminPassword and defaultJWTSecret are development-only conveniences.
	// CHANGE THESE IN PRODUCTION by setting ADMIN_PASSWORD_HASH and JWT_SECRET.
	defaultAdminPassword   = "changeme"
	defaultJWTSecret       = "dev-secret-change-me-in-production"
	defaultSessionDuration = 24 * time.Hour
)

// New builds a Config from the environment, applying defaults for any unset
// values. It returns an error only when a provided value is malformed (e.g. a
// non-numeric PORT) or when the dev-default admin password cannot be hashed.
func New() (*Config, error) {
	port, err := envInt("PORT", defaultServerPort)
	if err != nil {
		return nil, err
	}

	sessionDuration, err := envDuration("SESSION_DURATION", defaultSessionDuration)
	if err != nil {
		return nil, err
	}

	passwordHash, err := adminPasswordHash()
	if err != nil {
		return nil, err
	}

	return &Config{
		DatabaseURL:       envStr("DATABASE_URL", defaultDatabaseURL),
		ServerPort:        port,
		AdminUsername:     envStr("ADMIN_USERNAME", defaultAdminUsername),
		AdminPasswordHash: passwordHash,
		JWTSecret:         envStr("JWT_SECRET", defaultJWTSecret),
		SessionDuration:   sessionDuration,
	}, nil
}

// adminPasswordHash returns the configured bcrypt hash from ADMIN_PASSWORD_HASH,
// or, when unset, a freshly computed hash of the dev-default password so local
// development works without any environment setup.
func adminPasswordHash() (string, error) {
	if h := os.Getenv("ADMIN_PASSWORD_HASH"); h != "" {
		return h, nil
	}
	hash, err := bcrypt.GenerateFromPassword([]byte(defaultAdminPassword), bcrypt.DefaultCost)
	if err != nil {
		return "", fmt.Errorf("hashing dev-default admin password: %w", err)
	}
	return string(hash), nil
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
