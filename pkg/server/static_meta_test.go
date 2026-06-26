package server_test

import (
	"context"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"testing"

	"github.com/robinjoseph08/robinandmadeline.com/pkg/server"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

// metaHost is the canonical host configured for the meta server. Requests must
// carry it so the canonical-host redirect middleware (which production puts in
// front of the static handler) passes them through to the shell.
const metaHost = "www.robinandmadeline.com"

// getCanonical is get with the canonical Host set, needed once a canonical host
// is configured (the default httptest host would be 301-redirected before
// reaching the shell).
func getCanonical(handler http.Handler, path string) *httptest.ResponseRecorder {
	req := httptest.NewRequestWithContext(context.Background(), http.MethodGet, path, http.NoBody)
	req.Host = metaHost
	rec := httptest.NewRecorder()
	handler.ServeHTTP(rec, req)
	return rec
}

// metaShell mirrors the relevant head of the real index.html: the title plus
// the Open Graph and Twitter tags #68 added. og:description and
// twitter:description are wrapped across lines, as prettier formats them, so
// the tests exercise the whitespace-tolerant injection (not just single-line
// tags).
const metaShell = `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="description" content="Robin and Madeline's wedding website" />
    <title>Robin &amp; Madeline</title>

    <meta property="og:type" content="website" />
    <meta property="og:site_name" content="Robin &amp; Madeline" />
    <meta property="og:title" content="Robin &amp; Madeline" />
    <meta
      property="og:description"
      content="Robin and Madeline's wedding website"
    />
    <meta property="og:url" content="https://www.robinandmadeline.com/" />
    <meta property="og:image" content="https://www.robinandmadeline.com/og-image.jpg" />

    <meta name="twitter:card" content="summary_large_image" />
    <meta name="twitter:title" content="Robin &amp; Madeline" />
    <meta
      name="twitter:description"
      content="Robin and Madeline's wedding website"
    />
    <meta name="twitter:image" content="https://www.robinandmadeline.com/og-image.jpg" />
  </head>
  <body><div id="root"></div></body>
</html>`

// newMetaServer serves metaShell as the SPA shell with a canonical host set, so
// injected og:url values are absolute.
func newMetaServer(t *testing.T) http.Handler {
	t.Helper()
	dir := t.TempDir()
	require.NoError(t, os.WriteFile(filepath.Join(dir, "index.html"), []byte(metaShell), 0o600))
	cfg := newTestConfig(t)
	cfg.StaticDir = dir
	cfg.CanonicalHost = metaHost
	return server.New(cfg, nil).Handler
}

func TestShellMeta_PublicRouteOverridesTitleAndPreview(t *testing.T) {
	rec := getCanonical(newMetaServer(t), "/schedule")
	require.Equal(t, http.StatusOK, rec.Code)
	body := rec.Body.String()

	// Title and both preview titles carry the page label plus the app name.
	assert.Contains(t, body, "<title>Schedule · Robin &amp; Madeline</title>")
	assert.Contains(t, body, `<meta property="og:title" content="Schedule · Robin &amp; Madeline" />`)
	assert.Contains(t, body, `<meta name="twitter:title" content="Schedule · Robin &amp; Madeline" />`)

	// og:url is the route's absolute canonical URL, not the home default.
	assert.Contains(t, body, `<meta property="og:url" content="https://www.robinandmadeline.com/schedule" />`)

	// The page description replaces the site default everywhere it appears
	// (name=description and the multi-line og/twitter description tags), so the
	// generic default is gone.
	assert.Contains(t, body, "Times and places for Robin and Madeline&#39;s wedding weekend")
	assert.NotContains(t, body, "Robin and Madeline's wedding website")

	// Tags we do not target are left intact.
	assert.Contains(t, body, `<meta property="og:site_name" content="Robin &amp; Madeline" />`)
	assert.Contains(t, body, `<meta property="og:image" content="https://www.robinandmadeline.com/og-image.jpg" />`)

	assert.Equal(t, "no-cache", rec.Header().Get("Cache-Control"))
}

func TestShellMeta_HomeRouteUsesAppNameAlone(t *testing.T) {
	rec := getCanonical(newMetaServer(t), "/")
	require.Equal(t, http.StatusOK, rec.Code)
	body := rec.Body.String()

	// No label segment for the home page: the title stays the bare app name.
	assert.Contains(t, body, "<title>Robin &amp; Madeline</title>")
	assert.Contains(t, body, `<meta property="og:url" content="https://www.robinandmadeline.com/" />`)
	assert.Contains(t, body, "Robin and Madeline are getting married on April 10, 2027")
}

func TestShellMeta_PrivateRoutesAreNoindexed(t *testing.T) {
	srv := newMetaServer(t)
	for _, path := range []string{"/admin", "/admin/guests", "/i/some-token", "/u/some-guest-id"} {
		rec := getCanonical(srv, path)
		require.Equal(t, http.StatusOK, rec.Code, path)
		body := rec.Body.String()
		assert.Contains(t, body, `<meta name="robots" content="noindex" />`, path)
		// Private routes keep the default title; they are never shared.
		assert.Contains(t, body, "<title>Robin &amp; Madeline</title>", path)
	}
}

func TestShellMeta_UnknownRouteIsUnchanged(t *testing.T) {
	// A client route with no metadata entry and no private prefix (a puzzle
	// slug, an RSVP flow step) is served verbatim: no override, no noindex.
	rec := getCanonical(newMetaServer(t), "/games/mini")
	require.Equal(t, http.StatusOK, rec.Code)
	assert.Equal(t, metaShell, rec.Body.String())
}

func TestShellMeta_FallbackHostWhenNoCanonicalHost(t *testing.T) {
	// Without a canonical host configured, og:url is built from the request so
	// it is still absolute.
	dir := t.TempDir()
	require.NoError(t, os.WriteFile(filepath.Join(dir, "index.html"), []byte(metaShell), 0o600))
	cfg := newTestConfig(t)
	cfg.StaticDir = dir
	srv := server.New(cfg, nil).Handler

	rec := get(srv, "/faq")
	require.Equal(t, http.StatusOK, rec.Code)
	// The httptest request host is example.com over plain HTTP.
	assert.Contains(t, rec.Body.String(), `content="http://example.com/faq"`)
}
