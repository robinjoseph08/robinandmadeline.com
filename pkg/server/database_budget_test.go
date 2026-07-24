package server

import (
	"context"
	"encoding/json"
	"errors"
	"net"
	"net/http"
	"net/http/httptest"
	"os"
	"testing"
	"testing/synctest"
	"time"

	"github.com/labstack/echo/v4"
	"github.com/robinjoseph08/golib/echo/v4/middleware/recovery"
	"github.com/robinjoseph08/robinandmadeline.com/pkg/database"
	"github.com/robinjoseph08/robinandmadeline.com/pkg/errcodes"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestDatabaseBudgetMiddleware_PreservesNonConnectivityErrors(t *testing.T) {
	tests := []struct {
		name       string
		err        error
		wantStatus int
		wantCode   string
	}{
		{name: "validation", err: errcodes.ValidationError("invalid"), wantStatus: http.StatusUnprocessableEntity, wantCode: string(errcodes.CodeValidationError)},
		{name: "domain", err: errcodes.NotFound("party"), wantStatus: http.StatusNotFound, wantCode: string(errcodes.CodeNotFound)},
		{name: "ordinary SQL", err: errors.New("relation does not exist"), wantStatus: http.StatusInternalServerError, wantCode: string(errcodes.CodeInternal)},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			e := echo.New()
			e.HTTPErrorHandler = errcodes.NewHandler().Handle
			e.Use(databaseBudgetMiddleware)
			e.GET("/api/test", func(echo.Context) error { return tt.err })

			req := httptest.NewRequestWithContext(context.Background(), http.MethodGet, "/api/test", http.NoBody)
			rec := httptest.NewRecorder()
			e.ServeHTTP(rec, req)

			assert.Equal(t, tt.wantStatus, rec.Code)
			var envelope errcodes.ErrorEnvelope
			require.NoError(t, json.Unmarshal(rec.Body.Bytes(), &envelope))
			assert.Equal(t, tt.wantCode, envelope.Error.Code)
		})
	}
}

func TestDatabaseBudgetMiddleware_DoesNotTranslateCallerDeadline(t *testing.T) {
	e := echo.New()
	e.HTTPErrorHandler = errcodes.NewHandler().Handle
	e.Use(databaseBudgetMiddleware)
	e.GET("/api/test", func(c echo.Context) error { return c.Request().Context().Err() })

	parent, cancel := context.WithDeadline(context.Background(), time.Now().Add(-time.Second))
	defer cancel()
	req := httptest.NewRequestWithContext(parent, http.MethodGet, "/api/test", http.NoBody)
	rec := httptest.NewRecorder()
	e.ServeHTTP(rec, req)

	assert.Equal(t, http.StatusOK, rec.Code, "the existing handler ignores caller timeouts")
	assert.Empty(t, rec.Body.String())
}

func TestDatabaseBudgetMiddleware_TranslatesDriverSocketDeadline(t *testing.T) {
	synctest.Test(t, func(t *testing.T) {
		e := echo.New()
		e.HTTPErrorHandler = errcodes.NewHandler().Handle
		e.Use(databaseBudgetMiddleware)
		e.GET("/api/test", func(c echo.Context) error {
			<-c.Request().Context().Done()
			return &net.OpError{Op: "read", Net: "tcp", Err: os.ErrDeadlineExceeded}
		})

		startedAt := time.Now()
		req := httptest.NewRequestWithContext(context.Background(), http.MethodGet, "/api/test", http.NoBody)
		rec := httptest.NewRecorder()
		e.ServeHTTP(rec, req)

		assert.Equal(t, database.HTTPWorkBudget, time.Since(startedAt))
		assert.Equal(t, http.StatusServiceUnavailable, rec.Code)
		assert.JSONEq(t, `{"error":{"code":"service_unavailable","message":"Service Unavailable","status_code":503}}`, rec.Body.String())
	})
}

func TestDatabaseBudgetMiddleware_PreservesProgrammingErrorBehavior(t *testing.T) {
	e := echo.New()
	e.HTTPErrorHandler = errcodes.NewHandler().Handle
	e.Use(recovery.Middleware())
	e.Use(databaseBudgetMiddleware)
	e.GET("/api/test", func(echo.Context) error { panic("programming error") })

	req := httptest.NewRequestWithContext(context.Background(), http.MethodGet, "/api/test", http.NoBody)
	rec := httptest.NewRecorder()
	e.ServeHTTP(rec, req)

	assert.Equal(t, http.StatusInternalServerError, rec.Code)
	var envelope errcodes.ErrorEnvelope
	require.NoError(t, json.Unmarshal(rec.Body.Bytes(), &envelope))
	assert.Equal(t, string(errcodes.CodeInternal), envelope.Error.Code)
	assert.NotContains(t, rec.Body.String(), "programming error")
}

func TestDatabaseBudgetMiddleware_PreservesClientCancellation(t *testing.T) {
	e := echo.New()
	e.HTTPErrorHandler = errcodes.NewHandler().Handle
	e.Use(databaseBudgetMiddleware)
	e.GET("/api/test", func(echo.Context) error { return context.Canceled })

	req := httptest.NewRequestWithContext(context.Background(), http.MethodGet, "/api/test", http.NoBody)
	rec := httptest.NewRecorder()
	e.ServeHTTP(rec, req)

	assert.Equal(t, http.StatusOK, rec.Code)
	assert.Empty(t, rec.Body.String())
}

func TestDatabaseBudgetMiddleware_DeadlinesEveryMatchedAPIShape(t *testing.T) {
	e := echo.New()
	e.Use(databaseBudgetMiddleware)
	assertDeadline := func(c echo.Context) error {
		_, hasDeadline := c.Request().Context().Deadline()
		assert.True(t, hasDeadline)
		return c.NoContent(http.StatusOK)
	}
	e.GET("/api/test", assertDeadline)
	e.POST("/u/:id", assertDeadline)

	for _, request := range []struct {
		method string
		path   string
	}{
		{method: http.MethodGet, path: "/api/test"},
		{method: http.MethodPost, path: "/u/guest-id"},
	} {
		req := httptest.NewRequestWithContext(context.Background(), request.method, request.path, http.NoBody)
		rec := httptest.NewRecorder()
		e.ServeHTTP(rec, req)
		assert.Equal(t, http.StatusOK, rec.Code)
	}
}

func TestDatabaseBudgetMiddleware_DoesNotDeadlineStaticOrUnknownRequests(t *testing.T) {
	e := echo.New()
	e.Use(databaseBudgetMiddleware)
	e.GET("/story", func(c echo.Context) error {
		_, hasDeadline := c.Request().Context().Deadline()
		assert.False(t, hasDeadline)
		return c.NoContent(http.StatusOK)
	})

	req := httptest.NewRequestWithContext(context.Background(), http.MethodGet, "/story", http.NoBody)
	rec := httptest.NewRecorder()
	e.ServeHTTP(rec, req)
	assert.Equal(t, http.StatusOK, rec.Code)
}
