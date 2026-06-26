// Package server constructs the Echo HTTP server and registers routes.
package server

import (
	"context"
	"fmt"
	"net/http"
	"time"

	"github.com/labstack/echo/v4"
	"github.com/labstack/echo/v4/middleware"
	"github.com/robinjoseph08/golib/echo/v4/middleware/logger"
	"github.com/robinjoseph08/golib/echo/v4/middleware/recovery"
	"github.com/robinjoseph08/robinandmadeline.com/pkg/auth"
	"github.com/robinjoseph08/robinandmadeline.com/pkg/binder"
	"github.com/robinjoseph08/robinandmadeline.com/pkg/config"
	"github.com/robinjoseph08/robinandmadeline.com/pkg/dashboard"
	"github.com/robinjoseph08/robinandmadeline.com/pkg/emails"
	"github.com/robinjoseph08/robinandmadeline.com/pkg/errcodes"
	"github.com/robinjoseph08/robinandmadeline.com/pkg/events"
	"github.com/robinjoseph08/robinandmadeline.com/pkg/games"
	"github.com/robinjoseph08/robinandmadeline.com/pkg/info"
	"github.com/robinjoseph08/robinandmadeline.com/pkg/parties"
	"github.com/robinjoseph08/robinandmadeline.com/pkg/photogroups"
	"github.com/robinjoseph08/robinandmadeline.com/pkg/rsvps"
	"github.com/robinjoseph08/robinandmadeline.com/pkg/settings"
	"github.com/robinjoseph08/robinandmadeline.com/pkg/subscriptions"
	"github.com/uptrace/bun"
)

// New builds the HTTP server with all API routes mounted under /api.
//
// The db may be nil (or unreachable); the health endpoint stays reachable
// either way so liveness checks don't hard-fail when the database is down.
func New(cfg *config.Config, db *bun.DB) *http.Server {
	e := echo.New()
	e.HideBanner = true

	// Resolve client IPs explicitly (never Echo's spoofable default) so the
	// per-IP login rate limiter keys on the real client: the socket address
	// when hit directly, Fly's forwarded header behind the production proxy.
	e.IPExtractor = ipExtractor(cfg.TrustProxyHeaders)

	// Custom binder: a single c.Bind(&payload) binds, runs mold modifiers,
	// applies creasty defaults, and validates from struct tags, returning errcodes
	// failures. binder.New only fails if a static validator fails to register,
	// which is a programming error, so a startup panic is the right failure mode.
	b, err := binder.New()
	if err != nil {
		panic(err)
	}
	e.Binder = b

	// Render every error through the shared envelope handler. It logs 5xx
	// responses via the request-scoped golib logger installed by
	// logger.Middleware, so it needs no logger of its own.
	e.HTTPErrorHandler = errcodes.NewHandler().Handle

	// golib's logger.Middleware injects a request-scoped logger (with a request
	// ID) into the request context and logs request metadata; recovery.Middleware
	// funnels panics into the error handler as 500s. CORS stays echo's. The
	// base order mirrors the shisho reference (logger, recovery, CORS), with
	// the production-only host redirect and SPA middlewares slotted in.
	e.Use(logger.Middleware())
	e.Use(recovery.Middleware())

	// In production every domain (the alternate apexes, www variants) resolves
	// to this one app and the server consolidates them onto the canonical host
	// with 301s. Dev leaves CanonicalHost empty and is never redirected. After
	// logger/recovery so redirects are logged.
	if cfg.CanonicalHost != "" {
		e.Use(canonicalHostMiddleware(cfg.CanonicalHost))
	}

	e.Use(middleware.CORS())

	// In production the binary serves the built SPA itself (ADR 0001: one
	// scale-to-zero machine serves everything). Dev leaves StaticDir empty and
	// runs the Vite dev server instead.
	if cfg.StaticDir != "" {
		e.Use(staticMiddleware(cfg.StaticDir, cfg.CanonicalHost))
	}

	authService := auth.NewService(cfg.JWTSecret, cfg.AdminSessionDuration, cfg.GuestSessionDuration, cfg.AdminUsername, cfg.AdminPassword)
	authMiddleware := auth.NewMiddleware(authService)

	api := e.Group("/api")
	registerHealth(e, db)
	// Both login endpoints share one per-IP rate limiter (ADR 0006), the
	// compensating control for the low-entropy RSVP codes.
	auth.RegisterRoutes(api, authService, db, auth.RateLimit{
		PerMinute: cfg.LoginRatePerMinute,
		Burst:     cfg.LoginRateBurst,
	})
	registerAdmin(api, authMiddleware, db, cfg)
	registerGuest(api, authMiddleware, db)
	// The guest-facing schedule mounts on the open group behind optional guest
	// auth: anonymous requests see public events, a valid guest token adds the
	// party's invited private events, and a presented-but-invalid token is a
	// 401 so stale tokens surface instead of silently downgrading the view.
	events.RegisterScheduleRoutes(api, authMiddleware, events.NewService(db))
	// The info-collection flow mounts on the open group: there is no JWT, the
	// opaque high-entropy per-party info token in the URL is the authentication
	// (ADR 0003), so unlike the guessable RSVP codes it needs no rate limiter.
	info.RegisterRoutes(api, info.NewService(db))
	// The guest-facing email subscription flow mounts on the open group too:
	// like the info flow there is no JWT, the guest's own UUID in the URL is the
	// authentication (ADR 0009).
	subService := subscriptions.NewService(db)
	subscriptions.RegisterRoutes(api, subService)
	// The RFC 8058 one-click unsubscribe endpoint the List-Unsubscribe header
	// points at sits off the /api prefix (a top-level POST /u/:id), so the same
	// /u/:id path serves the SPA page on GET and the one-click POST here (ADR
	// 0009).
	subscriptions.RegisterOneClickRoute(e, subService)
	// The Mailgun delivery webhook also mounts on the open group: Mailgun
	// calls it, so there is no JWT; the HMAC signature on each payload is the
	// authentication (an unconfigured signing key rejects everything).
	emails.RegisterWebhookRoutes(api, emails.NewWebhook(db, cfg.MailgunWebhookSigningKey))
	// The games endpoints mount on the open group too: the crossword requires
	// no authentication, the session's UUID id is the bearer token for writes,
	// and the session routes sit behind optional guest auth so a signed-in
	// guest's party is attached to their solve opportunistically.
	games.RegisterRoutes(api, authMiddleware, games.NewService(db))

	return &http.Server{
		Addr:              fmt.Sprintf(":%d", cfg.ServerPort),
		Handler:           e,
		ReadHeaderTimeout: 3 * time.Second,
	}
}

// registerAdmin mounts the admin API surface behind the admin auth middleware.
// Every route on the returned group requires a valid admin token. GET
// /api/admin/me confirms a stored token is still valid; the dashboard,
// settings, parties/guests, and events endpoints register their own routes on
// this same protected group via their RegisterRoutes.
//
// The db may be nil (e.g. in wiring tests that only exercise auth): the
// parties service is still constructed, but its handlers are only reachable
// with a valid token and will error at query time if the DB is unavailable,
// which is the same failure mode as any other DB-backed endpoint.
func registerAdmin(g *echo.Group, mw *auth.Middleware, db *bun.DB, cfg *config.Config) {
	admin := g.Group("/admin")
	admin.Use(mw.RequireAdmin)
	admin.GET("/me", func(c echo.Context) error {
		return c.JSON(http.StatusOK, MeResponse{Role: auth.RoleAdmin})
	})

	dashboard.RegisterRoutes(admin, dashboard.NewService(db))
	settings.RegisterRoutes(admin, settings.NewService(db))
	parties.RegisterRoutes(admin, parties.NewService(db))
	events.RegisterRoutes(admin, events.NewService(db))
	photogroups.RegisterRoutes(admin, photogroups.NewService(db))

	emailService := emails.NewService(db, cfg.PublicBaseURL, cfg.AdminUsername, cfg.EmailDailySendLimit)
	// The "Send test" endpoint enqueues a real send for the queue worker, so it
	// needs no Mailgun client of its own. Enable it only when Mailgun is
	// configured, mirroring how the worker decides it is on (so there is a
	// worker to drain the test send); without a key the endpoint cleanly 422s.
	if cfg.MailgunAPIKey != "" {
		emailService.WithTestSend(cfg.EmailTestRecipients)
	}
	emails.RegisterRoutes(admin, emailService)
	// The games admin surface (list every solve, delete a junk/bad-actor solve)
	// hangs off the same protected group; the public games routes stay on the
	// open /api group, registered in New.
	games.RegisterAdminRoutes(admin, games.NewService(db))
}

// registerGuest mounts the guest API surface behind the guest auth middleware.
// Every route on the group requires a valid guest token, whose party_id claim
// scopes all reads and writes to that one party. Like registerAdmin, the db
// may be nil in wiring tests: the middleware rejects tokenless requests before
// any handler touches it.
func registerGuest(g *echo.Group, mw *auth.Middleware, db *bun.DB) {
	guest := g.Group("/guest")
	guest.Use(mw.RequireGuest)

	rsvps.RegisterRoutes(guest, rsvps.NewService(db))
	photogroups.RegisterGuestRoutes(guest, photogroups.NewService(db))
}

// healthPath is the liveness endpoint's absolute path. It is a constant
// shared with the canonical-host redirect middleware, which exempts it so
// Fly's health checks (which arrive with an internal Host) get their 200.
const healthPath = "/api/health"

// registerHealth mounts the liveness endpoint. It reports database
// connectivity in the body but always returns 200 so the route stays a
// reliable liveness signal even when the DB is unavailable. It registers on
// the echo instance directly (with healthPath absolute) so the path has a
// single definition for both routing and the redirect exemption.
func registerHealth(e *echo.Echo, db *bun.DB) {
	e.GET(healthPath, func(c echo.Context) error {
		dbStatus := "unknown"
		if db != nil {
			// The ping is bounded so the 200 always arrives fast: a cold or
			// unreachable database (Neon waking from idle) reports "down" in the
			// body instead of stalling the response past Fly's check timeout,
			// which would mark the only machine unhealthy and take the whole
			// site down with it.
			pingCtx, cancel := context.WithTimeout(c.Request().Context(), time.Second)
			defer cancel()
			if err := db.PingContext(pingCtx); err != nil {
				dbStatus = "down"
			} else {
				dbStatus = "up"
			}
		}
		return c.JSON(http.StatusOK, HealthResponse{Status: "ok", Database: dbStatus})
	})
}
