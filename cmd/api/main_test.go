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
	"sync/atomic"
	"testing"
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
		observeFirstConnection: func(database.FirstConnectionAttempt) {
			observed.Add(1)
		},
		mailgunClient: &assemblyMailgun{},
		log:           logger.NewWithLevel("error"),
	})
	require.NoError(t, err)
	defer closeApplication(t, app)

	// Give the supervisor an opportunity to enter its idle wait. It has no
	// startup wake or timer, so this must not call the connector.
	time.Sleep(20 * time.Millisecond)
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
	attempts := make(chan database.FirstConnectionAttempt, 1)
	app, err := newApplication(context.Background(), assemblyConfig(), applicationDependencies{
		connector: connector,
		observeFirstConnection: func(attempt database.FirstConnectionAttempt) {
			attempts <- attempt
		},
		mailgunClient: &assemblyMailgun{},
		log:           logger.NewWithLevel("error"),
	})
	require.NoError(t, err)
	defer closeApplication(t, app)

	req := httptest.NewRequestWithContext(context.Background(), http.MethodGet, "/api/events?party_id=secret", http.NoBody)
	rec := httptest.NewRecorder()
	app.server.Handler.ServeHTTP(rec, req)

	assert.Equal(t, http.StatusInternalServerError, rec.Code)
	assert.Equal(t, int32(1), connector.attempts.Load())
	select {
	case attempt := <-attempts:
		assert.Equal(t, "http:/api/events", attempt.Operation.String())
		require.ErrorIs(t, attempt.Err, connectErr)
	default:
		t.Fatal("first connection attempt was not observed")
	}
}

func TestProductionApplicationDependencies_FirstConnectionLogIsSafe(t *testing.T) {
	var output bytes.Buffer
	previous := logger.Output()
	logger.SetOutput(&output)
	t.Cleanup(func() { logger.SetOutput(previous) })

	log := logger.NewWithLevel("info")
	deps := productionApplicationDependencies(&config.Config{
		DatabaseURL: "postgres://localhost/test?sslmode=disable",
	}, log)
	deps.observeFirstConnection(database.FirstConnectionAttempt{
		Operation: database.HTTPRouteOperation("/api/info/:token"),
		Err:       errors.New("postgres://user:password@example.test/private?token=secret"),
	})

	var event struct {
		Message string         `json:"message"`
		Data    map[string]any `json:"data"`
	}
	require.NoError(t, json.Unmarshal(output.Bytes(), &event))
	assert.Equal(t, "first database connection attempt", event.Message)
	assert.Equal(t, "http:/api/info/:token", event.Data["operation"])
	assert.Equal(t, "failed", event.Data["outcome"])
	assert.NotContains(t, output.String(), "password")
	assert.NotContains(t, output.String(), "token=secret")
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
