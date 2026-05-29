// Package config loads application configuration from environment variables.
//
// All settings have sensible local-development defaults so the server runs
// out of the box against the docker-compose Postgres instance. Override any
// value by setting the corresponding environment variable (see .env.example).
package config

import (
	"fmt"
	"os"
	"strconv"
)

// Config holds all application configuration.
type Config struct {
	// DatabaseURL is the Postgres connection string.
	DatabaseURL string

	// ServerPort is the port the HTTP server listens on.
	ServerPort int

	// AdminUsername is the admin account username.
	AdminUsername string

	// AdminPassword is the admin account password.
	AdminPassword string

	// JWTSecret signs authentication tokens. Must be overridden in production.
	JWTSecret string
}

// Default values used for local development when an env var is unset.
const (
	// Local-only Postgres credentials matching docker-compose; never used in prod.
	defaultDatabaseURL   = "postgres://postgres:postgres@localhost:5432/robinandmadeline?sslmode=disable" //nolint:gosec // local dev default, overridden via DATABASE_URL
	defaultServerPort    = 3690
	defaultAdminUsername = "admin"
	// defaultAdminPassword and defaultJWTSecret are development-only conveniences.
	// CHANGE THESE IN PRODUCTION by setting ADMIN_PASSWORD and JWT_SECRET.
	defaultAdminPassword = "changeme"
	defaultJWTSecret     = "dev-secret-change-me-in-production"
)

// New builds a Config from the environment, applying defaults for any unset
// values. It returns an error only when a provided value is malformed (e.g. a
// non-numeric PORT).
func New() (*Config, error) {
	port, err := envInt("PORT", defaultServerPort)
	if err != nil {
		return nil, err
	}

	return &Config{
		DatabaseURL:   envStr("DATABASE_URL", defaultDatabaseURL),
		ServerPort:    port,
		AdminUsername: envStr("ADMIN_USERNAME", defaultAdminUsername),
		AdminPassword: envStr("ADMIN_PASSWORD", defaultAdminPassword),
		JWTSecret:     envStr("JWT_SECRET", defaultJWTSecret),
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
