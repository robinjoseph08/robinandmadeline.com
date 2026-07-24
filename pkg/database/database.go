// Package database wires up the Bun ORM against Postgres.
package database

import (
	"context"
	"database/sql"
	"database/sql/driver"
	"errors"
	"fmt"
	"io"
	"net/url"
	"strings"
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

// HTTPRouteOperation attributes work to an Echo route template. Callers must
// pass the registered template (for example /api/parties/:id), never URL.Path.
// Route templates have bounded cardinality and replace sensitive path values
// with parameter names.
func HTTPRouteOperation(routeTemplate string) Operation {
	if routeTemplate == "" || len(routeTemplate) > 128 ||
		!strings.HasPrefix(routeTemplate, "/") || strings.ContainsAny(routeTemplate, "?#%") {
		return Operation{}
	}
	for _, segment := range strings.Split(strings.TrimPrefix(routeTemplate, "/"), "/") {
		if segment == "" {
			return Operation{}
		}
		for _, r := range segment {
			if (r >= 'a' && r <= 'z') || (r >= 'A' && r <= 'Z') ||
				(r >= '0' && r <= '9') || r == '-' || r == '_' || r == ':' || r == '.' {
				continue
			}
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
	return conn, err
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
