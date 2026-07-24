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

// Handle resolves any error to the standard envelope and writes it, except that
// HEAD writes the same status without a body. It logs only 5xx responses through
// the request-scoped logger (which attaches a %+v stack for pkg/errors errors),
// and silently ignores client-disconnect and context-cancellation errors.
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

	// HEAD renders the same status as GET, but never a response body. Echo's
	// JSON writer does not suppress that body itself.
	if c.Request().Method == http.MethodHead {
		if writeErr := c.NoContent(httpCode); writeErr != nil {
			logger.FromEchoContext(c).Err(errors.WithStack(writeErr)).Error("error handler failed to write response")
		}
		return
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
		msg := e.Message
		// Internal errors are always masked. The exact ServiceUnavailable
		// status/code pair is the one client-safe 5xx shape, and its message is
		// fixed here rather than trusted from a caller-built Error.
		if e.HTTPCode == http.StatusServiceUnavailable && e.Code == string(CodeServiceUnavailable) {
			msg = http.StatusText(http.StatusServiceUnavailable)
		} else if e.HTTPCode >= http.StatusInternalServerError {
			msg = "Internal Server Error"
		}
		return e.HTTPCode, e.Code, msg
	}

	var he *echo.HTTPError
	if errors.As(err, &he) {
		msg := http.StatusText(he.Code)
		// Framework 4xx messages pass through; 5xx stay generic, same as above.
		if m, ok := he.Message.(string); ok && m != "" && he.Code < http.StatusInternalServerError {
			msg = m
		}
		return he.Code, strcase.ToSnake(msg), msg
	}

	return http.StatusInternalServerError, string(CodeInternal), "Internal Server Error"
}
