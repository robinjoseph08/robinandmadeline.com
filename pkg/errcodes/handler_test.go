package errcodes_test

import (
	"bytes"
	"context"
	"encoding/json"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/labstack/echo/v4"
	"github.com/pkg/errors"
	"github.com/robinjoseph08/robinandmadeline.com/pkg/errcodes"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

// handle runs the error handler against err and returns the response recorder
// plus whatever the logger emitted.
func handle(t *testing.T, err error) (*httptest.ResponseRecorder, string) {
	t.Helper()
	var logBuf bytes.Buffer
	h := errcodes.NewHandler(slog.New(slog.NewTextHandler(&logBuf, nil)))

	e := echo.New()
	req := httptest.NewRequestWithContext(context.Background(), http.MethodGet, "/api/widgets", nil)
	rec := httptest.NewRecorder()
	h.Handle(err, e.NewContext(req, rec))
	return rec, logBuf.String()
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
	rec, logged := handle(t, errcodes.NotFound("party"))

	assert.Equal(t, http.StatusNotFound, rec.Code)
	code, msg, status := decodeEnvelope(t, rec)
	assert.Equal(t, string(errcodes.CodeNotFound), code)
	assert.Equal(t, "party not found", msg)
	assert.Equal(t, http.StatusNotFound, status)
	assert.Empty(t, logged, "4xx must not be logged")
}

func TestHandle_WrappedErrcodesErrorIsResolved(t *testing.T) {
	// A pkg/errors-wrapped errcodes error must still resolve via errors.As.
	rec, _ := handle(t, errors.Wrap(errcodes.Conflict("dupe code"), "create party"))

	assert.Equal(t, http.StatusConflict, rec.Code)
	code, msg, _ := decodeEnvelope(t, rec)
	assert.Equal(t, string(errcodes.CodeConflict), code)
	assert.Equal(t, "dupe code", msg)
}

func TestHandle_EchoHTTPErrorMappedToSnakeCode(t *testing.T) {
	rec, _ := handle(t, echo.NewHTTPError(http.StatusMethodNotAllowed, "Method Not Allowed"))

	assert.Equal(t, http.StatusMethodNotAllowed, rec.Code)
	code, msg, _ := decodeEnvelope(t, rec)
	assert.Equal(t, "method_not_allowed", code)
	assert.Equal(t, "Method Not Allowed", msg)
}

func TestHandle_GenericErrorIs500AndDoesNotLeak(t *testing.T) {
	rec, logged := handle(t, errors.New("pq: secret connection string failed"))

	assert.Equal(t, http.StatusInternalServerError, rec.Code)
	code, msg, _ := decodeEnvelope(t, rec)
	assert.Equal(t, string(errcodes.CodeInternal), code)
	assert.Equal(t, "Internal Server Error", msg)
	assert.NotContains(t, rec.Body.String(), "secret connection string",
		"a 500 must never leak the internal error text to the client")
	// 5xx is logged, with the request path and the underlying detail.
	assert.Contains(t, logged, "/api/widgets")
	assert.Contains(t, logged, "secret connection string")
}

func TestHandle_IgnorableErrorsAreSilent(t *testing.T) {
	for _, err := range []error{
		errors.New("write tcp 1.2.3.4:80->5.6.7.8:9: write: broken pipe"),
		errors.New("read tcp: connection reset by peer"),
	} {
		rec, logged := handle(t, err)
		// Nothing written, nothing logged.
		assert.Empty(t, strings.TrimSpace(rec.Body.String()))
		assert.Empty(t, logged)
	}
}
