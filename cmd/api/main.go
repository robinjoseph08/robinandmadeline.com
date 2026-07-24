// Command api is the HTTP server entry point for robinandmadeline.com.
package main

import (
	"context"
	"database/sql/driver"
	"fmt"
	"net"
	"net/http"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"time"

	"github.com/joho/godotenv"
	"github.com/pkg/errors"
	"github.com/robinjoseph08/golib/logger"
	"github.com/robinjoseph08/golib/signals"
	"github.com/robinjoseph08/robinandmadeline.com/pkg/config"
	"github.com/robinjoseph08/robinandmadeline.com/pkg/database"
	"github.com/robinjoseph08/robinandmadeline.com/pkg/emails"
	"github.com/robinjoseph08/robinandmadeline.com/pkg/server"
	"github.com/uptrace/bun"
)

// shutdownTimeout bounds how long we wait for in-flight requests to drain
// during graceful shutdown before forcing connections closed.
const shutdownTimeout = 5 * time.Second

func main() {
	ctx := context.Background()
	log := logger.New()

	// Load a local .env if present so Mailgun keys and EMAIL_TEST_RECIPIENTS can
	// be set for local testing without exporting them by hand. Load never
	// overrides an already-set variable, so production (Fly secrets) and the
	// pinned env in CI/e2e win; a missing file is a no-op (.env is gitignored).
	if err := godotenv.Load(); err == nil {
		log.Info("loaded .env")
	}

	cfg, err := config.New()
	if err != nil {
		log.Err(err).Fatal("config error")
	}

	app, err := newApplication(ctx, cfg, productionApplicationDependencies(cfg, log))
	if err != nil {
		log.Err(err).Fatal("application assembly error")
	}
	defer app.stopWorker()

	// The server does NOT migrate at startup. Production runs migrations via the
	// Fly release_command (`cmd/migrations migrate`) before the new release takes
	// traffic; local dev applies them through the `mise start` task, which depends
	// on `db:migrate`.

	listener, err := listen(ctx, cfg)
	if err != nil {
		log.Err(err).Fatal("failed to bind port")
	}
	actualPort := listener.Addr().(*net.TCPAddr).Port
	log.Info("server started", logger.Data{"port": actualPort})
	writePortFile(log, actualPort)

	graceful := signals.Setup()

	go func() {
		if err := app.server.Serve(listener); err != nil && !errors.Is(err, http.ErrServerClosed) {
			log.Err(err).Fatal("server stopped unexpectedly")
		}
	}()

	// Block until an interrupt or termination signal arrives. signals.Setup
	// closes this channel on the first SIGINT/SIGTERM and os.Exit(1)s on the
	// second, so a stuck shutdown can always be forced by signaling again.
	<-graceful
	log.Info("starting graceful shutdown")

	// Stop the email worker as soon as shutdown begins: it picks up no new
	// batches but finishes the one in flight (ADR 0004). HTTP requests already
	// being drained may still commit durable queue work, which a later explicit
	// activation will pick up.
	app.stopWorker()

	shutdownCtx, cancel := context.WithTimeout(context.Background(), shutdownTimeout)
	defer cancel()
	if err := app.server.Shutdown(shutdownCtx); err != nil {
		log.Err(err).Error("server shutdown error")
	}
	// Wait for the worker before closing the database. A genuinely stuck worker
	// can be forced with a second signal, which signals.Setup turns into an
	// immediate exit.
	if app.worker != nil {
		<-app.worker.Done()
	}
	if err := app.db.Close(); err != nil {
		log.Err(err).Error("database close error")
	}
	log.Info("shutdown complete")
}

// application is the assembled production runtime below the executable
// boundary. Listener binding, signals, port publication, fatal logging, and
// graceful shutdown remain in main, while tests can assemble the exact lazy
// database, HTTP handler, and idle email supervisor without opening sockets.
type application struct {
	db         *bun.DB
	server     *http.Server
	worker     *emails.Worker
	stopWorker context.CancelFunc
}

type applicationDependencies struct {
	connector              driver.Connector
	observeFirstConnection database.FirstConnectionObserver
	mailgunClient          emails.MailgunClient
	log                    logger.Logger
}

func productionApplicationDependencies(cfg *config.Config, log logger.Logger) applicationDependencies {
	deps := applicationDependencies{
		connector: database.NewConnector(cfg),
		log:       log,
	}
	deps.observeFirstConnection = func(attempt database.FirstConnectionAttempt) {
		data := logger.Data{"operation": attempt.Operation.String(), "outcome": "connected"}
		if attempt.Err != nil {
			// Deliberately omit the connector error from this attribution event:
			// driver errors can contain DSN or host details, while the bounded
			// operation and outcome are sufficient to explain the activation.
			data["outcome"] = "failed"
			log.Data(data).Warn("first database connection attempt")
			return
		}
		log.Data(data).Info("first database connection attempt")
	}
	if cfg.MailgunAPIKey != "" {
		deps.mailgunClient = emails.NewMailgunClient(cfg.MailgunBaseURL, cfg.MailgunDomain, cfg.MailgunAPIKey)
	}
	return deps
}

func newApplication(ctx context.Context, cfg *config.Config, deps applicationDependencies) (*application, error) {
	db, err := database.NewWithConnector(deps.connector, deps.observeFirstConnection)
	if err != nil {
		return nil, errors.Wrap(err, "open database handle")
	}

	workerCtx, stopWorker := context.WithCancel(ctx)
	app := &application{db: db, stopWorker: stopWorker}
	if cfg.MailgunAPIKey != "" {
		if deps.mailgunClient == nil {
			stopWorker()
			_ = db.Close()
			return nil, errors.New("mailgun client is required when email delivery is configured")
		}
		app.worker = emails.NewWorker(db, deps.mailgunClient, emails.WorkerConfig{
			From:           cfg.EmailFrom,
			PublicBaseURL:  cfg.PublicBaseURL,
			BatchSize:      cfg.EmailWorkerBatchSize,
			StuckThreshold: cfg.EmailWorkerStuckThreshold,
			DailySendLimit: cfg.EmailDailySendLimit,
		}, deps.log)
		go app.worker.Run(workerCtx)
	} else {
		deps.log.Warn("MAILGUN_API_KEY not set; email worker disabled, sends will stay queued")
	}

	if app.worker == nil {
		app.server = server.New(cfg, db)
	} else {
		app.server = server.NewWithEmailWorker(cfg, db, app.worker)
	}
	return app, nil
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
