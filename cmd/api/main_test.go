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

	"github.com/labstack/echo/v4"
	"github.com/robinjoseph08/golib/logger"
	"github.com/robinjoseph08/golib/pointerutil"
	"github.com/robinjoseph08/robinandmadeline.com/internal/databasetest"
	"github.com/robinjoseph08/robinandmadeline.com/pkg/config"
	"github.com/robinjoseph08/robinandmadeline.com/pkg/database"
	"github.com/robinjoseph08/robinandmadeline.com/pkg/emails"
	"github.com/robinjoseph08/robinandmadeline.com/pkg/events"
	"github.com/robinjoseph08/robinandmadeline.com/pkg/models"
	"github.com/robinjoseph08/robinandmadeline.com/pkg/parties"
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
	if c.attempts.Add(1) > 1 {
		return nil, errors.New("unexpected additional connection attempt")
	}
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

func assemblyStaticDir(t *testing.T) string {
	t.Helper()
	dir := t.TempDir()
	require.NoError(t, os.WriteFile(filepath.Join(dir, "index.html"), []byte("<html><head><title>Robin & Madeline</title></head><body>shell</body></html>"), 0o600))
	require.NoError(t, os.WriteFile(filepath.Join(dir, "robots.txt"), []byte("User-agent: *\n"), 0o600))
	require.NoError(t, os.MkdirAll(filepath.Join(dir, "assets"), 0o700))
	require.NoError(t, os.WriteFile(filepath.Join(dir, "assets", "app-abc123.js"), []byte("asset"), 0o600))
	return dir
}

func TestApplicationAssembly_DatabaseFreeTrafficMakesNoConnectionAttempts(t *testing.T) {
	connector := &assemblyConnector{err: errors.New("database must not be reached")}
	var observed atomic.Int32
	cfg := assemblyConfig()
	cfg.StaticDir = assemblyStaticDir(t)
	cfg.CanonicalHost = "www.robinandmadeline.com"
	app, err := newApplication(context.Background(), cfg, applicationDependencies{
		connector: connector,
		observeFirstConnection: func(context.Context, database.FirstConnectionAttempt) {
			observed.Add(1)
		},
		mailgunClient: &assemblyMailgun{},
		log:           logger.NewWithLevel("error"),
	})
	require.NoError(t, err)
	defer closeApplication(t, app)

	// Application construction and entering the idle supervision loop are both
	// part of production startup. Neither is an email-delivery activation.
	select {
	case <-app.worker.Started():
	case <-time.After(time.Second):
		t.Fatal("email worker did not enter its supervision loop")
	}
	assert.Zero(t, connector.attempts.Load())
	assert.Zero(t, observed.Load())

	tests := []struct {
		name       string
		method     string
		target     string
		host       string
		body       string
		authorize  string
		wantStatus int
		wantBody   string
	}{
		{name: "liveness health", method: http.MethodGet, target: "/api/health?from=fly", host: "fly-internal", wantStatus: http.StatusOK, wantBody: `{"status":"ok"}`},
		{name: "static file", method: http.MethodGet, target: "/robots.txt", host: cfg.CanonicalHost, wantStatus: http.StatusOK},
		{name: "hashed static asset", method: http.MethodGet, target: "/assets/app-abc123.js", host: cfg.CanonicalHost, wantStatus: http.StatusOK},
		{name: "public shell", method: http.MethodGet, target: "/story", host: cfg.CanonicalHost, wantStatus: http.StatusOK},
		{name: "admin login shell", method: http.MethodGet, target: "/admin/login", host: cfg.CanonicalHost, wantStatus: http.StatusOK},
		{name: "canonical redirect", method: http.MethodGet, target: "/story?from=alternate", host: "robeline.co", wantStatus: http.StatusMovedPermanently},
		{name: "unknown document", method: http.MethodGet, target: "/wp-login.php", host: cfg.CanonicalHost, wantStatus: http.StatusNotFound},
		{name: "unknown API", method: http.MethodGet, target: "/api/scanner", host: cfg.CanonicalHost, wantStatus: http.StatusNotFound},
		{name: "missing admin authentication", method: http.MethodGet, target: "/api/admin/parties", host: cfg.CanonicalHost, wantStatus: http.StatusUnauthorized},
		{name: "invalid guest authentication", method: http.MethodGet, target: "/api/guest/rsvp", host: cfg.CanonicalHost, authorize: "Bearer not-a-jwt", wantStatus: http.StatusUnauthorized},
		{name: "config-only admin rejection", method: http.MethodPost, target: "/api/auth/admin/login", host: cfg.CanonicalHost, body: `{"username":"admin","password":"wrong"}`, wantStatus: http.StatusUnauthorized},
		{name: "malformed guest login", method: http.MethodPost, target: "/api/auth/guest/login", host: cfg.CanonicalHost, body: `{"code":`, wantStatus: http.StatusBadRequest},
		{name: "validation-rejected guest login", method: http.MethodPost, target: "/api/auth/guest/login", host: cfg.CanonicalHost, body: `{}`, wantStatus: http.StatusUnprocessableEntity},
		{name: "HEAD info metadata", method: http.MethodHead, target: "/i/sensitiveinfotoken123456789012", host: cfg.CanonicalHost, wantStatus: http.StatusOK},
		{name: "short info token", method: http.MethodGet, target: "/i/short", host: cfg.CanonicalHost, wantStatus: http.StatusOK},
		{name: "uppercase info token", method: http.MethodGet, target: "/i/Sensitiveinfotoken123456789012", host: cfg.CanonicalHost, wantStatus: http.StatusOK},
		{name: "symbol in info token", method: http.MethodGet, target: "/i/sensitive-info-token-123456789", host: cfg.CanonicalHost, wantStatus: http.StatusOK},
		{name: "encoded info token character", method: http.MethodGet, target: "/i/%73ensitiveinfotoken123456789012", host: cfg.CanonicalHost, wantStatus: http.StatusOK},
		{name: "extra info path segment", method: http.MethodGet, target: "/i/sensitiveinfotoken123456789012/extra", host: cfg.CanonicalHost, wantStatus: http.StatusNotFound},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			var body *strings.Reader
			if tt.body == "" {
				body = strings.NewReader("")
			} else {
				body = strings.NewReader(tt.body)
			}
			req := httptest.NewRequestWithContext(context.Background(), tt.method, tt.target, body)
			req.Host = tt.host
			if tt.body != "" {
				req.Header.Set(echo.HeaderContentType, echo.MIMEApplicationJSON)
			}
			if tt.authorize != "" {
				req.Header.Set(echo.HeaderAuthorization, tt.authorize)
			}
			rec := httptest.NewRecorder()
			app.server.Handler.ServeHTTP(rec, req)
			assert.Equal(t, tt.wantStatus, rec.Code)
			if tt.wantBody != "" {
				assert.JSONEq(t, tt.wantBody, rec.Body.String())
			}
			assert.Zero(t, connector.attempts.Load())
			assert.Zero(t, observed.Load())
		})
	}
}

func TestApplicationAssembly_IdleSupervisionDoesNotPoll(t *testing.T) {
	staticDir := assemblyStaticDir(t)

	synctest.Test(t, func(t *testing.T) {
		connector := &assemblyConnector{err: errors.New("database must not be reached")}
		cfg := assemblyConfig()
		cfg.StaticDir = staticDir
		app, err := newApplication(context.Background(), cfg, applicationDependencies{
			connector:     connector,
			mailgunClient: &assemblyMailgun{},
			log:           logger.NewWithLevel("error"),
		})
		require.NoError(t, err)
		defer closeApplication(t, app)

		<-app.worker.Started()
		time.Sleep(24 * time.Hour)
		synctest.Wait()
		assert.Zero(t, connector.attempts.Load())
	})
}

func TestApplicationAssembly_DatabaseBackedOperationsAttemptConnection(t *testing.T) {
	const infoToken = "sensitiveinfotoken123456789012"
	connectErr := errors.New("physical connection failed")
	tests := []struct {
		name          string
		wantOperation string
		trigger       func(*testing.T, *application)
	}{
		{
			name:          "Schedule read",
			wantOperation: "http:/api/events",
			trigger: func(t *testing.T, app *application) {
				req := httptest.NewRequestWithContext(context.Background(), http.MethodGet, "/api/events", http.NoBody)
				rec := httptest.NewRecorder()
				app.server.Handler.ServeHTTP(rec, req)
				assert.Equal(t, http.StatusServiceUnavailable, rec.Code)
			},
		},
		{
			name:          "well-formed RSVP Code lookup",
			wantOperation: "http:/api/auth/guest/login",
			trigger: func(t *testing.T, app *application) {
				req := httptest.NewRequestWithContext(context.Background(), http.MethodPost, "/api/auth/guest/login", strings.NewReader(`{"code":"ABCDE"}`))
				req.Header.Set(echo.HeaderContentType, echo.MIMEApplicationJSON)
				rec := httptest.NewRecorder()
				app.server.Handler.ServeHTTP(rec, req)
				assert.Equal(t, http.StatusServiceUnavailable, rec.Code)
			},
		},
		{
			name:          "eligible Info Collection metadata",
			wantOperation: "info_metadata",
			trigger: func(t *testing.T, app *application) {
				req := httptest.NewRequestWithContext(context.Background(), http.MethodGet, "/i/"+infoToken, http.NoBody)
				rec := httptest.NewRecorder()
				app.server.Handler.ServeHTTP(rec, req)
				assert.Equal(t, http.StatusOK, rec.Code, "metadata failures keep the generic shell available")
			},
		},
		{
			name:          "authenticated email administration",
			wantOperation: "email_worker",
			trigger: func(t *testing.T, app *application) {
				loginReq := httptest.NewRequestWithContext(context.Background(), http.MethodPost, "/api/auth/admin/login", strings.NewReader(`{"username":"admin","password":"password"}`))
				loginReq.Header.Set(echo.HeaderContentType, echo.MIMEApplicationJSON)
				loginRec := httptest.NewRecorder()
				app.server.Handler.ServeHTTP(loginRec, loginReq)
				require.Equal(t, http.StatusOK, loginRec.Code)
				var login struct {
					Token string `json:"token"`
				}
				require.NoError(t, json.Unmarshal(loginRec.Body.Bytes(), &login))

				req := httptest.NewRequestWithContext(context.Background(), http.MethodGet, "/api/admin/emails/shell-preview", http.NoBody)
				req.Header.Set(echo.HeaderAuthorization, "Bearer "+login.Token)
				rec := httptest.NewRecorder()
				app.server.Handler.ServeHTTP(rec, req)
				assert.Equal(t, http.StatusOK, rec.Code)
			},
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			type observation struct {
				ctx     context.Context
				attempt database.FirstConnectionAttempt
			}
			connector := &assemblyConnector{err: connectErr}
			attempts := make(chan observation, 1)
			cfg := assemblyConfig()
			cfg.StaticDir = assemblyStaticDir(t)
			app, err := newApplication(context.Background(), cfg, applicationDependencies{
				connector: connector,
				observeFirstConnection: func(ctx context.Context, attempt database.FirstConnectionAttempt) {
					attempts <- observation{ctx: ctx, attempt: attempt}
				},
				mailgunClient: &assemblyMailgun{},
				log:           logger.NewWithLevel("error"),
			})
			require.NoError(t, err)
			defer closeApplication(t, app)

			tt.trigger(t, app)
			select {
			case observed := <-attempts:
				assert.Equal(t, tt.wantOperation, observed.attempt.Operation.String())
				assert.NotContains(t, observed.attempt.Operation.String(), infoToken)
				require.ErrorIs(t, observed.attempt.Err, connectErr)
				if strings.HasPrefix(tt.wantOperation, "http:") {
					assert.NotEmpty(t, logger.FromContext(observed.ctx).GetID(), "request context must reach the connector observer")
				}
			case <-time.After(time.Second):
				t.Fatal("physical connection attempt was not observed")
			}
			assert.Equal(t, int32(1), connector.attempts.Load())
		})
	}
}

func TestApplicationAssembly_DatabaseBackedFlowsUseLiveCommittedData(t *testing.T) {
	fixtureDB, dsn := databasetest.NewIsolatedWithDSN(t, "robinandmadeline_application_test")
	databasetest.Truncate(t, fixtureDB, "events", "parties", "email_sends")

	partyService := parties.NewService(fixtureDB)
	party, err := partyService.CreatePartyWithGuest(context.Background(), parties.CreatePartyWithGuestPayload{
		Name:           "The Freshes",
		Side:           models.SideRobin,
		Relation:       models.RelationFriend,
		Circle:         []string{},
		InvitationType: models.InvitationDigital,
		RSVPCode:       pointerutil.String("FRESH"),
		Guest: parties.FirstGuestPayload{
			FullName: "Robin Fresh",
			Tags:     []string{},
		},
	})
	require.NoError(t, err)

	eventService := events.NewService(fixtureDB)
	event, err := eventService.CreateEvent(context.Background(), events.CreateEventPayload{
		Name:      "Original Reception",
		Location:  pointerutil.String("Original Hall"),
		Date:      "2026-10-17",
		StartTime: pointerutil.String("17:00"),
		IsPublic:  true,
	})
	require.NoError(t, err)

	cfg := assemblyConfig()
	cfg.DatabaseURL = dsn
	cfg.StaticDir = assemblyStaticDir(t)
	var observed atomic.Int32
	app, err := newApplication(context.Background(), cfg, applicationDependencies{
		connector: database.NewConnector(cfg),
		observeFirstConnection: func(context.Context, database.FirstConnectionAttempt) {
			observed.Add(1)
		},
		mailgunClient: &assemblyMailgun{},
		log:           logger.NewWithLevel("error"),
	})
	require.NoError(t, err)
	defer closeApplication(t, app)

	readSchedule := func() events.ListScheduleEventsResponse {
		req := httptest.NewRequestWithContext(context.Background(), http.MethodGet, "/api/events", http.NoBody)
		rec := httptest.NewRecorder()
		app.server.Handler.ServeHTTP(rec, req)
		require.Equal(t, http.StatusOK, rec.Code)
		var response events.ListScheduleEventsResponse
		require.NoError(t, json.Unmarshal(rec.Body.Bytes(), &response))
		return response
	}

	first := readSchedule()
	require.Len(t, first.Items, 1)
	assert.Equal(t, "Original Reception", first.Items[0].Name)
	assert.Equal(t, pointerutil.String("Original Hall"), first.Items[0].Location)

	_, err = eventService.UpdateEvent(context.Background(), event.ID, events.UpdateEventPayload{
		Name:      "Committed Reception",
		Location:  pointerutil.String("Committed Hall"),
		Date:      "2026-10-18",
		StartTime: pointerutil.String("18:30"),
		IsPublic:  true,
	})
	require.NoError(t, err)

	second := readSchedule()
	require.Len(t, second.Items, 1)
	assert.Equal(t, event.ID, second.Items[0].ID)
	assert.Equal(t, "Committed Reception", second.Items[0].Name)
	assert.Equal(t, pointerutil.String("Committed Hall"), second.Items[0].Location)
	assert.Equal(t, "2026-10-18", second.Items[0].Date)
	assert.Equal(t, pointerutil.String("18:30"), second.Items[0].StartTime)

	loginReq := httptest.NewRequestWithContext(context.Background(), http.MethodPost, "/api/auth/guest/login", strings.NewReader(`{"code":"FRESH"}`))
	loginReq.Header.Set(echo.HeaderContentType, echo.MIMEApplicationJSON)
	loginRec := httptest.NewRecorder()
	app.server.Handler.ServeHTTP(loginRec, loginReq)
	assert.Equal(t, http.StatusOK, loginRec.Code)
	assert.Contains(t, loginRec.Body.String(), `"token"`)

	metadataReq := httptest.NewRequestWithContext(context.Background(), http.MethodGet, "/i/"+party.InfoToken, http.NoBody)
	metadataRec := httptest.NewRecorder()
	app.server.Handler.ServeHTTP(metadataRec, metadataReq)
	assert.Equal(t, http.StatusOK, metadataRec.Code)
	assert.Contains(t, metadataRec.Body.String(), "<title>Robin&#39;s Info · Robin &amp; Madeline</title>")
	assert.Equal(t, int32(1), observed.Load(), "the integrated application emits one event for its first physical connection")
}

func TestApplicationAssembly_BlockingDatabaseRequestHasFiveSecondBudgetWhileDatabaseFreeTrafficStaysAvailable(t *testing.T) {
	staticDir := assemblyStaticDir(t)

	synctest.Test(t, func(t *testing.T) {
		connector := &blockingAssemblyConnector{started: make(chan context.Context)}
		cfg := assemblyConfig()
		cfg.StaticDir = staticDir
		cfg.CanonicalHost = "www.robinandmadeline.com"
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
			req := httptest.NewRequestWithContext(context.Background(), http.MethodPost, "/api/auth/guest/login", strings.NewReader(`{"code":"ABCDE"}`))
			req.Host = cfg.CanonicalHost
			req.Header.Set(echo.HeaderContentType, echo.MIMEApplicationJSON)
			rec := httptest.NewRecorder()
			app.server.Handler.ServeHTTP(rec, req)
			result <- rec
		}()

		connectCtx := <-connector.started
		deadline, ok := connectCtx.Deadline()
		require.True(t, ok)
		assert.Equal(t, database.HTTPWorkBudget, deadline.Sub(startedAt))

		// The blocked request does not serialize unrelated database-free work.
		for _, tt := range []struct {
			path       string
			host       string
			wantStatus int
		}{
			{path: "/api/health", host: "fly-internal", wantStatus: http.StatusOK},
			{path: "/robots.txt", host: cfg.CanonicalHost, wantStatus: http.StatusOK},
			{path: "/assets/app-abc123.js", host: cfg.CanonicalHost, wantStatus: http.StatusOK},
			{path: "/story", host: "robeline.co", wantStatus: http.StatusMovedPermanently},
			{path: "/not-a-route", host: cfg.CanonicalHost, wantStatus: http.StatusNotFound},
			{path: "/api/not-a-route", host: cfg.CanonicalHost, wantStatus: http.StatusNotFound},
		} {
			req := httptest.NewRequestWithContext(context.Background(), http.MethodGet, tt.path, http.NoBody)
			req.Host = tt.host
			rec := httptest.NewRecorder()
			app.server.Handler.ServeHTTP(rec, req)
			assert.Equal(t, tt.wantStatus, rec.Code, tt.path)
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

func TestApplicationAssembly_FirstConnectionTelemetryIsEmittedOnceWithSafeAttribution(t *testing.T) {
	var output synchronizedBuffer
	previous := logger.Output()
	logger.SetOutput(&output)
	t.Cleanup(func() { logger.SetOutput(previous) })

	cfg := assemblyConfig()
	cfg.DatabaseURL = "postgres://localhost/test?sslmode=disable"
	baseLog := logger.NewWithLevel("info")
	deps := productionApplicationDependencies(cfg, baseLog)
	require.NotNil(t, deps.connector)
	require.NotNil(t, deps.mailgunClient)
	connector := &assemblyConnector{err: errors.New("connection failed")}
	deps.connector = connector
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

	secondReq := httptest.NewRequestWithContext(context.Background(), http.MethodGet, "/api/events", http.NoBody)
	secondRec := httptest.NewRecorder()
	app.server.Handler.ServeHTTP(secondRec, secondReq)
	assert.Equal(t, http.StatusServiceUnavailable, secondRec.Code)
	assert.Equal(t, int32(2), connector.attempts.Load())
	assert.Equal(t, 1, strings.Count(output.String(), `"message":"first database connection attempt"`), "the integrated observer must emit exactly once across physical attempts")

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
