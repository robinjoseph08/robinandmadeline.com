// Package server constructs the Echo HTTP server and registers routes.
package server

import (
	"fmt"
	"net/http"
	"time"

	"github.com/labstack/echo/v4"
	"github.com/labstack/echo/v4/middleware"
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

	api := e.Group("/api")
	registerHealth(api, db)

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
