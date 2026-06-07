// Package server constructs the Echo HTTP server and registers routes.
package server

import (
	"fmt"
	"log/slog"
	"net/http"
	"os"
	"time"

	"github.com/labstack/echo/v4"
	"github.com/labstack/echo/v4/middleware"
	"github.com/robinjoseph08/robinandmadeline.com/pkg/auth"
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

	// Render every error through the shared envelope handler, matching how
	// cmd/api builds its slog logger.
	logger := slog.New(slog.NewTextHandler(os.Stdout, nil))
	e.HTTPErrorHandler = errcodes.NewHandler(logger).Handle

	e.Use(middleware.Logger())
	e.Use(middleware.Recover())
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

// healthResponse is the JSON body returned by GET /api/health.
type healthResponse struct {
	Status   string `json:"status"`
	Database string `json:"database"`
}

// meResponse is the JSON body returned by GET /api/admin/me, confirming the
// caller's role. It is a named struct rather than an anonymous map, per the API
// type conventions (ADR 0008).
type meResponse struct {
	Role string `json:"role"`
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
		return c.JSON(http.StatusOK, meResponse{Role: auth.RoleAdmin})
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
		return c.JSON(http.StatusOK, healthResponse{Status: "ok", Database: dbStatus})
	})
}
