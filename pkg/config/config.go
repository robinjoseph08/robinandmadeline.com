// Package config loads application configuration from environment variables.
//
// All settings have sensible local-development defaults so the server runs
// out of the box against the docker-compose Postgres instance. Override any
// value by setting the corresponding environment variable.
package config

import (
	"errors"
	"fmt"
	"os"
	"strconv"
	"strings"
	"time"

	"github.com/robinjoseph08/robinandmadeline.com/pkg/worktree"
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

	// StaticDir is the directory holding the built frontend (the Vite bundle)
	// for the server to serve with an SPA fallback. Empty (the default) disables
	// static serving entirely: in local dev the Vite dev server serves the
	// frontend and proxies /api to this server. Production sets it to the
	// bundle directory baked into the Docker image.
	StaticDir string

	// CanonicalHost is the one hostname the site should be served from
	// (www.robinandmadeline.com in production). When set, requests for any
	// other host (the bare apex, the alternate domains, www variants) are
	// permanently redirected to it, preserving path and query. It must be a
	// bare hostname: a scheme, port, or path would make the redirect target
	// unreachable or loop, so config loading rejects them. Empty (the default)
	// disables host redirects so localhost dev and tests are unaffected.
	CanonicalHost string

	// TrustProxyHeaders controls whether the server believes proxy-forwarded
	// client-IP headers (Fly-Client-IP, X-Forwarded-For) when resolving the
	// client IP that keys the login rate limiter (ADR 0006). Only enable this
	// behind a trusted proxy (Fly's edge): on a direct connection these headers
	// are attacker-controlled and trusting them would let a brute-forcer dodge
	// the per-IP limit. Defaults to false, so dev and tests key on the socket
	// peer address.
	TrustProxyHeaders bool

	// PublicBaseURL is the site origin guest-facing links in emails are built
	// on ({{rsvp_link}}, {{info_link}} merge fields).
	PublicBaseURL string

	// MailgunAPIKey is the private Mailgun API key. When empty (local dev,
	// tests, e2e), the email worker does not start and queued emails stay
	// queued, so nothing ever calls the real Mailgun API by accident.
	MailgunAPIKey string

	// MailgunDomain is the Mailgun sending domain (e.g. mg.example.com).
	MailgunDomain string

	// MailgunBaseURL is the Mailgun API origin; override for the EU region.
	MailgunBaseURL string

	// MailgunWebhookSigningKey verifies Mailgun delivery webhook signatures.
	// When empty, every webhook is rejected as unauthorized.
	MailgunWebhookSigningKey string

	// EmailFrom is the From header on every outbound email.
	EmailFrom string

	// EmailWorkerBatchSize is how many queued recipients one worker batch
	// claims (ADR 0004).
	EmailWorkerBatchSize int

	// EmailWorkerPollInterval is how long the worker sleeps between queue
	// polls when idle.
	EmailWorkerPollInterval time.Duration

	// EmailWorkerStuckThreshold is how old a `sending` row must be before the
	// worker's reconcile pass (run each cycle, including immediately on
	// restart) checks it against Mailgun (ADR 0004).
	EmailWorkerStuckThreshold time.Duration

	// EmailDailySendLimit caps how many emails the worker dispatches per UTC
	// day, matching Mailgun's free-plan quota (100/day, resetting at midnight
	// UTC). Zero or negative means unlimited (a paid plan). The count only
	// covers sends made by this app; manual sends from the Mailgun dashboard
	// are invisible to it.
	EmailDailySendLimit int
}

// Default values used for local development when an env var is unset.
const (
	// Local-only Postgres credentials matching docker-compose; never used in
	// prod. The %s is the database name that defaultDatabaseURL fills in: the
	// canonical baseDatabaseName for the main checkout, or a per-worktree name so
	// concurrent git worktrees get isolated databases. Overridden wholesale by
	// DATABASE_URL in CI and production.
	defaultDatabaseURLTemplate = "postgres://robinandmadeline_admin:password@localhost:5432/%s?sslmode=disable" //nolint:gosec // local dev default, overridden via DATABASE_URL
	// baseDatabaseName is the dev database for the main checkout; linked worktrees
	// suffix it (see databaseName).
	baseDatabaseName     = "robinandmadeline"
	defaultServerPort    = 8400
	defaultAdminUsername = "admin"
	// defaultAdminPassword and defaultJWTSecret are development-only conveniences.
	// CHANGE THESE IN PRODUCTION by setting ADMIN_PASSWORD and JWT_SECRET.
	defaultAdminPassword = "changeme"
	defaultJWTSecret     = "dev-secret-change-me-in-production"
	// Admin sessions are short for safety; guest sessions last a full year so
	// guests stay logged in across the whole RSVP window without ever
	// re-entering their code.
	defaultAdminSessionDuration = 7 * 24 * time.Hour
	defaultGuestSessionDuration = 365 * 24 * time.Hour
	// A handful of login attempts per minute per IP, with a small burst
	// (ADR 0006). The e2e harness raises the rate so specs never trip it.
	defaultLoginRatePerMinute = 5.0
	defaultLoginRateBurst     = 5
	// The production site origin; emails built locally still link to the real
	// site, which is what a test send should show.
	defaultPublicBaseURL = "https://robinandmadeline.com"
	// Mailgun's US-region API origin (the EU one is api.eu.mailgun.net).
	defaultMailgunBaseURL = "https://api.mailgun.net"
	defaultEmailFrom      = "Robin & Madeline <hello@robinandmadeline.com>"
	// Small batches with a short pause keep one slow Mailgun call from
	// stalling the whole queue while still draining ~174 recipients in
	// seconds (ADR 0004).
	defaultEmailWorkerBatchSize    = 10
	defaultEmailWorkerPollInterval = 5 * time.Second
	// Comfortably longer than a worst-case in-flight batch, so a live
	// worker's rows are never mistaken for crash leftovers.
	defaultEmailWorkerStuckThreshold = 5 * time.Minute
	// Mailgun's free plan allows 100 emails per UTC day with no overage, so
	// the default budget matches it exactly.
	defaultEmailDailySendLimit = 100
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

	trustProxyHeaders, err := envBool("TRUST_PROXY_HEADERS", false)
	if err != nil {
		return nil, err
	}

	// The worker tuning knobs must be positive: a zero or negative batch size
	// makes every claim query fail (and zero would claim nothing forever), and
	// a non-positive poll interval turns the worker loop into a hot spin
	// against the database. Failing at startup beats either failure mode.
	emailWorkerBatchSize, err := envInt("EMAIL_WORKER_BATCH_SIZE", defaultEmailWorkerBatchSize)
	if err != nil {
		return nil, err
	}
	if emailWorkerBatchSize <= 0 {
		return nil, fmt.Errorf("invalid EMAIL_WORKER_BATCH_SIZE: %d is not positive", emailWorkerBatchSize)
	}

	emailWorkerPollInterval, err := envDuration("EMAIL_WORKER_POLL_INTERVAL", defaultEmailWorkerPollInterval)
	if err != nil {
		return nil, err
	}
	if emailWorkerPollInterval <= 0 {
		return nil, fmt.Errorf("invalid EMAIL_WORKER_POLL_INTERVAL: %s is not positive", emailWorkerPollInterval)
	}

	emailWorkerStuckThreshold, err := envDuration("EMAIL_WORKER_STUCK_THRESHOLD", defaultEmailWorkerStuckThreshold)
	if err != nil {
		return nil, err
	}
	if emailWorkerStuckThreshold <= 0 {
		return nil, fmt.Errorf("invalid EMAIL_WORKER_STUCK_THRESHOLD: %s is not positive", emailWorkerStuckThreshold)
	}

	// A canonical host carrying a scheme, port, path, or whitespace would
	// produce redirect targets that never match the incoming Host again (an
	// infinite redirect loop for the whole site), so it fails loudly at boot
	// instead: a bad deploy aborts on its health check and the previous
	// release keeps serving.
	canonicalHost := envStr("CANONICAL_HOST", "")
	if strings.ContainsAny(canonicalHost, ":/ ") {
		return nil, fmt.Errorf("invalid CANONICAL_HOST: %q must be a bare hostname without a scheme, port, or path", canonicalHost)
	}

	// Unlike the knobs above, zero and negative values are valid here: they
	// mean unlimited, for months where the Mailgun plan has no daily cap.
	emailDailySendLimit, err := envInt("EMAIL_DAILY_SEND_LIMIT", defaultEmailDailySendLimit)
	if err != nil {
		return nil, err
	}

	// An API key with no sending domain would start the worker against a
	// malformed Mailgun URL: every claimed row would get a definitive non-2xx
	// rejection and be permanently marked failed. Fail at startup instead.
	if os.Getenv("MAILGUN_API_KEY") != "" && os.Getenv("MAILGUN_DOMAIN") == "" {
		return nil, errors.New("MAILGUN_DOMAIN must be set when MAILGUN_API_KEY is set")
	}

	return &Config{
		DatabaseURL:          envStr("DATABASE_URL", defaultDatabaseURL()),
		ServerPort:           port,
		AdminUsername:        envStr("ADMIN_USERNAME", defaultAdminUsername),
		AdminPassword:        envStr("ADMIN_PASSWORD", defaultAdminPassword),
		JWTSecret:            envStr("JWT_SECRET", defaultJWTSecret),
		AdminSessionDuration: adminSessionDuration,
		GuestSessionDuration: guestSessionDuration,
		LoginRatePerMinute:   loginRatePerMinute,
		LoginRateBurst:       loginRateBurst,
		StaticDir:            envStr("STATIC_DIR", ""),
		CanonicalHost:        canonicalHost,
		TrustProxyHeaders:    trustProxyHeaders,
		PublicBaseURL:        envStr("PUBLIC_BASE_URL", defaultPublicBaseURL),
		// Mailgun credentials default to empty: without an API key the email
		// worker stays off, and without a signing key webhooks are rejected.
		MailgunAPIKey:             os.Getenv("MAILGUN_API_KEY"),
		MailgunDomain:             os.Getenv("MAILGUN_DOMAIN"),
		MailgunBaseURL:            envStr("MAILGUN_BASE_URL", defaultMailgunBaseURL),
		MailgunWebhookSigningKey:  os.Getenv("MAILGUN_WEBHOOK_SIGNING_KEY"),
		EmailFrom:                 envStr("EMAIL_FROM", defaultEmailFrom),
		EmailWorkerBatchSize:      emailWorkerBatchSize,
		EmailWorkerPollInterval:   emailWorkerPollInterval,
		EmailWorkerStuckThreshold: emailWorkerStuckThreshold,
		EmailDailySendLimit:       emailDailySendLimit,
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

// envBool returns the environment variable parsed as a bool ("true"/"false",
// "1"/"0") or a fallback when unset/empty. A malformed value is a
// configuration error.
func envBool(key string, fallback bool) (bool, error) {
	v := os.Getenv(key)
	if v == "" {
		return fallback, nil
	}
	b, err := strconv.ParseBool(v)
	if err != nil {
		return false, fmt.Errorf("invalid %s: %q is not a valid boolean: %w", key, v, err)
	}
	return b, nil
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

// defaultDatabaseURL builds the local-development Postgres DSN used when
// DATABASE_URL is unset. The main checkout gets the canonical database; each
// linked git worktree gets its own (robinandmadeline_wt_<slug>) so concurrent
// worktrees never share a database or fight over migration state. Production and
// CI always set DATABASE_URL, so this branch never runs there.
func defaultDatabaseURL() string {
	return fmt.Sprintf(defaultDatabaseURLTemplate, databaseName(worktree.Slug()))
}

// databaseName returns the dev database name for a worktree slug: the canonical
// base name for the main checkout (empty slug), or a per-worktree name derived
// from it otherwise.
func databaseName(slug string) string {
	if slug == "" {
		return baseDatabaseName
	}
	return baseDatabaseName + "_wt_" + slug
}
