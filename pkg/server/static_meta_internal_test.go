// This file is white-box (package server) so it can exercise metadata lookup
// eligibility with a stub infoTitler. The DB query itself is covered black-box
// in pkg/info, and server.New's wiring is covered in static_meta_test.go.
package server

import (
	"context"
	"errors"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/labstack/echo/v4"
	"github.com/robinjoseph08/robinandmadeline.com/pkg/errcodes"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

const validInfoToken = "abcdefghijklmnopqrstuvwxyz1234"

// stubInfoTitler records every lookup and can delegate to resolve for context
// deadline and cancellation tests.
type stubInfoTitler struct {
	name       string
	err        error
	gotToken   string
	calls      int
	resolve    func(context.Context, string) (string, error)
	deadline   time.Time
	contextErr error
}

func (s *stubInfoTitler) PrimaryGuestName(ctx context.Context, token string) (string, error) {
	s.calls++
	s.gotToken = token
	if deadline, ok := ctx.Deadline(); ok {
		s.deadline = deadline
	}
	if s.resolve != nil {
		name, err := s.resolve(ctx, token)
		s.contextErr = ctx.Err()
		return name, err
	}
	return s.name, s.err
}

// internalMetaShell carries the tags injectMeta rewrites, enough to assert the
// per-route title and canonical URL without the fuller black-box fixture.
const internalMetaShell = `<!doctype html><html><head>` +
	`<title>Robin &amp; Madeline</title>` +
	`<meta name="description" content="Robin and Madeline's wedding website" />` +
	`<meta property="og:title" content="Robin &amp; Madeline" />` +
	`<meta property="og:url" content="https://www.robinandmadeline.com/" />` +
	`<meta name="twitter:title" content="Robin &amp; Madeline" />` +
	`</head><body></body></html>`

const internalMetaHost = "www.robinandmadeline.com"

func newInternalMetaHandler(t *testing.T, titler infoTitler) http.Handler {
	t.Helper()
	dir := t.TempDir()
	require.NoError(t, os.WriteFile(filepath.Join(dir, "index.html"), []byte(internalMetaShell), 0o600))

	e := echo.New()
	e.HTTPErrorHandler = errcodes.NewHandler().Handle
	e.Use(staticMiddleware(dir, internalMetaHost, titler))
	return e
}

func requestInternalMeta(ctx context.Context, t *testing.T, handler http.Handler, method, target string) *httptest.ResponseRecorder {
	t.Helper()
	req := httptest.NewRequestWithContext(ctx, method, target, http.NoBody)
	req.Host = internalMetaHost
	rec := httptest.NewRecorder()
	handler.ServeHTTP(rec, req)
	return rec
}

func injectInfo(t *testing.T, target string, titler infoTitler) string {
	t.Helper()
	req := httptest.NewRequestWithContext(context.Background(), http.MethodGet, target, http.NoBody)
	return injectMeta(internalMetaShell, trimTrailingSlash(req.URL.Path), internalMetaHost, req, titler)
}

func TestInjectMeta_InfoPageTitleUsesPrimaryGuestName(t *testing.T) {
	before := time.Now()
	titler := &stubInfoTitler{name: "Ada Lovelace"}
	body := injectInfo(t, "/i/"+validInfoToken, titler)

	assert.Contains(t, body, "<title>Ada&#39;s Info · Robin &amp; Madeline</title>")
	assert.Equal(t, 1, strings.Count(body, "<title>"))
	assert.Contains(t, body, `<meta property="og:title" content="Ada&#39;s Info · Robin &amp; Madeline" />`)
	assert.Contains(t, body, `<meta name="twitter:title" content="Ada&#39;s Info · Robin &amp; Madeline" />`)
	assert.Contains(t, body, `<meta name="robots" content="noindex" />`)
	assert.Contains(t, body, `<meta property="og:url" content="https://www.robinandmadeline.com/i/`+validInfoToken+`" />`)
	assert.Equal(t, 1, titler.calls)
	assert.Equal(t, validInfoToken, titler.gotToken)
	assert.WithinDuration(t, before.Add(time.Second), titler.deadline, 100*time.Millisecond)
}

func TestInjectMeta_InfoLookupEligibility(t *testing.T) {
	tests := []struct {
		name       string
		method     string
		target     string
		wantStatus int
		wantCalls  int
	}{
		{name: "normal GET", method: http.MethodGet, target: "/i/" + validInfoToken, wantStatus: http.StatusOK, wantCalls: 1},
		{name: "uppercase route prefix", method: http.MethodGet, target: "/I/" + validInfoToken, wantStatus: http.StatusOK, wantCalls: 1},
		{name: "mixed-case prefix with trailing slash", method: http.MethodGet, target: "/I/" + validInfoToken + "/", wantStatus: http.StatusOK, wantCalls: 1},
		{name: "HEAD", method: http.MethodHead, target: "/i/" + validInfoToken, wantStatus: http.StatusOK},
		{name: "short token", method: http.MethodGet, target: "/i/" + validInfoToken[:29], wantStatus: http.StatusOK},
		{name: "long token", method: http.MethodGet, target: "/i/" + validInfoToken + "a", wantStatus: http.StatusOK},
		{name: "uppercase token", method: http.MethodGet, target: "/i/Abcdefghijklmnopqrstuvwxyz1234", wantStatus: http.StatusOK},
		{name: "symbol in token", method: http.MethodGet, target: "/i/abcdefghijklmnopqrstuvwxy-1234", wantStatus: http.StatusOK},
		{name: "underscore in token", method: http.MethodGet, target: "/i/abcdefghijklmnopqrstuvwxy_1234", wantStatus: http.StatusOK},
		{name: "non-ASCII token character", method: http.MethodGet, target: "/i/abcdefghijklmnopqrstuvwxyé1234", wantStatus: http.StatusOK},
		{name: "percent-encoded route character", method: http.MethodGet, target: "/%69/" + validInfoToken, wantStatus: http.StatusOK},
		{name: "percent-encoded token character", method: http.MethodGet, target: "/i/abcdefghijklmnopqrstuvwxy%7A1234", wantStatus: http.StatusOK},
		{name: "encoded slash", method: http.MethodGet, target: "/i/" + validInfoToken + "%2Fextra", wantStatus: http.StatusNotFound},
		{name: "encoded backslash", method: http.MethodGet, target: "/i/" + validInfoToken + "%5Cextra", wantStatus: http.StatusNotFound},
		{name: "additional segment", method: http.MethodGet, target: "/i/" + validInfoToken + "/extra", wantStatus: http.StatusNotFound},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			titler := &stubInfoTitler{name: "Ada Lovelace"}
			rec := requestInternalMeta(context.Background(), t, newInternalMetaHandler(t, titler), tt.method, tt.target)
			require.Equal(t, tt.wantStatus, rec.Code)
			assert.Equal(t, tt.wantCalls, titler.calls)
			if tt.wantStatus == http.StatusOK && tt.method == http.MethodGet {
				wantTitle := "Your Details"
				if tt.wantCalls == 1 {
					wantTitle = "Ada&#39;s Info"
				}
				assert.Contains(t, rec.Body.String(), "<title>"+wantTitle+" · Robin &amp; Madeline</title>")
			}
		})
	}
}

func TestInjectMeta_InfoPageGenericFallbacks(t *testing.T) {
	tests := []struct {
		name   string
		titler infoTitler
	}{
		{name: "unknown token", titler: &stubInfoTitler{}},
		{name: "database error", titler: &stubInfoTitler{err: errors.New("db down")}},
		{name: "name with database error", titler: &stubInfoTitler{name: "Ada Lovelace", err: errors.New("db down")}},
		{name: "nil resolver", titler: nil},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			rec := requestInternalMeta(context.Background(), t, newInternalMetaHandler(t, tt.titler), http.MethodGet, "/i/"+validInfoToken)
			require.Equal(t, http.StatusOK, rec.Code)
			assert.Contains(t, rec.Body.String(), "<title>Your Details · Robin &amp; Madeline</title>")
		})
	}
}

func TestInjectMeta_InfoPageFallsBackWhenRequestIsCanceled(t *testing.T) {
	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	titler := &stubInfoTitler{resolve: func(ctx context.Context, _ string) (string, error) {
		return "", ctx.Err()
	}}

	rec := requestInternalMeta(ctx, t, newInternalMetaHandler(t, titler), http.MethodGet, "/i/"+validInfoToken)
	require.Equal(t, http.StatusOK, rec.Code)
	assert.Equal(t, 1, titler.calls)
	require.ErrorIs(t, titler.contextErr, context.Canceled)
	assert.Contains(t, rec.Body.String(), "<title>Your Details · Robin &amp; Madeline</title>")
}

func TestInjectMeta_InfoPageTimesOutAndCancelsLookup(t *testing.T) {
	titler := &stubInfoTitler{resolve: func(ctx context.Context, _ string) (string, error) {
		<-ctx.Done()
		return "", ctx.Err()
	}}
	started := time.Now()

	rec := requestInternalMeta(context.Background(), t, newInternalMetaHandler(t, titler), http.MethodGet, "/i/"+validInfoToken)

	require.Equal(t, http.StatusOK, rec.Code)
	assert.Equal(t, 1, titler.calls)
	assert.GreaterOrEqual(t, time.Since(started), 900*time.Millisecond)
	assert.Less(t, time.Since(started), 2*time.Second)
	require.ErrorIs(t, titler.contextErr, context.DeadlineExceeded)
	assert.Contains(t, rec.Body.String(), "<title>Your Details · Robin &amp; Madeline</title>")
}

func TestInjectMeta_TitlerConsultedOnlyForInfoRoute(t *testing.T) {
	for _, tc := range []struct{ path, title string }{
		{"/u/some-guest-id", "Unsubscribe"},
		{"/rsvp/form", "RSVP"},
		{"/rsvp/confirmation", "RSVP Confirmed"},
	} {
		titler := &stubInfoTitler{name: "Ada Lovelace"}
		body := injectInfo(t, tc.path, titler)
		assert.Equal(t, 0, titler.calls, tc.path)
		assert.Contains(t, body, "<title>"+tc.title+" · Robin &amp; Madeline</title>", tc.path)
	}
}

func TestInjectMeta_InfoPageUsesOnlyTheFirstName(t *testing.T) {
	for _, tc := range []struct{ name, wantTitle string }{
		{"Cher", "Cher&#39;s Info"},
		{"Mary Jane Watson", "Mary&#39;s Info"},
		{"  Ada   Lovelace  ", "Ada&#39;s Info"},
		{"   ", "Your Details"},
		{"", "Your Details"},
	} {
		body := injectInfo(t, "/i/"+validInfoToken, &stubInfoTitler{name: tc.name})
		assert.Contains(t, body, "<title>"+tc.wantTitle+" · Robin &amp; Madeline</title>", tc.name)
	}
}
