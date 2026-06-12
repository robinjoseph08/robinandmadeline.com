// Command api is the HTTP server entry point for robinandmadeline.com.
package main

import (
	"context"
	"fmt"
	"net"
	"net/http"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"time"

	"github.com/pkg/errors"
	"github.com/robinjoseph08/golib/logger"
	"github.com/robinjoseph08/golib/signals"
	"github.com/robinjoseph08/robinandmadeline.com/pkg/config"
	"github.com/robinjoseph08/robinandmadeline.com/pkg/database"
	"github.com/robinjoseph08/robinandmadeline.com/pkg/emails"
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
	// The startup connectivity probe is informational only, and it runs in the
	// background: a failed ping is logged but non-fatal (the health endpoint
	// stays reachable and the DB recovers independently), and keeping it off
	// the startup path means a cold Neon database never delays the listener,
	// preserving the sub-second cold start that scale-to-zero relies on
	// (ADR 0001).
	go func() {
		pingCtx, pingCancel := context.WithTimeout(ctx, 5*time.Second)
		defer pingCancel()
		if err := database.Ping(pingCtx, db); err != nil {
			log.Err(err).Warn("database not reachable at startup")
		} else {
			log.Info("database connected")
		}
	}()

	// The server does NOT migrate at startup. Production runs migrations via the
	// Fly release_command (`cmd/migrations migrate`) before the new release takes
	// traffic; local dev applies them through the `mise start` task, which depends
	// on `db:migrate`.
	srv := server.New(cfg, db)

	// The email queue worker (ADR 0004) drains email_recipients through
	// Mailgun. Without an API key (local dev, e2e) it stays off and queued
	// emails simply wait, so nothing can ever call the real Mailgun API
	// unconfigured.
	var worker *emails.Worker
	workerCtx, stopWorker := context.WithCancel(ctx)
	defer stopWorker()
	if cfg.MailgunAPIKey != "" {
		client := emails.NewMailgunClient(cfg.MailgunBaseURL, cfg.MailgunDomain, cfg.MailgunAPIKey)
		worker = emails.NewWorker(db, client, emails.WorkerConfig{
			From:           cfg.EmailFrom,
			PublicBaseURL:  cfg.PublicBaseURL,
			BatchSize:      cfg.EmailWorkerBatchSize,
			PollInterval:   cfg.EmailWorkerPollInterval,
			StuckThreshold: cfg.EmailWorkerStuckThreshold,
			DailySendLimit: cfg.EmailDailySendLimit,
		}, log)
		go worker.Run(workerCtx)
	} else {
		log.Warn("MAILGUN_API_KEY not set; email worker disabled, sends will stay queued")
	}

	listener, err := listen(ctx, cfg)
	if err != nil {
		log.Err(err).Fatal("failed to bind port")
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
	// Stop the email worker: it picks up no new batches but finishes the one
	// in flight (ADR 0004), so wait for it before closing the database. A
	// genuinely stuck worker can be forced with a second signal, which
	// signals.Setup turns into an immediate exit.
	stopWorker()
	if worker != nil {
		<-worker.Done()
	}
	if err := db.Close(); err != nil {
		log.Err(err).Error("database close error")
	}
	log.Info("shutdown complete")
}

// listen opens the server's TCP listener. When PORT is set to a non-empty value
// (production via the Fly machine, the e2e harness) it binds that port and fails
// loudly if it is taken. In local development (PORT unset or empty) it prefers a
// stable port (the one this worktree last used, recorded in the port file, or
// the configured default), but falls back to an OS-assigned free port when that
// is busy, so a second git worktree's `mise start` never collides with the
// first. The chosen port is published via writePortFile for the Vite dev server.
func listen(ctx context.Context, cfg *config.Config) (net.Listener, error) {
	lc := net.ListenConfig{}
	// An empty PORT is treated as unset (matching config's envInt), so a stray
	// PORT= in the environment still gets the dev free-port fallback.
	if v := os.Getenv("PORT"); v != "" {
		return lc.Listen(ctx, "tcp", fmt.Sprintf(":%d", cfg.ServerPort))
	}
	preferred := cfg.ServerPort
	if cached, ok := cachedPort(); ok {
		preferred = cached
	}
	if l, err := lc.Listen(ctx, "tcp", fmt.Sprintf(":%d", preferred)); err == nil {
		return l, nil
	}
	// Preferred port busy (another worktree holds it): take any free port.
	return lc.Listen(ctx, "tcp", ":0")
}

// cachedPort returns the port this worktree recorded in the port file on its
// previous run, if present and valid. Preferring it keeps the dev server on a
// stable port across air rebuilds (the Vite proxy reads the port file once at
// startup, so a changing port would break it) without hard-coding one that would
// clash across worktrees.
func cachedPort() (int, bool) {
	data, err := os.ReadFile(portFilePath())
	if err != nil {
		return 0, false
	}
	port, err := strconv.Atoi(strings.TrimSpace(string(data)))
	if err != nil || port <= 0 {
		return 0, false
	}
	return port, true
}

// writePortFile publishes the server's actual port to the port file so the Vite
// dev server can discover it. Skips silently if the target directory does not
// exist (e.g. a stripped-down deployment with no tmp/).
func writePortFile(log logger.Logger, port int) {
	path := portFilePath()
	if _, err := os.Stat(filepath.Dir(path)); os.IsNotExist(err) {
		return
	}
	if err := os.WriteFile(path, []byte(strconv.Itoa(port)), 0o600); err != nil {
		log.Err(err).Warn("failed to write port file")
	}
}

// portFilePath is where the server reads and publishes its port, defaulting to
// tmp/api.port. The e2e harness overrides it via API_PORT_FILE so an e2e run
// writes a throwaway path and never clobbers a running dev server's port file.
func portFilePath() string {
	if p := os.Getenv("API_PORT_FILE"); p != "" {
		return p
	}
	return "tmp/api.port"
}
