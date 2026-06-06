// Command api is the HTTP server entry point for robinandmadeline.com.
package main

import (
	"context"
	"errors"
	"log/slog"
	"net"
	"net/http"
	"os"
	"os/signal"
	"strconv"
	"syscall"
	"time"

	"github.com/robinjoseph08/robinandmadeline.com/pkg/config"
	"github.com/robinjoseph08/robinandmadeline.com/pkg/database"
	"github.com/robinjoseph08/robinandmadeline.com/pkg/migrations"
	"github.com/robinjoseph08/robinandmadeline.com/pkg/server"
)

// shutdownTimeout bounds how long we wait for in-flight requests to drain
// during graceful shutdown before forcing connections closed.
const shutdownTimeout = 5 * time.Second

func main() {
	ctx := context.Background()
	log := slog.New(slog.NewTextHandler(os.Stdout, nil))

	cfg, err := config.New()
	if err != nil {
		log.Error("config error", "error", err)
		os.Exit(1)
	}

	db, err := database.New(cfg)
	if err != nil {
		log.Error("database error", "error", err)
		os.Exit(1)
	}
	// A failed ping is logged but non-fatal: the server should still start so
	// the health endpoint is reachable and the DB can recover independently.
	pingCtx, pingCancel := context.WithTimeout(ctx, 5*time.Second)
	if err := database.Ping(pingCtx, db); err != nil {
		log.Warn("database not reachable at startup", "error", err)
	} else {
		log.Info("database connected")
	}
	pingCancel()

	// Bring the schema up to date before serving. Unlike the ping, a migration
	// failure is fatal: serving against a stale or half-migrated schema would
	// corrupt data or surface confusing errors, so we fail fast instead.
	migrateCtx, migrateCancel := context.WithTimeout(ctx, 60*time.Second)
	group, err := migrations.BringUpToDate(migrateCtx, db)
	migrateCancel()
	if err != nil {
		log.Error("migrations error", "error", err)
		os.Exit(1)
	}
	if group.ID == 0 {
		log.Info("no new migrations to run")
	} else {
		log.Info("migrated to new group", "group_id", group.ID, "migrations", group.Migrations.String())
	}

	srv := server.New(cfg, db)

	lc := net.ListenConfig{}
	listener, err := lc.Listen(ctx, "tcp", srv.Addr)
	if err != nil {
		log.Error("failed to bind port", "addr", srv.Addr, "error", err)
		os.Exit(1)
	}
	actualPort := listener.Addr().(*net.TCPAddr).Port
	log.Info("server started", "port", actualPort)
	writePortFile(log, actualPort)

	go func() {
		if err := srv.Serve(listener); err != nil && !errors.Is(err, http.ErrServerClosed) {
			log.Error("server stopped unexpectedly", "error", err)
			os.Exit(1)
		}
	}()

	// Block until an interrupt or termination signal arrives.
	stop := make(chan os.Signal, 1)
	signal.Notify(stop, os.Interrupt, syscall.SIGTERM)
	<-stop
	log.Info("starting graceful shutdown")

	ctx, cancel := context.WithTimeout(context.Background(), shutdownTimeout)
	defer cancel()
	if err := srv.Shutdown(ctx); err != nil {
		log.Error("server shutdown error", "error", err)
	}
	if err := db.Close(); err != nil {
		log.Error("database close error", "error", err)
	}
	log.Info("shutdown complete")
}

// writePortFile writes the server's actual port to tmp/api.port so the Vite
// dev server can discover it. Skips silently if tmp/ doesn't exist.
func writePortFile(log *slog.Logger, port int) {
	if _, err := os.Stat("tmp"); os.IsNotExist(err) {
		return
	}
	if err := os.WriteFile("tmp/api.port", []byte(strconv.Itoa(port)), 0o600); err != nil {
		log.Warn("failed to write port file", "error", err)
	}
}
