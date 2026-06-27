// This file is white-box (package server) so it can call the unexported
// injectMeta directly with a stub infoTitler. The /i/:token title is the one
// piece of per-route metadata that depends on data (the party's primary guest
// name), and wiring a real database through server.New into the shell handler is
// far heavier than the behavior under test; the DB query itself is covered black-
// box in pkg/info (TestPrimaryGuestName_*). The rest of the shell metadata is
// tested through the handler in static_meta_test.go.
package server

import (
	"context"
	"errors"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/stretchr/testify/assert"
)

// stubInfoTitler is a test double for the infoTitler the shell renderer consults
// for the /i/:token title. It records the token it was asked about and how many
// times, so a test can assert the route extracts the token (in its original
// case) and consults the resolver only for the info route.
type stubInfoTitler struct {
	name     string
	err      error
	gotToken string
	calls    int
}

func (s *stubInfoTitler) PrimaryGuestName(_ context.Context, token string) (string, error) {
	s.calls++
	s.gotToken = token
	return s.name, s.err
}

// internalMetaShell is a minimal SPA head carrying just the tags injectMeta
// rewrites, enough to assert the per-route title and og:url without the fuller
// fixture the black-box meta tests use.
const internalMetaShell = `<!doctype html><html><head>` +
	`<title>Robin &amp; Madeline</title>` +
	`<meta name="description" content="Robin and Madeline's wedding website" />` +
	`<meta property="og:title" content="Robin &amp; Madeline" />` +
	`<meta property="og:url" content="https://www.robinandmadeline.com/" />` +
	`<meta name="twitter:title" content="Robin &amp; Madeline" />` +
	`</head><body></body></html>`

const internalMetaHost = "www.robinandmadeline.com"

// injectInfo runs injectMeta for urlPath against the minimal shell with a fixed
// canonical host, so og:url is deterministic and the request is only the context
// carrier the resolver and logger read.
func injectInfo(t *testing.T, urlPath string, titler infoTitler) string {
	t.Helper()
	req := httptest.NewRequestWithContext(context.Background(), http.MethodGet, "/", http.NoBody)
	return injectMeta(internalMetaShell, urlPath, internalMetaHost, req, titler)
}

func TestInjectMeta_InfoPageTitleUsesPrimaryGuestName(t *testing.T) {
	titler := &stubInfoTitler{name: "Ada Lovelace"}
	body := injectInfo(t, "/i/sometoken123", titler)

	// The title and both preview titles read "<first name>'s Info" (the apostrophe
	// HTML-escaped), so the full "Ada Lovelace" is trimmed to "Ada", replacing the
	// generic fallback, with exactly one <title>.
	assert.Contains(t, body, "<title>Ada&#39;s Info · Robin &amp; Madeline</title>")
	assert.Equal(t, 1, strings.Count(body, "<title>"))
	assert.Contains(t, body, `<meta property="og:title" content="Ada&#39;s Info · Robin &amp; Madeline" />`)
	assert.Contains(t, body, `<meta name="twitter:title" content="Ada&#39;s Info · Robin &amp; Madeline" />`)

	// The page stays noindex and its preview card links back to itself.
	assert.Contains(t, body, `<meta name="robots" content="noindex" />`)
	assert.Contains(t, body, `<meta property="og:url" content="https://www.robinandmadeline.com/i/sometoken123" />`)

	// The token reached the resolver exactly once, in its original case.
	assert.Equal(t, 1, titler.calls)
	assert.Equal(t, "sometoken123", titler.gotToken)
}

func TestInjectMeta_InfoPageFallsBackToGenericTitle(t *testing.T) {
	// An unknown token or a party with no named primary returns an empty name: the
	// title keeps the generic fallback while staying noindex with a self-
	// referential og:url, exactly as before the title was personalized.
	body := injectInfo(t, "/i/sometoken123", &stubInfoTitler{name: ""})
	assert.Contains(t, body, "<title>Your Details · Robin &amp; Madeline</title>")
	assert.Contains(t, body, `<meta name="robots" content="noindex" />`)
	assert.Contains(t, body, `<meta property="og:url" content="https://www.robinandmadeline.com/i/sometoken123" />`)
}

func TestInjectMeta_InfoPageFallsBackOnLookupError(t *testing.T) {
	// A lookup failure must not fail the render: the title falls back to the
	// generic label (the error is logged, not propagated).
	body := injectInfo(t, "/i/sometoken123", &stubInfoTitler{err: errors.New("db down")})
	assert.Contains(t, body, "<title>Your Details · Robin &amp; Madeline</title>")
}

func TestInjectMeta_InfoPagePreservesTokenCase(t *testing.T) {
	// React Router matches routes case-insensitively, so a mixed-case /I/ still
	// gets the info treatment, but the token must reach the (case-sensitive) lookup
	// in its original case, not the lowercased route key.
	titler := &stubInfoTitler{name: "Ada Lovelace"}
	body := injectInfo(t, "/I/AbC123", titler)
	assert.Equal(t, "AbC123", titler.gotToken)
	assert.Contains(t, body, "<title>Ada&#39;s Info · Robin &amp; Madeline</title>")
}

func TestInjectMeta_NilTitlerFallsBackToGenericTitle(t *testing.T) {
	// With no titler wired (the SPA served without an info service), the info route
	// keeps the generic title rather than panicking.
	body := injectInfo(t, "/i/sometoken123", nil)
	assert.Contains(t, body, "<title>Your Details · Robin &amp; Madeline</title>")
}

func TestInjectMeta_TitlerConsultedOnlyForInfoRoute(t *testing.T) {
	// The other noindex-titled routes keep their static labels and never hit the
	// resolver: only /i/ is personalized.
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
