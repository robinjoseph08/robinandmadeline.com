package errcodes_test

import (
	"context"
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"os"
	"strings"
	"syscall"
	"testing"

	"github.com/labstack/echo/v4"
	"github.com/pkg/errors"
	"github.com/robinjoseph08/robinandmadeline.com/pkg/errcodes"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

// handle runs the error handler against err and returns the response recorder.
// The handler logs 5xx responses through the request-scoped golib logger, which
// falls back to a default logger (writing to stderr) when the logging
// middleware did not run, as here. We assert on the response envelope and status
// mapping rather than scraping that log output.
func handle(t *testing.T, err error) *httptest.ResponseRecorder {
	t.Helper()
	h := errcodes.NewHandler()

	e := echo.New()
	req := httptest.NewRequestWithContext(context.Background(), http.MethodGet, "/api/widgets", nil)
	rec := httptest.NewRecorder()
	h.Handle(err, e.NewContext(req, rec))
	return rec
}

// decodeEnvelope reads the standard error envelope from a recorder.
func decodeEnvelope(t *testing.T, rec *httptest.ResponseRecorder) (code, message string, statusCode int) {
	t.Helper()
	var body struct {
		Error struct {
			Code       string `json:"code"`
			Message    string `json:"message"`
			StatusCode int    `json:"status_code"`
		} `json:"error"`
	}
	require.NoError(t, json.Unmarshal(rec.Body.Bytes(), &body))
	return body.Error.Code, body.Error.Message, body.Error.StatusCode
}

func TestHandle_ErrcodesErrorRendersEnvelope(t *testing.T) {
	rec := handle(t, errcodes.NotFound("party"))

	assert.Equal(t, http.StatusNotFound, rec.Code)
	code, msg, status := decodeEnvelope(t, rec)
	assert.Equal(t, string(errcodes.CodeNotFound), code)
	assert.Equal(t, "Party not found.", msg)
	assert.Equal(t, http.StatusNotFound, status)
}

func TestHandle_WrappedErrcodesErrorIsResolved(t *testing.T) {
	// A pkg/errors-wrapped errcodes error must still resolve via errors.As.
	rec := handle(t, errors.Wrap(errcodes.Conflict("dupe code"), "create party"))

	assert.Equal(t, http.StatusConflict, rec.Code)
	code, msg, _ := decodeEnvelope(t, rec)
	assert.Equal(t, string(errcodes.CodeConflict), code)
	assert.Equal(t, "dupe code", msg)
}

func TestHandle_EchoHTTPErrorMappedToSnakeCode(t *testing.T) {
	rec := handle(t, echo.NewHTTPError(http.StatusMethodNotAllowed, "Method Not Allowed"))

	assert.Equal(t, http.StatusMethodNotAllowed, rec.Code)
	code, msg, _ := decodeEnvelope(t, rec)
	assert.Equal(t, "method_not_allowed", code)
	assert.Equal(t, "Method Not Allowed", msg)
}

func TestHandle_GenericErrorIs500AndDoesNotLeak(t *testing.T) {
	rec := handle(t, errors.New("pq: secret connection string failed"))

	assert.Equal(t, http.StatusInternalServerError, rec.Code)
	code, msg, _ := decodeEnvelope(t, rec)
	assert.Equal(t, string(errcodes.CodeInternal), code)
	assert.Equal(t, "Internal Server Error", msg)
	assert.NotContains(t, rec.Body.String(), "secret connection string",
		"a 500 must never leak the internal error text to the client")
}

func TestHandle_InternalErrorMessageIsMasked(t *testing.T) {
	// errcodes.Internal carries detail for the log line; the rendered envelope
	// must mask it like any other 5xx.
	rec := handle(t, errcodes.Internal("pq: secret table is missing"))

	assert.Equal(t, http.StatusInternalServerError, rec.Code)
	code, msg, _ := decodeEnvelope(t, rec)
	assert.Equal(t, string(errcodes.CodeInternal), code)
	assert.Equal(t, "Internal Server Error", msg)
	assert.NotContains(t, rec.Body.String(), "secret table",
		"a 5xx *Error must never leak its constructor text to the client")
}

func TestHandle_EchoHTTPError5xxMessageIsMasked(t *testing.T) {
	// A framework-originated 5xx renders the status text, not its message.
	rec := handle(t, echo.NewHTTPError(http.StatusServiceUnavailable, "pool exhausted: dsn=secret"))

	assert.Equal(t, http.StatusServiceUnavailable, rec.Code)
	code, msg, _ := decodeEnvelope(t, rec)
	assert.Equal(t, "service_unavailable", code)
	assert.Equal(t, "Service Unavailable", msg)
	assert.NotContains(t, rec.Body.String(), "secret")
}

func TestHandle_IgnorableErrorsAreSilent(t *testing.T) {
	// golib's errutils.IsIgnorableErr classifies client-disconnect errors, and
	// the handler also early-returns on context.Canceled. None should produce a
	// response body.
	for name, err := range map[string]error{
		"broken pipe":      &os.SyscallError{Syscall: "write", Err: syscall.EPIPE},
		"connection reset": &os.SyscallError{Syscall: "read", Err: syscall.ECONNRESET},
		"eof":              io.EOF,
		"context canceled": context.Canceled,
	} {
		t.Run(name, func(t *testing.T) {
			rec := handle(t, err)
			// Nothing written: the handler returned before rendering.
			assert.Empty(t, strings.TrimSpace(rec.Body.String()))
			assert.Equal(t, http.StatusOK, rec.Code, "no status should be written")
		})
	}
}
