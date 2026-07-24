package main

import (
	"bytes"
	"context"
	"database/sql/driver"
	"encoding/json"
	"errors"
	"net"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"sync"
	"sync/atomic"
	"testing"
	"testing/synctest"
	"time"

	"github.com/robinjoseph08/golib/logger"
	"github.com/robinjoseph08/robinandmadeline.com/pkg/config"
	"github.com/robinjoseph08/robinandmadeline.com/pkg/database"
	"github.com/robinjoseph08/robinandmadeline.com/pkg/emails"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

// occupy binds an ephemeral TCP port, keeps it held until the test ends, and
// returns it, so a test can assert how listen reacts to a busy port.
func occupy(t *testing.T) int {
	t.Helper()
	l, err := (&net.ListenConfig{}).Listen(context.Background(), "tcp", ":0")
	require.NoError(t, err)
	t.Cleanup(func() { _ = l.Close() })
	return l.Addr().(*net.TCPAddr).Port
}

// freePort returns a port free at call time (a later bind may still race, which
// is fine for these tests).
func freePort(t *testing.T) int {
	t.Helper()
	l, err := (&net.ListenConfig{}).Listen(context.Background(), "tcp", ":0")
	require.NoError(t, err)
	port := l.Addr().(*net.TCPAddr).Port
	require.NoError(t, l.Close())
	return port
}

func portOf(t *testing.T, l net.Listener) int {
	t.Helper()
	return l.Addr().(*net.TCPAddr).Port
}

func TestListen(t *testing.T) {
	ctx := context.Background()

	t.Run("PORT set: binds it strictly and errors when taken", func(t *testing.T) {
		port := occupy(t)
		t.Setenv("PORT", strconv.Itoa(port))
		_, err := listen(ctx, &config.Config{ServerPort: port})
		assert.Error(t, err)
	})

	t.Run("PORT unset: binds the preferred port when free", func(t *testing.T) {
		t.Setenv("PORT", "")
		// API_PORT_FILE points at a missing file so there is no cached port and
		// the preferred port is cfg.ServerPort.
		t.Setenv("API_PORT_FILE", filepath.Join(t.TempDir(), "api.port"))
		port := freePort(t)
		l, err := listen(ctx, &config.Config{ServerPort: port})
		require.NoError(t, err)
		defer func() { _ = l.Close() }()
		assert.Equal(t, port, portOf(t, l))
	})

	t.Run("PORT unset: falls back to a free port when the preferred is taken", func(t *testing.T) {
		t.Setenv("PORT", "")
		t.Setenv("API_PORT_FILE", filepath.Join(t.TempDir(), "api.port"))
		port := occupy(t)
		l, err := listen(ctx, &config.Config{ServerPort: port})
		require.NoError(t, err)
		defer func() { _ = l.Close() }()
		assert.NotEqual(t, port, portOf(t, l))
		assert.Positive(t, portOf(t, l))
	})
}

type assemblyConnector struct {
	attempts atomic.Int32
	err      error
}

func (c *assemblyConnector) Connect(context.Context) (driver.Conn, error) {
	c.attempts.Add(1)
	return nil, c.err
}

func (c *assemblyConnector) Driver() driver.Driver { return assemblyDriver{} }

type blockingAssemblyConnector struct {
	attempts atomic.Int32
	started  chan context.Context
}

func (c *blockingAssemblyConnector) Connect(ctx context.Context) (driver.Conn, error) {
	c.attempts.Add(1)
	c.started <- ctx
	<-ctx.Done()
	return nil, ctx.Err()
}

func (c *blockingAssemblyConnector) Driver() driver.Driver { return assemblyDriver{} }

type assemblyDriver struct{}

func (assemblyDriver) Open(string) (driver.Conn, error) {
	return nil, errors.New("assembly test driver cannot open by name")
}

type assemblyMailgun struct{}

func (*assemblyMailgun) Send(context.Context, emails.Message) (string, error) {
	return "", errors.New("unexpected Mailgun send")
}

func (*assemblyMailgun) FindAcceptedMessageID(context.Context, string, string) (string, bool, error) {
	return "", false, errors.New("unexpected Mailgun lookup")
}

func assemblyConfig() *config.Config {
	return &config.Config{
		ServerPort:           0,
		AdminUsername:        "admin",
		AdminPassword:        "password",
		JWTSecret:            "secret",
		AdminSessionDuration: time.Hour,
		GuestSessionDuration: time.Hour,
		LoginRatePerMinute:   6000,
		LoginRateBurst:       1000,
		MailgunAPIKey:        "configured",
		EmailWorkerBatchSize: 10,
	}
}

func closeApplication(t *testing.T, app *application) {
	t.Helper()
	app.stopWorker()
	if app.worker != nil {
		<-app.worker.Done()
	}
	require.NoError(t, app.db.Close())
}

func TestApplicationAssembly_StartupIdleWorkerAndHealthAreDatabaseFree(t *testing.T) {
	connector := &assemblyConnector{err: errors.New("database must not be reached")}
	var observed atomic.Int32
	app, err := newApplication(context.Background(), assemblyConfig(), applicationDependencies{
		connector: connector,
		observeFirstConnection: func(context.Context, database.FirstConnectionAttempt) {
			observed.Add(1)
		},
		mailgunClient: &assemblyMailgun{},
		log:           logger.NewWithLevel("error"),
	})
	require.NoError(t, err)
	defer closeApplication(t, app)

	// Wait until the supervisor has actually entered Run rather than relying on
	// scheduler timing. Reaching Started performs no wake or database work.
	select {
	case <-app.worker.Started():
	case <-time.After(time.Second):
		t.Fatal("email worker did not enter its supervision loop")
	}
	assert.Zero(t, connector.attempts.Load())
	assert.Zero(t, observed.Load())

	req := httptest.NewRequestWithContext(context.Background(), http.MethodGet, "/api/health?from=fly", http.NoBody)
	rec := httptest.NewRecorder()
	app.server.Handler.ServeHTTP(rec, req)

	assert.Equal(t, http.StatusOK, rec.Code)
	assert.JSONEq(t, `{"status":"ok"}`, rec.Body.String())
	assert.Zero(t, connector.attempts.Load())
	assert.Zero(t, observed.Load())
}

func TestApplicationAssembly_DatabaseBackedRequestAttemptsConnection(t *testing.T) {
	connectErr := errors.New("physical connection failed")
	connector := &assemblyConnector{err: connectErr}
	type observation struct {
		ctx     context.Context
		attempt database.FirstConnectionAttempt
	}
	attempts := make(chan observation, 1)
	app, err := newApplication(context.Background(), assemblyConfig(), applicationDependencies{
		connector: connector,
		observeFirstConnection: func(ctx context.Context, attempt database.FirstConnectionAttempt) {
			attempts <- observation{ctx: ctx, attempt: attempt}
		},
		mailgunClient: &assemblyMailgun{},
		log:           logger.NewWithLevel("error"),
	})
	require.NoError(t, err)
	defer closeApplication(t, app)

	const infoToken = "sensitiveinfotoken123456789012"
	req := httptest.NewRequestWithContext(context.Background(), http.MethodGet, "/api/info/"+infoToken, http.NoBody)
	rec := httptest.NewRecorder()
	app.server.Handler.ServeHTTP(rec, req)

	assert.Equal(t, http.StatusServiceUnavailable, rec.Code)
	assert.JSONEq(t, `{"error":{"code":"service_unavailable","message":"Service Unavailable","status_code":503}}`, rec.Body.String())
	assert.Equal(t, int32(1), connector.attempts.Load())
	select {
	case observed := <-attempts:
		assert.Equal(t, "http:/api/info/:token", observed.attempt.Operation.String())
		assert.NotContains(t, observed.attempt.Operation.String(), infoToken)
		assert.NotEmpty(t, logger.FromContext(observed.ctx).GetID(), "request context must reach the connector observer")
		require.ErrorIs(t, observed.attempt.Err, connectErr)
	default:
		t.Fatal("first connection attempt was not observed")
	}
}

func TestApplicationAssembly_BlockingDatabaseRequestHasFiveSecondBudgetWhileDatabaseFreeTrafficStaysAvailable(t *testing.T) {
	staticDir := t.TempDir()
	require.NoError(t, os.WriteFile(filepath.Join(staticDir, "index.html"), []byte("<html>shell</html>"), 0o600))

	synctest.Test(t, func(t *testing.T) {
		connector := &blockingAssemblyConnector{started: make(chan context.Context)}
		cfg := assemblyConfig()
		cfg.StaticDir = staticDir
		app, err := newApplication(context.Background(), cfg, applicationDependencies{
			connector:     connector,
			mailgunClient: &assemblyMailgun{},
			log:           logger.NewWithLevel("error"),
		})
		require.NoError(t, err)
		defer closeApplication(t, app)

		startedAt := time.Now()
		result := make(chan *httptest.ResponseRecorder)
		go func() {
			req := httptest.NewRequestWithContext(context.Background(), http.MethodGet, "/api/events", http.NoBody)
			rec := httptest.NewRecorder()
			app.server.Handler.ServeHTTP(rec, req)
			result <- rec
		}()

		connectCtx := <-connector.started
		deadline, ok := connectCtx.Deadline()
		require.True(t, ok)
		assert.Equal(t, database.HTTPWorkBudget, deadline.Sub(startedAt))

		// The blocked request does not serialize unrelated database-free work.
		for path, wantStatus := range map[string]int{
			"/api/health":  http.StatusOK,
			"/story":       http.StatusOK,
			"/not-a-route": http.StatusNotFound,
		} {
			req := httptest.NewRequestWithContext(context.Background(), http.MethodGet, path, http.NoBody)
			rec := httptest.NewRecorder()
			app.server.Handler.ServeHTTP(rec, req)
			assert.Equal(t, wantStatus, rec.Code, path)
		}

		time.Sleep(database.HTTPWorkBudget - time.Nanosecond)
		select {
		case <-result:
			t.Fatal("database request returned before its five-second budget expired")
		default:
		}

		time.Sleep(time.Nanosecond)
		synctest.Wait()
		rec := <-result
		assert.Equal(t, database.HTTPWorkBudget, time.Since(startedAt))
		assert.Equal(t, http.StatusServiceUnavailable, rec.Code)
		assert.JSONEq(t, `{"error":{"code":"service_unavailable","message":"Service Unavailable","status_code":503}}`, rec.Body.String())
		assert.Equal(t, int32(1), connector.attempts.Load())
	})
}

type synchronizedBuffer struct {
	mu sync.Mutex
	b  bytes.Buffer
}

func (b *synchronizedBuffer) Write(p []byte) (int, error) {
	b.mu.Lock()
	defer b.mu.Unlock()
	return b.b.Write(p)
}

func (b *synchronizedBuffer) String() string {
	b.mu.Lock()
	defer b.mu.Unlock()
	return b.b.String()
}

type loggedEvent struct {
	Level   string         `json:"level"`
	ID      string         `json:"id"`
	Message string         `json:"message"`
	Method  string         `json:"method"`
	Path    string         `json:"path"`
	Route   string         `json:"route"`
	Version string         `json:"version"`
	Data    map[string]any `json:"data"`
}

func firstConnectionLog(t *testing.T, output string) loggedEvent {
	t.Helper()
	for _, line := range strings.Split(strings.TrimSpace(output), "\n") {
		var event loggedEvent
		require.NoError(t, json.Unmarshal([]byte(line), &event))
		if event.Message == "first database connection attempt" {
			return event
		}
	}
	t.Fatal("first database connection log was not emitted")
	return loggedEvent{}
}

func TestProductionApplicationDependencies_FirstConnectionLogsBothOutcomesSafely(t *testing.T) {
	for _, tt := range []struct {
		name       string
		err        error
		wantLevel  string
		wantResult string
	}{
		{name: "success", wantLevel: "info", wantResult: "connected"},
		{
			name:       "failure",
			err:        errors.New("postgres://user:password@example.test/private?token=secret"),
			wantLevel:  "warn",
			wantResult: "failed",
		},
	} {
		t.Run(tt.name, func(t *testing.T) {
			var output synchronizedBuffer
			previous := logger.Output()
			logger.SetOutput(&output)
			t.Cleanup(func() { logger.SetOutput(previous) })

			log := logger.NewWithLevel("info").ID("request-id")
			deps := productionApplicationDependencies(&config.Config{
				DatabaseURL: "postgres://localhost/test?sslmode=disable",
			}, log)
			deps.observeFirstConnection(log.WithContext(context.Background()), database.FirstConnectionAttempt{
				Operation: database.HTTPRouteOperation("/api/info/:token"),
				Err:       tt.err,
			})

			event := firstConnectionLog(t, output.String())
			assert.Equal(t, tt.wantLevel, event.Level)
			assert.Equal(t, "request-id", event.ID)
			assert.Equal(t, "http:/api/info/:token", event.Data["operation"])
			assert.Equal(t, tt.wantResult, event.Data["outcome"])
			assert.NotContains(t, output.String(), "password")
			assert.NotContains(t, output.String(), "token=secret")
		})
	}
}

func TestProductionApplicationDependencies_FirstConnectionLogStripsUntrustedRequestFields(t *testing.T) {
	var output synchronizedBuffer
	previous := logger.Output()
	logger.SetOutput(&output)
	t.Cleanup(func() { logger.SetOutput(previous) })

	cfg := assemblyConfig()
	cfg.DatabaseURL = "postgres://localhost/test?sslmode=disable"
	baseLog := logger.NewWithLevel("info")
	deps := productionApplicationDependencies(cfg, baseLog)
	deps.connector = &assemblyConnector{err: errors.New("connection failed")}
	deps.mailgunClient = &assemblyMailgun{}
	app, err := newApplication(context.Background(), cfg, deps)
	require.NoError(t, err)
	defer closeApplication(t, app)

	const infoToken = "sensitiveinfotoken123456789012"
	req := httptest.NewRequestWithContext(context.Background(), http.MethodGet, "/api/info/"+infoToken, http.NoBody)
	req.Header.Set("x-log-level", "error")
	req.Header.Set("x-version", "caller-controlled-secret")
	rec := httptest.NewRecorder()
	app.server.Handler.ServeHTTP(rec, req)

	assert.Equal(t, http.StatusServiceUnavailable, rec.Code)
	event := firstConnectionLog(t, output.String())
	assert.Equal(t, "warn", event.Level, "the request log level must not suppress attribution")
	assert.NotEmpty(t, event.ID)
	assert.Empty(t, event.Method)
	assert.Empty(t, event.Path)
	assert.Empty(t, event.Route)
	assert.Empty(t, event.Version)
	assert.Equal(t, "http:/api/info/:token", event.Data["operation"])
	eventJSON, err := json.Marshal(event)
	require.NoError(t, err)
	assert.NotContains(t, string(eventJSON), infoToken)
	assert.NotContains(t, string(eventJSON), "caller-controlled-secret")
}

func TestApplicationAssembly_RequiresConnector(t *testing.T) {
	app, err := newApplication(context.Background(), assemblyConfig(), applicationDependencies{
		mailgunClient: &assemblyMailgun{},
		log:           logger.NewWithLevel("error"),
	})

	assert.Nil(t, app)
	assert.EqualError(t, err, "open database handle: database connector is required")
}

func TestApplicationAssembly_RequiresConfiguredMailgunClient(t *testing.T) {
	connector := &assemblyConnector{err: errors.New("unused")}
	app, err := newApplication(context.Background(), assemblyConfig(), applicationDependencies{
		connector: connector,
		log:       logger.NewWithLevel("error"),
	})

	assert.Nil(t, app)
	require.EqualError(t, err, "mailgun client is required when email delivery is configured")
	assert.Zero(t, connector.attempts.Load())
}

func TestCachedPort(t *testing.T) {
	t.Run("missing file is not a cached port", func(t *testing.T) {
		t.Setenv("API_PORT_FILE", filepath.Join(t.TempDir(), "absent.port"))
		_, ok := cachedPort()
		assert.False(t, ok)
	})

	cases := []struct {
		name    string
		content string
		want    int
		wantOK  bool
	}{
		{"valid port", "8400", 8400, true},
		{"trailing whitespace is trimmed", "8400\n", 8400, true},
		{"zero is rejected", "0", 0, false},
		{"negative is rejected", "-1", 0, false},
		{"non-numeric is rejected", "abc", 0, false},
		{"empty is rejected", "", 0, false},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			path := filepath.Join(t.TempDir(), "api.port")
			require.NoError(t, os.WriteFile(path, []byte(tc.content), 0o600))
			t.Setenv("API_PORT_FILE", path)
			got, ok := cachedPort()
			assert.Equal(t, tc.wantOK, ok)
			if tc.wantOK {
				assert.Equal(t, tc.want, got)
			}
		})
	}
}
