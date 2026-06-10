package errcodes

import (
	"context"
	"net/http"

	"github.com/iancoleman/strcase"
	"github.com/labstack/echo/v4"
	"github.com/pkg/errors"
	"github.com/robinjoseph08/golib/echo/v4/middleware/logger"
	"github.com/robinjoseph08/golib/errutils"
)

// Handler is the Echo error handler. Build it with NewHandler and register it as
// e.HTTPErrorHandler. It renders the exported ErrorEnvelope (errors.go), the
// same type the frontend's generated bindings parse.
type Handler struct{}

// NewHandler returns a Handler. 5xx responses are logged through the
// request-scoped golib logger (golib/logger.Middleware), so the handler holds
// no logger of its own.
func NewHandler() *Handler {
	return &Handler{}
}

// Handle resolves any error to the standard envelope and writes it. It logs only
// 5xx responses through the request-scoped logger (which attaches a %+v stack
// for pkg/errors errors), and silently ignores client-disconnect and
// context-cancellation errors.
func (h *Handler) Handle(err error, c echo.Context) {
	// Silently ignore client-disconnect errors (broken pipe, connection reset,
	// EOF, network timeouts) that golib classifies as ignorable.
	if errutils.IsIgnorableErr(err) {
		return
	}

	// Silently ignore context cancellation, which is expected when a client
	// disconnects before the request completes.
	if errors.Is(err, context.Canceled) {
		return
	}

	httpCode, code, msg := resolve(err)

	// Internal server errors: log the underlying error (with its stack) through
	// the request-scoped logger. The raw detail stays in the log and never
	// reaches the client.
	if httpCode >= http.StatusInternalServerError {
		logger.FromEchoContext(c).Err(err).Error("server error")
	}

	if writeErr := c.JSON(httpCode, ErrorEnvelope{ErrorDetail{code, msg, httpCode}}); writeErr != nil {
		logger.FromEchoContext(c).Err(errors.WithStack(writeErr)).Error("error handler failed to write response")
	}
}

// resolve maps an error to (httpCode, code, message). It checks *Error first,
// then *echo.HTTPError, falling back to a generic 500 whose message never leaks
// the underlying error text.
func resolve(err error) (int, string, string) {
	var e *Error
	if errors.As(err, &e) {
		return e.HTTPCode, e.Code, e.Message
	}

	var he *echo.HTTPError
	if errors.As(err, &he) {
		msg := http.StatusText(he.Code)
		if m, ok := he.Message.(string); ok && m != "" {
			msg = m
		}
		return he.Code, strcase.ToSnake(msg), msg
	}

	return http.StatusInternalServerError, string(CodeInternal), "Internal Server Error"
}
