// Package server constructs the Echo HTTP server and registers routes.
package server

import (
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
	"github.com/robinjoseph08/robinandmadeline.com/pkg/errcodes"
	"github.com/robinjoseph08/robinandmadeline.com/pkg/parties"
	"github.com/uptrace/bun"
)

// New builds the HTTP server with all API routes mounted under /api.
//
// The db may be nil (or unreachable); the health endpoint stays reachable
// either way so liveness checks don't hard-fail when the database is down.
func New(cfg *config.Config, db *bun.DB) *http.Server {
	e := echo.New()
	e.HideBanner = true

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
	// funnels panics into the error handler as 500s. CORS stays echo's. Order
	// mirrors the shisho reference: logger, recovery, CORS.
	e.Use(logger.Middleware())
	e.Use(recovery.Middleware())
	e.Use(middleware.CORS())

	authService := auth.NewService(cfg.JWTSecret, cfg.AdminSessionDuration, cfg.GuestSessionDuration, cfg.AdminUsername, cfg.AdminPassword)
	authMiddleware := auth.NewMiddleware(authService)

	api := e.Group("/api")
	registerHealth(api, db)
	auth.RegisterRoutes(api, authService)
	registerAdmin(api, authMiddleware, db)

	return &http.Server{
		Addr:              fmt.Sprintf(":%d", cfg.ServerPort),
		Handler:           e,
		ReadHeaderTimeout: 3 * time.Second,
	}
}

// registerAdmin mounts the admin API surface behind the admin auth middleware.
// Every route on the returned group requires a valid admin token. GET
// /api/admin/me confirms a stored token is still valid; the parties/guests
// endpoints register their own routes on this same protected group via
// parties.RegisterRoutes.
//
// The db may be nil (e.g. in wiring tests that only exercise auth): the
// parties service is still constructed, but its handlers are only reachable
// with a valid token and will error at query time if the DB is unavailable,
// which is the same failure mode as any other DB-backed endpoint.
func registerAdmin(g *echo.Group, mw *auth.Middleware, db *bun.DB) {
	admin := g.Group("/admin")
	admin.Use(mw.RequireAdmin)
	admin.GET("/me", func(c echo.Context) error {
		return c.JSON(http.StatusOK, MeResponse{Role: auth.RoleAdmin})
	})

	parties.RegisterRoutes(admin, parties.NewService(db))
}

// registerHealth mounts the liveness endpoint. It reports database
// connectivity in the body but always returns 200 so the route stays a
// reliable liveness signal even when the DB is unavailable.
func registerHealth(g *echo.Group, db *bun.DB) {
	g.GET("/health", func(c echo.Context) error {
		dbStatus := "unknown"
		if db != nil {
			if err := db.PingContext(c.Request().Context()); err != nil {
				dbStatus = "down"
			} else {
				dbStatus = "up"
			}
		}
		return c.JSON(http.StatusOK, HealthResponse{Status: "ok", Database: dbStatus})
	})
}
