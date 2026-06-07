package errcodes

import (
	"context"
	"errors"
	"fmt"
	"log/slog"
	"net/http"
	"strings"

	"github.com/iancoleman/strcase"
	"github.com/labstack/echo/v4"
)

// errorBody is the client-facing error envelope: {"error": {...}}.
type errorBody struct {
	Error errorDetail `json:"error"`
}

type errorDetail struct {
	Code       string `json:"code"`
	Message    string `json:"message"`
	StatusCode int    `json:"status_code"`
}

// Handler is the Echo error handler. Build it with NewHandler and register it as
// e.HTTPErrorHandler.
type Handler struct {
	logger *slog.Logger
}

// NewHandler returns a Handler that logs server errors with the given logger.
func NewHandler(logger *slog.Logger) *Handler {
	return &Handler{logger: logger}
}

// Handle resolves any error to the standard envelope and writes it. It logs only
// 5xx responses (with the request method/path and a %+v stack so pkg/errors
// stacks surface), and silently ignores client-disconnect errors.
func (h *Handler) Handle(err error, c echo.Context) {
	if errors.Is(err, context.Canceled) || isBrokenPipe(err) {
		return
	}

	httpCode, code, msg := resolve(err)

	if httpCode >= http.StatusInternalServerError {
		req := c.Request()
		// %+v renders the pkg/errors stack when present; the raw error detail
		// stays in the log and never reaches the client.
		h.logger.Error("server error",
			"method", req.Method,
			"path", req.URL.Path,
			"error", fmt.Sprintf("%+v", err),
		)
	}

	if writeErr := c.JSON(httpCode, errorBody{errorDetail{code, msg, httpCode}}); writeErr != nil {
		h.logger.Error("error handler failed to write response", "error", writeErr)
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

// isBrokenPipe reports whether err looks like a client-disconnect write error
// (broken pipe / connection reset), which is expected and not worth logging.
func isBrokenPipe(err error) bool {
	if err == nil {
		return false
	}
	msg := strings.ToLower(err.Error())
	return strings.Contains(msg, "broken pipe") || strings.Contains(msg, "connection reset by peer")
}
