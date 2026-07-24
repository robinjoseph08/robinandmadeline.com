package database

import (
	"context"
	"database/sql/driver"
	"errors"
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
	}
	for _, value := range tests {
		assert.Equal(t, "unattributed", HTTPRouteOperation(value).String(), value)
	}

	assert.Equal(t, "http:/api/info/:token", HTTPRouteOperation("/api/info/:token").String())
	assert.Equal(t, "info_metadata", InfoMetadataOperation().String())
	assert.Equal(t, "email_worker", EmailWorkerOperation().String())
	assert.Equal(t, "http:/api/admin/events/:id/rsvps/:guestId", HTTPRouteOperation("/api/admin/events/:id/rsvps/:guestId").String())
}
