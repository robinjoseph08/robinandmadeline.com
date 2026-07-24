// Package database wires up the Bun ORM against Postgres.
package database

import (
	"context"
	"database/sql"
	"database/sql/driver"
	"errors"
	"fmt"
	"io"
	"net"
	"net/url"
	"strings"
	"sync"
	"sync/atomic"
	"time"

	"github.com/robinjoseph08/robinandmadeline.com/pkg/config"
	"github.com/uptrace/bun"
	"github.com/uptrace/bun/dialect/pgdialect"
	"github.com/uptrace/bun/driver/pgdriver"
)

// Operation is a bounded, non-sensitive label describing the work that first
// needed a physical database connection. Values are constructed here rather
// than from request URLs so connection telemetry cannot contain credentials,
// identifiers, query strings, or raw URLs.
type Operation struct {
	label string
}

// String returns the safe telemetry label.
func (o Operation) String() string {
	if o.label == "" {
		return "unattributed"
	}
	return o.label
}

// These are the registered HTTP routes without dynamic parameter markers.
// Dynamic templates are safe by shape because they retain only the known
// parameter names below. Keeping static routes closed means an accidental
// URL.Path call cannot turn an Info Token, RSVP Code, or UUID into a label.
var staticHTTPRoutes = map[string]struct{}{
	"/api/admin/dashboard":            {},
	"/api/admin/emails/preview":       {},
	"/api/admin/emails/send":          {},
	"/api/admin/emails/sends":         {},
	"/api/admin/emails/shell-preview": {},
	"/api/admin/emails/templates":     {},
	"/api/admin/emails/test":          {},
	"/api/admin/events":               {},
	"/api/admin/games/sessions":       {},
	"/api/admin/guests":               {},
	"/api/admin/guests/tags":          {},
	"/api/admin/me":                   {},
	"/api/admin/parties":              {},
	"/api/admin/photo-groups":         {},
	"/api/admin/photo-groups/reorder": {},
	"/api/admin/settings":             {},
	"/api/auth/admin/login":           {},
	"/api/auth/guest/login":           {},
	"/api/events":                     {},
	"/api/games/leaderboard":          {},
	"/api/games/sessions":             {},
	"/api/guest/photo-groups":         {},
	"/api/guest/rsvp":                 {},
	"/api/health":                     {},
	"/api/webhooks/mailgun":           {},
}

var routeParameterNames = map[string]struct{}{
	":guestId": {},
	":id":      {},
	":token":   {},
}

// HTTPRouteOperation attributes work to an Echo route template. Callers must
// pass the registered template (for example /api/parties/:id), never URL.Path.
// Route templates have bounded cardinality and replace sensitive path values
// with parameter names.
func HTTPRouteOperation(routeTemplate string) Operation {
	if routeTemplate == "" || len(routeTemplate) > 128 ||
		!strings.HasPrefix(routeTemplate, "/") || strings.ContainsAny(routeTemplate, "?#%") {
		return Operation{}
	}

	dynamic := false
	for _, segment := range strings.Split(strings.TrimPrefix(routeTemplate, "/"), "/") {
		if segment == "" {
			return Operation{}
		}
		if strings.HasPrefix(segment, ":") {
			if _, ok := routeParameterNames[segment]; !ok {
				return Operation{}
			}
			dynamic = true
			continue
		}
		for _, r := range segment {
			if (r >= 'a' && r <= 'z') || (r >= '0' && r <= '9') || r == '-' || r == '_' || r == '.' {
				continue
			}
			return Operation{}
		}
	}
	if !dynamic {
		if _, ok := staticHTTPRoutes[routeTemplate]; !ok {
			return Operation{}
		}
	}
	return Operation{label: "http:" + routeTemplate}
}

// InfoMetadataOperation attributes a connection to the one database-backed
// SPA shell metadata lookup without including its Info Token.
func InfoMetadataOperation() Operation {
	return Operation{label: "info_metadata"}
}

// EmailWorkerOperation attributes a connection to an activated email worker.
func EmailWorkerOperation() Operation {
	return Operation{label: "email_worker"}
}

type operationContextKey struct{}

// WithOperation attaches a safe operation label to database work.
func WithOperation(ctx context.Context, operation Operation) context.Context {
	return context.WithValue(ctx, operationContextKey{}, operation)
}

func operationFromContext(ctx context.Context) Operation {
	operation, _ := ctx.Value(operationContextKey{}).(Operation)
	return operation
}

// FirstConnectionAttempt describes the first physical connection attempt made
// by this database handle. Err is set when that attempt failed.
type FirstConnectionAttempt struct {
	Operation Operation
	Err       error
}

// FirstConnectionObserver receives exactly one event, after the first physical
// attempt finishes, whether it succeeds or fails. The connection context lets
// observers retain request-scoped telemetry without exposing raw request data.
type FirstConnectionObserver func(context.Context, FirstConnectionAttempt)

// NewConnector builds the real Postgres connector without opening a physical
// connection. The connector is exposed so production assembly can substitute
// an instrumented standard connector in deterministic tests.
func NewConnector(cfg *config.Config) driver.Connector {
	return pgdriver.NewConnector(pgdriver.WithDSN(cfg.DatabaseURL))
}

// New opens a lazy Bun database handle using the configured DATABASE_URL.
func New(cfg *config.Config) (*bun.DB, error) {
	return NewWithConnector(NewConnector(cfg), nil)
}

// NewWithConnector opens a lazy Bun database handle around connector. Neither
// construction nor pool configuration calls Connector.Connect.
func NewWithConnector(connector driver.Connector, observer FirstConnectionObserver) (*bun.DB, error) {
	if connector == nil {
		return nil, errors.New("database connector is required")
	}
	observed := &observedConnector{connector: connector, observer: observer}
	sqldb := sql.OpenDB(observed)
	configurePool(sqldb)
	return bun.NewDB(sqldb, pgdialect.New()), nil
}

// HTTPWorkBudget is the aggregate database-work budget for one matched API
// request. The server installs it once before authentication and every query or
// transaction uses the same request context, so later work receives only the
// time left from earlier work.
const HTTPWorkBudget = 5 * time.Second

var errHTTPWorkBudgetExceeded = errors.New("HTTP database-work budget exceeded")

// WithHTTPWorkBudget returns a context carrying the one aggregate database
// deadline for an API request. The distinct cancellation cause lets the server
// distinguish this budget from a caller disconnect or an earlier caller-owned
// deadline.
func WithHTTPWorkBudget(ctx context.Context) (context.Context, context.CancelFunc) {
	return context.WithTimeoutCause(ctx, HTTPWorkBudget, errHTTPWorkBudgetExceeded)
}

// HTTPWorkBudgetExceeded reports whether the request's own database-work
// budget, rather than its parent context, canceled ctx.
func HTTPWorkBudgetExceeded(ctx context.Context) bool {
	return errors.Is(context.Cause(ctx), errHTTPWorkBudgetExceeded)
}

const (
	maxOpenConnections = 5
	maxIdleConnections = 1
	maxConnectionIdle  = time.Minute
)

type poolConfigurer interface {
	SetMaxOpenConns(int)
	SetMaxIdleConns(int)
	SetConnMaxIdleTime(time.Duration)
}

func configurePool(pool poolConfigurer) {
	pool.SetMaxOpenConns(maxOpenConnections)
	pool.SetMaxIdleConns(maxIdleConnections)
	pool.SetConnMaxIdleTime(maxConnectionIdle)
}

type observedConnector struct {
	connector driver.Connector
	observer  FirstConnectionObserver
	started   atomic.Bool
}

func (c *observedConnector) Connect(ctx context.Context) (driver.Conn, error) {
	first := c.started.CompareAndSwap(false, true)
	conn, err := c.connector.Connect(ctx)
	if first && c.observer != nil {
		c.observer(ctx, FirstConnectionAttempt{Operation: operationFromContext(ctx), Err: err})
	}
	if err != nil {
		if ctx.Err() != nil {
			return nil, ctx.Err()
		}
		return nil, &connectionFailure{err: err}
	}
	if pgConn, ok := conn.(*pgdriver.Conn); ok {
		return &contextualPGConn{Conn: pgConn}, nil
	}
	return conn, nil
}

// contextualPGConn carries operation contexts through pgdriver boundaries that
// otherwise fall back to background contexts. It also marks transport failures
// without changing PostgreSQL statement and programming errors.
type contextualPGConn struct {
	*pgdriver.Conn
}

func (c *contextualPGConn) PrepareContext(ctx context.Context, query string) (driver.Stmt, error) {
	stmt, err := c.Conn.PrepareContext(ctx, query)
	return stmt, normalizeDatabaseError(ctx, err)
}

func (c *contextualPGConn) BeginTx(ctx context.Context, opts driver.TxOptions) (driver.Tx, error) {
	tx, err := c.Conn.BeginTx(ctx, opts)
	if err != nil {
		return nil, normalizeDatabaseError(ctx, err)
	}
	return &contextualTx{Tx: tx, ctx: ctx, execer: c.Conn}, nil
}

func (c *contextualPGConn) ExecContext(ctx context.Context, query string, args []driver.NamedValue) (driver.Result, error) {
	result, err := c.Conn.ExecContext(ctx, query, args)
	return result, normalizeDatabaseError(ctx, err)
}

func (c *contextualPGConn) QueryContext(ctx context.Context, query string, args []driver.NamedValue) (driver.Rows, error) {
	rows, err := c.Conn.QueryContext(ctx, query, args)
	if err != nil {
		return nil, normalizeDatabaseError(ctx, err)
	}
	return newContextualRows(ctx, rows, c.Close), nil
}

func (c *contextualPGConn) Ping(ctx context.Context) error {
	return normalizeDatabaseError(ctx, c.Conn.Ping(ctx))
}

type contextualTx struct {
	driver.Tx
	ctx    context.Context
	execer driver.ExecerContext
}

func (tx *contextualTx) Commit() error {
	_, err := tx.execer.ExecContext(tx.ctx, "COMMIT", nil)
	return normalizeDatabaseError(tx.ctx, err)
}

func (tx *contextualTx) Rollback() error {
	_, err := tx.execer.ExecContext(tx.ctx, "ROLLBACK", nil)
	return normalizeDatabaseError(tx.ctx, err)
}

type contextualRows struct {
	driver.Rows
	ctx       context.Context
	closeConn func() error
	done      chan struct{}
	doneOnce  sync.Once
}

func newContextualRows(ctx context.Context, rows driver.Rows, closeConn func() error) *contextualRows {
	wrapped := &contextualRows{
		Rows:      rows,
		ctx:       ctx,
		closeConn: closeConn,
		done:      make(chan struct{}),
	}
	go func() {
		select {
		case <-ctx.Done():
			_ = closeConn()
		case <-wrapped.done:
		}
	}()
	return wrapped
}

func (rows *contextualRows) Next(dest []driver.Value) error {
	err := rows.Rows.Next(dest)
	if err == io.EOF {
		return err
	}
	return normalizeDatabaseError(rows.ctx, err)
}

func (rows *contextualRows) Close() error {
	defer rows.doneOnce.Do(func() { close(rows.done) })
	return normalizeDatabaseError(rows.ctx, rows.Rows.Close())
}

func normalizeDatabaseError(ctx context.Context, err error) error {
	if err == nil {
		return nil
	}
	if ctx.Err() != nil {
		return ctx.Err()
	}
	if isDatabaseTransportError(err) {
		return &connectionFailure{err: err}
	}
	return err
}

type postgresError interface {
	error
	Field(byte) string
}

func isDatabaseTransportError(err error) bool {
	if errors.Is(err, driver.ErrBadConn) || errors.Is(err, io.EOF) || errors.Is(err, io.ErrUnexpectedEOF) {
		return true
	}
	var postgresErr postgresError
	if errors.As(err, &postgresErr) {
		severity := postgresErr.Field('V')
		return severity == "FATAL" || severity == "PANIC"
	}
	var netErr net.Error
	return errors.As(err, &netErr)
}

// connectionFailure marks an error returned while opening a physical database
// connection or using its transport. PostgreSQL statement and programming
// errors deliberately do not receive this marker, so request translation cannot
// turn them into service-unavailable responses.
type connectionFailure struct {
	err error
}

func (e *connectionFailure) Error() string { return e.err.Error() }
func (e *connectionFailure) Unwrap() error { return e.err }

// IsConnectionFailure reports whether err arose while opening or using a
// physical database connection. It traverses infrastructure wrapping added by
// services.
func IsConnectionFailure(err error) bool {
	var failure *connectionFailure
	return errors.As(err, &failure)
}

func (c *observedConnector) Driver() driver.Driver {
	return c.connector.Driver()
}

// Close preserves the standard Connector lifecycle through the observation
// decorator, so closing Bun's shared handle also closes connectors that own
// resources.
func (c *observedConnector) Close() error {
	if closer, ok := c.connector.(io.Closer); ok {
		return closer.Close()
	}
	return nil
}

// EnsureExists creates the database named in dsn if it is absent, connecting to
// the maintenance "postgres" database on the same server to do so. It is
// idempotent: an already-present database (or a concurrent create race) is
// treated as success. This bootstraps the test/e2e databases, which are not
// provisioned by docker-compose; the dev and production databases already exist
// (and are migrated via the Fly release_command per ADR 0007).
func EnsureExists(ctx context.Context, dsn string) error {
	dbName, adminDSN, err := maintenanceDSN(dsn)
	if err != nil {
		return err
	}

	adminDB := bun.NewDB(
		sql.OpenDB(pgdriver.NewConnector(pgdriver.WithDSN(adminDSN))),
		pgdialect.New(),
	)
	defer func() { _ = adminDB.Close() }()

	var exists bool
	err = adminDB.NewRaw(
		"SELECT EXISTS (SELECT 1 FROM pg_database WHERE datname = ?)", dbName,
	).Scan(ctx, &exists)
	if err != nil {
		return fmt.Errorf("check pg_database for %q: %w", dbName, err)
	}
	if exists {
		return nil
	}

	// The database name is derived from our own DSN, not user input, so the
	// identifier interpolation here is safe. CREATE DATABASE cannot be
	// parameterized, hence the formatted statement.
	_, err = adminDB.ExecContext(ctx, fmt.Sprintf("CREATE DATABASE %q", dbName))
	if err != nil && !isDuplicateDatabase(err) {
		return fmt.Errorf("create database %q: %w", dbName, err)
	}
	return nil
}

// DropIfExists drops the database named in dsn if it exists, connecting to the
// maintenance "postgres" database on the same server to do so. It is idempotent.
// This is the teardown counterpart to EnsureExists, used by the e2e harness to
// remove its throwaway per-run database; never point it at a database you want
// to keep. WITH (FORCE) terminates any lingering connections (Postgres 13+) so
// the drop does not block on a still-open pool.
func DropIfExists(ctx context.Context, dsn string) error {
	dbName, adminDSN, err := maintenanceDSN(dsn)
	if err != nil {
		return err
	}

	adminDB := bun.NewDB(
		sql.OpenDB(pgdriver.NewConnector(pgdriver.WithDSN(adminDSN))),
		pgdialect.New(),
	)
	defer func() { _ = adminDB.Close() }()

	// The database name is derived from our own DSN, not user input, so the
	// identifier interpolation here is safe. DROP DATABASE cannot be
	// parameterized, hence the formatted statement.
	_, err = adminDB.ExecContext(ctx, fmt.Sprintf("DROP DATABASE IF EXISTS %q WITH (FORCE)", dbName))
	if err != nil {
		return fmt.Errorf("drop database %q: %w", dbName, err)
	}
	return nil
}

// isDuplicateDatabase reports whether a CREATE DATABASE error means the
// database already exists, which EnsureExists treats as success. That is
// SQLSTATE 42P04 (duplicate_database) when it existed before the statement, or
// 23505 (a unique violation on the pg_database catalog index) when a concurrent
// EnsureExists won the create race after our existence check.
func isDuplicateDatabase(err error) bool {
	var pgErr pgdriver.Error
	if !errors.As(err, &pgErr) {
		return false
	}
	code := pgErr.Field('C')
	return code == "42P04" || code == "23505"
}

// maintenanceDSN parses dsn and returns the target database name plus a DSN
// pointing at the maintenance "postgres" database on the same server (same
// credentials, host, and params), used to create the target database.
func maintenanceDSN(dsn string) (dbName, adminDSN string, err error) {
	u, err := url.Parse(dsn)
	if err != nil {
		return "", "", fmt.Errorf("parse DSN: %w", err)
	}
	dbName = strings.TrimPrefix(u.Path, "/")
	if dbName == "" {
		return "", "", fmt.Errorf("DSN has no database name: %q", dsn)
	}
	admin := *u
	admin.Path = "/postgres"
	return dbName, admin.String(), nil
}
