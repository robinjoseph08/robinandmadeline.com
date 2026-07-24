package database

import (
	"context"
	"database/sql/driver"
	"errors"
	"io"
	"net"
	"os"
	"strings"
	"sync"
	"sync/atomic"
	"testing"
	"testing/synctest"
	"time"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"github.com/uptrace/bun/driver/pgdriver"
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

type recordingTx struct {
	commits   atomic.Int32
	rollbacks atomic.Int32
}

func (tx *recordingTx) Commit() error {
	tx.commits.Add(1)
	return nil
}
func (tx *recordingTx) Rollback() error {
	tx.rollbacks.Add(1)
	return nil
}

type recordingCommitExecer struct {
	ctx   context.Context
	query string
	args  []driver.NamedValue
}

func (e *recordingCommitExecer) ExecContext(ctx context.Context, query string, args []driver.NamedValue) (driver.Result, error) {
	e.ctx = ctx
	e.query = query
	e.args = args
	return driver.RowsAffected(0), nil
}

type stubPostgresError struct {
	severity string
}

func (err stubPostgresError) Error() string { return "postgres " + err.severity }
func (err stubPostgresError) Field(field byte) string {
	if field == 'V' {
		return err.severity
	}
	return ""
}

type blockingRows struct {
	release chan struct{}
}

func (*blockingRows) Columns() []string { return []string{"value"} }
func (*blockingRows) Close() error      { return nil }
func (rows *blockingRows) Next([]driver.Value) error {
	<-rows.release
	return driver.ErrBadConn
}

type blockingConnector struct {
	attempts atomic.Int32
	err      error
	started  chan struct{}
	release  chan struct{}
}

type cancellationErrorConnector struct{}

func (*cancellationErrorConnector) Connect(ctx context.Context) (driver.Conn, error) {
	<-ctx.Done()
	return nil, &net.OpError{Op: "read", Net: "tcp", Err: os.ErrDeadlineExceeded}
}

func (*cancellationErrorConnector) Driver() driver.Driver { return stubDriver{} }

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

func TestNewWithConnector_MarksOnlyPhysicalConnectionFailures(t *testing.T) {
	connectErr := errors.New("dial failed")
	db, err := NewWithConnector(&stubConnector{err: connectErr}, nil)
	require.NoError(t, err)
	t.Cleanup(func() { _ = db.Close() })

	err = db.PingContext(context.Background())
	require.ErrorIs(t, err, connectErr)
	assert.True(t, IsConnectionFailure(err))
	assert.False(t, IsConnectionFailure(errors.New("ordinary SQL error")))
}

func TestObservedConnector_PreservesContextCancellationOverDriverError(t *testing.T) {
	connector := &observedConnector{connector: &cancellationErrorConnector{}}

	parent, cancelParent := context.WithCancel(context.Background())
	cancelParent()
	_, err := connector.Connect(parent)
	require.ErrorIs(t, err, context.Canceled)
	assert.False(t, IsConnectionFailure(err))

	synctest.Test(t, func(t *testing.T) {
		ctx, cancelBudget := WithHTTPWorkBudget(context.Background())
		defer cancelBudget()
		_, err := connector.Connect(ctx)
		require.ErrorIs(t, err, context.DeadlineExceeded)
		assert.True(t, HTTPWorkBudgetExceeded(ctx))
		assert.False(t, IsConnectionFailure(err))
	})
}

func TestObservedConnector_WrapsPGDriverConnection(t *testing.T) {
	connector := &observedConnector{connector: &stubConnector{conn: &pgdriver.Conn{}}}

	conn, err := connector.Connect(context.Background())
	require.NoError(t, err)
	assert.IsType(t, &contextualPGConn{}, conn)
}

func TestContextualTx_CommitAndRollbackUseTransactionContext(t *testing.T) {
	for _, operation := range []string{"COMMIT", "ROLLBACK"} {
		t.Run(operation, func(t *testing.T) {
			ctx, cancel := context.WithTimeout(context.Background(), HTTPWorkBudget)
			defer cancel()
			rawTx := &recordingTx{}
			execer := &recordingCommitExecer{}
			tx := &contextualTx{Tx: rawTx, ctx: ctx, execer: execer}

			var err error
			if operation == "COMMIT" {
				err = tx.Commit()
			} else {
				err = tx.Rollback()
			}
			require.NoError(t, err)
			assert.Equal(t, ctx, execer.ctx)
			assert.Equal(t, operation, execer.query)
			assert.Nil(t, execer.args)
			assert.Zero(t, rawTx.commits.Load(), "the background-context driver commit must not run")
			assert.Zero(t, rawTx.rollbacks.Load(), "the background-context driver rollback must not run")
		})
	}
}

func TestContextualRows_StopsBlockedIterationAtBudget(t *testing.T) {
	synctest.Test(t, func(t *testing.T) {
		ctx, cancel := WithHTTPWorkBudget(context.Background())
		defer cancel()
		rawRows := &blockingRows{release: make(chan struct{})}
		var closeOnce sync.Once
		rows := newContextualRows(ctx, rawRows, func() error {
			closeOnce.Do(func() { close(rawRows.release) })
			return nil
		})

		startedAt := time.Now()
		err := rows.Next(make([]driver.Value, 1))
		require.ErrorIs(t, err, context.DeadlineExceeded)
		assert.Equal(t, HTTPWorkBudget, time.Since(startedAt))
		require.NoError(t, rows.Close())
	})
}

func TestNormalizeDatabaseError_MarksOnlyTransportFailures(t *testing.T) {
	for _, err := range []error{
		driver.ErrBadConn,
		io.EOF,
		io.ErrUnexpectedEOF,
		stubPostgresError{severity: "FATAL"},
		stubPostgresError{severity: "PANIC"},
	} {
		assert.True(t, IsConnectionFailure(normalizeDatabaseError(context.Background(), err)))
	}
	assert.False(t, IsConnectionFailure(normalizeDatabaseError(context.Background(), stubPostgresError{severity: "ERROR"})))
	assert.False(t, IsConnectionFailure(normalizeDatabaseError(context.Background(), errors.New("ordinary SQL error"))))
}

func TestHTTPWorkBudget_HasOneExactFiveSecondDeadline(t *testing.T) {
	synctest.Test(t, func(t *testing.T) {
		start := time.Now()
		ctx, cancel := WithHTTPWorkBudget(context.Background())
		defer cancel()

		deadline, ok := ctx.Deadline()
		require.True(t, ok)
		assert.Equal(t, 5*time.Second, deadline.Sub(start))

		time.Sleep(HTTPWorkBudget - time.Nanosecond)
		require.NoError(t, ctx.Err())
		time.Sleep(time.Nanosecond)
		synctest.Wait()
		require.ErrorIs(t, ctx.Err(), context.DeadlineExceeded)
		assert.True(t, HTTPWorkBudgetExceeded(ctx))
	})
}

func TestHTTPWorkBudget_DistinguishesParentCancellation(t *testing.T) {
	parent, cancelParent := context.WithCancel(context.Background())
	ctx, cancelBudget := WithHTTPWorkBudget(parent)
	cancelParent()
	defer cancelBudget()

	require.ErrorIs(t, ctx.Err(), context.Canceled)
	assert.False(t, HTTPWorkBudgetExceeded(ctx))
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
