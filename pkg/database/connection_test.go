package database

import (
	"context"
	"database/sql/driver"
	"errors"
	"strings"
	"sync"
	"sync/atomic"
	"testing"
	"time"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

type stubConnector struct {
	attempts atomic.Int32
	err      error
	conn     driver.Conn
}

func (c *stubConnector) Connect(context.Context) (driver.Conn, error) {
	c.attempts.Add(1)
	return c.conn, c.err
}

func (c *stubConnector) Driver() driver.Driver { return stubDriver{} }

type stubDriver struct{}

func (stubDriver) Open(string) (driver.Conn, error) {
	return nil, errors.New("stub driver cannot open by name")
}

type stubConn struct{}

func (*stubConn) Prepare(string) (driver.Stmt, error) {
	return nil, errors.New("stub connection cannot prepare")
}
func (*stubConn) Close() error              { return nil }
func (*stubConn) Begin() (driver.Tx, error) { return nil, errors.New("stub connection cannot begin") }

type blockingConnector struct {
	attempts atomic.Int32
	err      error
	started  chan struct{}
	release  chan struct{}
}

func (c *blockingConnector) Connect(context.Context) (driver.Conn, error) {
	c.attempts.Add(1)
	c.started <- struct{}{}
	<-c.release
	return nil, c.err
}

func (c *blockingConnector) Driver() driver.Driver { return stubDriver{} }

type closingConnector struct {
	stubConnector
	closes   atomic.Int32
	closeErr error
}

func (c *closingConnector) Close() error {
	c.closes.Add(1)
	return c.closeErr
}

type recordingPool struct {
	maxOpen int
	maxIdle int
	idleFor time.Duration
}

func (p *recordingPool) SetMaxOpenConns(n int)              { p.maxOpen = n }
func (p *recordingPool) SetMaxIdleConns(n int)              { p.maxIdle = n }
func (p *recordingPool) SetConnMaxIdleTime(d time.Duration) { p.idleFor = d }

func TestConfigurePool_UsesConservativeProductionSettings(t *testing.T) {
	pool := &recordingPool{}
	configurePool(pool)

	assert.Equal(t, 5, pool.maxOpen)
	assert.Equal(t, 1, pool.maxIdle)
	assert.Equal(t, time.Minute, pool.idleFor)
}

func TestNewWithConnector_IsLazyAndObservesFirstFailedAttemptOnce(t *testing.T) {
	connectErr := errors.New("connection failed")
	connector := &stubConnector{err: connectErr}
	var mu sync.Mutex
	var attempts []FirstConnectionAttempt

	db, err := NewWithConnector(connector, func(_ context.Context, attempt FirstConnectionAttempt) {
		mu.Lock()
		attempts = append(attempts, attempt)
		mu.Unlock()
	})
	require.NoError(t, err)
	t.Cleanup(func() { _ = db.Close() })

	assert.Zero(t, connector.attempts.Load(), "constructing the handle must not connect")
	assert.Equal(t, 5, db.Stats().MaxOpenConnections)

	ctx := WithOperation(context.Background(), HTTPRouteOperation("/api/events"))
	require.ErrorIs(t, db.PingContext(ctx), connectErr)
	require.ErrorIs(t, db.PingContext(WithOperation(context.Background(), HTTPRouteOperation("/api/auth/guest/login"))), connectErr)

	assert.Equal(t, int32(2), connector.attempts.Load())
	mu.Lock()
	defer mu.Unlock()
	require.Len(t, attempts, 1)
	assert.Equal(t, "http:/api/events", attempts[0].Operation.String())
	assert.ErrorIs(t, attempts[0].Err, connectErr)
}

func TestNewWithConnector_ObservesFirstConcurrentAttemptExactlyOnce(t *testing.T) {
	const concurrentAttempts = 5
	connectErr := errors.New("connection failed")
	connector := &blockingConnector{
		err:     connectErr,
		started: make(chan struct{}, concurrentAttempts),
		release: make(chan struct{}),
	}
	var observations atomic.Int32
	db, err := NewWithConnector(connector, func(context.Context, FirstConnectionAttempt) {
		observations.Add(1)
	})
	require.NoError(t, err)
	t.Cleanup(func() { _ = db.Close() })

	var wg sync.WaitGroup
	errs := make(chan error, concurrentAttempts)
	for range concurrentAttempts {
		wg.Add(1)
		go func() {
			defer wg.Done()
			errs <- db.PingContext(WithOperation(context.Background(), HTTPRouteOperation("/api/events")))
		}()
	}
	for range concurrentAttempts {
		select {
		case <-connector.started:
		case <-time.After(time.Second):
			t.Fatal("connection attempts did not overlap")
		}
	}
	close(connector.release)
	wg.Wait()
	close(errs)

	for err := range errs {
		require.ErrorIs(t, err, connectErr)
	}
	assert.Equal(t, int32(concurrentAttempts), connector.attempts.Load())
	assert.Equal(t, int32(1), observations.Load())
}

func TestNewWithConnector_ObservesFirstSuccessfulAttempt(t *testing.T) {
	connector := &stubConnector{conn: &stubConn{}}
	var attempts []FirstConnectionAttempt
	db, err := NewWithConnector(connector, func(_ context.Context, attempt FirstConnectionAttempt) {
		attempts = append(attempts, attempt)
	})
	require.NoError(t, err)
	t.Cleanup(func() { _ = db.Close() })

	ctx := WithOperation(context.Background(), EmailWorkerOperation())
	require.NoError(t, db.PingContext(ctx))
	require.NoError(t, db.PingContext(ctx))

	assert.Equal(t, int32(1), connector.attempts.Load(), "the second ping reuses the shared idle connection")
	require.Len(t, attempts, 1)
	assert.Equal(t, "email_worker", attempts[0].Operation.String())
	assert.NoError(t, attempts[0].Err)
}

func TestNewWithConnector_ClosePreservesConnectorLifecycleWithoutConnecting(t *testing.T) {
	t.Run("success", func(t *testing.T) {
		connector := &closingConnector{}
		db, err := NewWithConnector(connector, nil)
		require.NoError(t, err)

		require.NoError(t, db.Close())
		assert.Zero(t, connector.attempts.Load())
		assert.Equal(t, int32(1), connector.closes.Load())
	})

	t.Run("connector error", func(t *testing.T) {
		closeErr := errors.New("connector close failed")
		connector := &closingConnector{closeErr: closeErr}
		db, err := NewWithConnector(connector, nil)
		require.NoError(t, err)

		require.ErrorIs(t, db.Close(), closeErr)
		assert.Zero(t, connector.attempts.Load())
		assert.Equal(t, int32(1), connector.closes.Load())
	})
}

func TestNewWithConnector_RequiresConnector(t *testing.T) {
	db, err := NewWithConnector(nil, nil)
	assert.Nil(t, db)
	assert.EqualError(t, err, "database connector is required")
}

func TestHTTPRouteOperation_RejectsRawOrUnboundedLabels(t *testing.T) {
	tests := []string{
		"",
		"api/events",
		"/api/events?party_id=secret",
		"https://example.com/api/events",
		"/api/info/%2Fsecret",
		"/api//events",
		"/api/info/sensitiveinfotoken123456789012",
		"/api/admin/guests/019f9533-4e31-7850-ab21-46e1f620a00d",
		"/api/rsvp/ABCDE",
		"/api/rsvp/PEPPER",
		"/api/new-route",
	}
	for _, value := range tests {
		assert.Equal(t, "unattributed", HTTPRouteOperation(value).String(), value)
	}

	bounded := "/" + strings.Repeat("a/", 62) + ":id"
	require.Len(t, bounded, 128)
	assert.Equal(t, "http:"+bounded, HTTPRouteOperation(bounded).String())
	assert.Equal(t, "unattributed", HTTPRouteOperation(bounded+"a").String())

	assert.Equal(t, "http:/api/info/:token", HTTPRouteOperation("/api/info/:token").String())
	assert.Equal(t, "info_metadata", InfoMetadataOperation().String())
	assert.Equal(t, "email_worker", EmailWorkerOperation().String())
	assert.Equal(t, "http:/api/admin/events/:id/rsvps/:guestId", HTTPRouteOperation("/api/admin/events/:id/rsvps/:guestId").String())
}
