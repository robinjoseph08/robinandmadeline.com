// Command api is the HTTP server entry point for robinandmadeline.com.
package main

import (
	"context"
	"net"
	"net/http"
	"os"
	"strconv"
	"time"

	"github.com/pkg/errors"
	"github.com/robinjoseph08/golib/logger"
	"github.com/robinjoseph08/golib/signals"
	"github.com/robinjoseph08/robinandmadeline.com/pkg/config"
	"github.com/robinjoseph08/robinandmadeline.com/pkg/database"
	"github.com/robinjoseph08/robinandmadeline.com/pkg/server"
)

// shutdownTimeout bounds how long we wait for in-flight requests to drain
// during graceful shutdown before forcing connections closed.
const shutdownTimeout = 5 * time.Second

func main() {
	ctx := context.Background()
	log := logger.New()

	cfg, err := config.New()
	if err != nil {
		log.Err(err).Fatal("config error")
	}

	db, err := database.New(cfg)
	if err != nil {
		log.Err(err).Fatal("database error")
	}
	// A failed ping is logged but non-fatal: the server should still start so
	// the health endpoint is reachable and the DB can recover independently.
	pingCtx, pingCancel := context.WithTimeout(ctx, 5*time.Second)
	if err := database.Ping(pingCtx, db); err != nil {
		log.Err(err).Warn("database not reachable at startup")
	} else {
		log.Info("database connected")
	}
	pingCancel()

	// The server does NOT migrate at startup. Production runs migrations via the
	// Fly release_command (`cmd/migrations migrate`) before the new release takes
	// traffic; local dev applies them through the `mise start` task, which depends
	// on `db:migrate`.
	srv := server.New(cfg, db)

	lc := net.ListenConfig{}
	listener, err := lc.Listen(ctx, "tcp", srv.Addr)
	if err != nil {
		log.Err(err).Fatal("failed to bind port", logger.Data{"addr": srv.Addr})
	}
	actualPort := listener.Addr().(*net.TCPAddr).Port
	log.Info("server started", logger.Data{"port": actualPort})
	writePortFile(log, actualPort)

	graceful := signals.Setup()

	go func() {
		if err := srv.Serve(listener); err != nil && !errors.Is(err, http.ErrServerClosed) {
			log.Err(err).Fatal("server stopped unexpectedly")
		}
	}()

	// Block until an interrupt or termination signal arrives. signals.Setup
	// closes this channel on the first SIGINT/SIGTERM and os.Exit(1)s on the
	// second, so a stuck shutdown can always be forced by signaling again.
	<-graceful
	log.Info("starting graceful shutdown")

	shutdownCtx, cancel := context.WithTimeout(context.Background(), shutdownTimeout)
	defer cancel()
	if err := srv.Shutdown(shutdownCtx); err != nil {
		log.Err(err).Error("server shutdown error")
	}
	if err := db.Close(); err != nil {
		log.Err(err).Error("database close error")
	}
	log.Info("shutdown complete")
}

// writePortFile writes the server's actual port to tmp/api.port so the Vite
// dev server can discover it. Skips silently if tmp/ doesn't exist.
func writePortFile(log logger.Logger, port int) {
	if _, err := os.Stat("tmp"); os.IsNotExist(err) {
		return
	}
	if err := os.WriteFile("tmp/api.port", []byte(strconv.Itoa(port)), 0o600); err != nil {
		log.Err(err).Warn("failed to write port file")
	}
}
