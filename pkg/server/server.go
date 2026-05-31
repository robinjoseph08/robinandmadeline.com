// Package server constructs the Echo HTTP server and registers routes.
package server

import (
	"fmt"
	"net/http"
	"time"

	"github.com/labstack/echo/v4"
	"github.com/labstack/echo/v4/middleware"
	"github.com/robinjoseph08/robinandmadeline.com/pkg/auth"
	"github.com/robinjoseph08/robinandmadeline.com/pkg/config"
	"github.com/uptrace/bun"
)

// New builds the HTTP server with all API routes mounted under /api.
//
// The db may be nil (or unreachable); the health endpoint stays reachable
// either way so liveness checks don't hard-fail when the database is down.
func New(cfg *config.Config, db *bun.DB) *http.Server {
	e := echo.New()
	e.HideBanner = true

	e.Use(middleware.Logger())
	e.Use(middleware.Recover())
	e.Use(middleware.CORS())

	authService := auth.NewService(cfg.JWTSecret, cfg.SessionDuration, cfg.AdminUsername, cfg.AdminPasswordHash)
	authMiddleware := auth.NewMiddleware(authService)

	api := e.Group("/api")
	registerHealth(api, db)
	auth.RegisterRoutes(api, authService)
	registerAdmin(api, authMiddleware)

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

// registerAdmin mounts the admin API surface behind the admin auth middleware.
// For now it exposes only GET /api/admin/me, a minimal endpoint that confirms a
// stored token is still a valid admin token. It exists so the middleware is
// actually mounted and exercised; real admin endpoints land in later issues and
// belong under this same protected group.
func registerAdmin(g *echo.Group, mw *auth.Middleware) {
	admin := g.Group("/admin")
	admin.Use(mw.RequireAdmin)
	admin.GET("/me", func(c echo.Context) error {
		return c.JSON(http.StatusOK, map[string]string{"role": auth.RoleAdmin})
	})
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
