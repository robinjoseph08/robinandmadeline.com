package server_test

import (
	"context"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"runtime"
	"strings"
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

	// Title and both preview titles carry the page label plus the app name, and
	// the title is replaced in place (not appended) so there is exactly one.
	assert.Contains(t, body, "<title>Schedule · Robin &amp; Madeline</title>")
	assert.Equal(t, 1, strings.Count(body, "<title>"))
	assert.Contains(t, body, `<meta property="og:title" content="Schedule · Robin &amp; Madeline" />`)
	assert.Contains(t, body, `<meta name="twitter:title" content="Schedule · Robin &amp; Madeline" />`)

	// og:url is the route's absolute canonical URL, not the home default.
	assert.Contains(t, body, `<meta property="og:url" content="https://www.robinandmadeline.com/schedule" />`)

	// The page description replaces the site default everywhere it appears
	// (name=description and the multi-line og/twitter description tags), so the
	// generic default is gone.
	assert.Contains(t, body, "Times and places for Robin and Madeline&#39;s wedding at Arrowwood")
	assert.NotContains(t, body, "Robin and Madeline's wedding website")

	// Tags we do not target are left intact: the shared image (both og and
	// twitter), the card type, and the site name.
	assert.Contains(t, body, `<meta property="og:site_name" content="Robin &amp; Madeline" />`)
	assert.Contains(t, body, `<meta property="og:image" content="https://www.robinandmadeline.com/og-image.jpg" />`)
	assert.Contains(t, body, `<meta name="twitter:image" content="https://www.robinandmadeline.com/og-image.jpg" />`)
	assert.Contains(t, body, `<meta name="twitter:card" content="summary_large_image" />`)

	assert.Equal(t, "no-cache", rec.Header().Get("Cache-Control"))
}

func TestShellMeta_HomeRouteUsesAppNameAlone(t *testing.T) {
	rec := getCanonical(newMetaServer(t), "/")
	require.Equal(t, http.StatusOK, rec.Code)
	body := rec.Body.String()

	// No label segment for the home page: the title stays the bare app name.
	assert.Contains(t, body, "<title>Robin &amp; Madeline</title>")
	assert.Contains(t, body, `<meta property="og:url" content="https://www.robinandmadeline.com/" />`)
	// The home description still replaces the site default, proving the override
	// ran even though the title and og:url happen to equal the shell defaults.
	assert.Contains(t, body, "Robin and Madeline are getting married on April 10, 2027")
	assert.NotContains(t, body, "Robin and Madeline's wedding website")
}

const noindexTag = `<meta name="robots" content="noindex" />`

func TestShellMeta_AdminRoutesAreNoindexedWithDefaultTitle(t *testing.T) {
	srv := newMetaServer(t)
	// Admin routes are login-gated and never shared, so they get noindex with the
	// default title untouched. The mixed-case entry confirms matching is
	// case-insensitive: React Router would serve the admin page for these, so the
	// server must noindex them too rather than ship an indexable shell.
	for _, path := range []string{"/admin", "/admin/guests", "/Admin/Parties"} {
		rec := getCanonical(srv, path)
		require.Equal(t, http.StatusOK, rec.Code, path)
		body := rec.Body.String()
		assert.Contains(t, body, noindexTag, path)
		// The tag must sit inside <head>; a crawler ignores robots meta in <body>.
		assert.Less(t, strings.Index(body, noindexTag), strings.Index(body, "</head>"), path)
		// No label for admin: the title stays the bare app name.
		assert.Contains(t, body, "<title>Robin &amp; Madeline</title>", path)
	}
}

func TestShellMeta_NoindexTitledRoutesGetGenericTitle(t *testing.T) {
	srv := newMetaServer(t)
	// Routes that must not be indexed but still deserve a sensible shared-link
	// preview: the per-guest token/UUID links (no login, reachable by anyone
	// holding the link) and the RSVP flow steps. Each gets a generic,
	// guest-data-free title while staying noindex. Mixed case confirms the match
	// is case-insensitive.
	for _, tc := range []struct{ path, title string }{
		{"/i/some-token", "Your Details · Robin &amp; Madeline"},
		{"/I/Some-Token", "Your Details · Robin &amp; Madeline"},
		{"/u/some-guest-id", "Unsubscribe · Robin &amp; Madeline"},
		{"/rsvp/form", "RSVP · Robin &amp; Madeline"},
		{"/rsvp/confirmation", "RSVP Confirmed · Robin &amp; Madeline"},
	} {
		rec := getCanonical(srv, tc.path)
		require.Equal(t, http.StatusOK, rec.Code, tc.path)
		body := rec.Body.String()

		// Still noindex, inside <head>.
		assert.Contains(t, body, noindexTag, tc.path)
		assert.Less(t, strings.Index(body, noindexTag), strings.Index(body, "</head>"), tc.path)

		// The title and both preview titles carry the generic label, replaced in
		// place so there is exactly one <title>.
		assert.Contains(t, body, "<title>"+tc.title+"</title>", tc.path)
		assert.Equal(t, 1, strings.Count(body, "<title>"), tc.path)
		assert.Contains(t, body, `<meta property="og:title" content="`+tc.title+`" />`, tc.path)
		assert.Contains(t, body, `<meta name="twitter:title" content="`+tc.title+`" />`, tc.path)

		// We add only the title: the description stays the site default, and og:url
		// is not rewritten (never echoing a token into a tag).
		assert.Contains(t, body, "Robin and Madeline's wedding website", tc.path)
		assert.Contains(t, body, `<meta property="og:url" content="https://www.robinandmadeline.com/" />`, tc.path)
	}
}

func TestShellMeta_PuzzleRoutesGetTitleButStayNoindexWhileGated(t *testing.T) {
	srv := newMetaServer(t)
	// Each /games/:slug puzzle gets its own title (mirroring the puzzle registry).
	// The pages are gated client-side by RequireGamesAccess, so for now they are
	// also noindex; when that gate is removed they should become indexable. Mixed
	// case confirms the slug match is case-insensitive.
	for _, tc := range []struct{ path, title string }{
		{"/games/mini", "The Wedding Mini · Robin &amp; Madeline"},
		{"/games/crossword", "The Wedding Crossword · Robin &amp; Madeline"},
		{"/Games/Mini", "The Wedding Mini · Robin &amp; Madeline"},
	} {
		rec := getCanonical(srv, tc.path)
		require.Equal(t, http.StatusOK, rec.Code, tc.path)
		body := rec.Body.String()

		assert.Contains(t, body, "<title>"+tc.title+"</title>", tc.path)
		assert.Equal(t, 1, strings.Count(body, "<title>"), tc.path)
		assert.Contains(t, body, `<meta property="og:title" content="`+tc.title+`" />`, tc.path)
		assert.Contains(t, body, `<meta name="twitter:title" content="`+tc.title+`" />`, tc.path)
		// Gated content stays out of the index, inside <head>.
		assert.Contains(t, body, noindexTag, tc.path)
		assert.Less(t, strings.Index(body, noindexTag), strings.Index(body, "</head>"), tc.path)
	}
}

func TestShellMeta_UnknownRoutesAreUnchanged(t *testing.T) {
	srv := newMetaServer(t)
	// A client route with no metadata entry, no known puzzle slug, and no noindex
	// classification is served verbatim: no override, no noindex. This covers both
	// an unrouted path and an unknown puzzle slug (which the page renders as its
	// friendly not-found).
	for _, path := range []string{"/something-unrouted", "/games/does-not-exist"} {
		rec := getCanonical(srv, path)
		require.Equal(t, http.StatusOK, rec.Code, path)
		assert.Equal(t, metaShell, rec.Body.String(), path)
	}
}

func TestShellMeta_PublicRoutesAreIndexableAndCaseInsensitive(t *testing.T) {
	srv := newMetaServer(t)
	// Public landing pages must stay indexable: an accidental noindex (e.g. from
	// hoisting addNoindex above the dispatch) would silently drop the homepage and
	// every public page from search, so assert its absence. The mixed-case entry
	// also pins the case-insensitive lookup that the admin/token/puzzle buckets
	// test but the public bucket did not.
	for _, tc := range []struct{ path, title string }{
		{"/", "Robin &amp; Madeline"},
		{"/schedule", "Schedule · Robin &amp; Madeline"},
		{"/games", "Games · Robin &amp; Madeline"},
		{"/rsvp", "RSVP · Robin &amp; Madeline"},
		{"/Schedule", "Schedule · Robin &amp; Madeline"},
	} {
		rec := getCanonical(srv, tc.path)
		require.Equal(t, http.StatusOK, rec.Code, tc.path)
		body := rec.Body.String()
		assert.Contains(t, body, "<title>"+tc.title+"</title>", tc.path)
		assert.NotContains(t, body, noindexTag, tc.path)
	}
}

func TestShellMeta_TrailingSlashIsNormalized(t *testing.T) {
	srv := newMetaServer(t)
	// The static handler filepath.Clean's the request path before injectMeta sees
	// it, so a trailing slash is stripped and a route is classified the same with
	// or without one, matching React Router, which ignores trailing slashes. A
	// gated puzzle and an RSVP step therefore keep their noindex + title at the
	// slashed URL rather than falling through to an untreated shell.
	for _, tc := range []struct{ path, title string }{
		{"/games/mini/", "The Wedding Mini · Robin &amp; Madeline"},
		{"/rsvp/form/", "RSVP · Robin &amp; Madeline"},
	} {
		rec := getCanonical(srv, tc.path)
		require.Equal(t, http.StatusOK, rec.Code, tc.path)
		body := rec.Body.String()
		assert.Contains(t, body, "<title>"+tc.title+"</title>", tc.path)
		assert.Contains(t, body, noindexTag, tc.path)
	}
}

func TestShellMeta_FallbackHostWhenNoCanonicalHost(t *testing.T) {
	// Without a canonical host configured, og:url is built from the request host
	// and is still absolute. The scheme is always https (a deployed site is
	// served over TLS even when a proxy terminates it), never derived from a
	// client-supplied header.
	dir := t.TempDir()
	require.NoError(t, os.WriteFile(filepath.Join(dir, "index.html"), []byte(metaShell), 0o600))
	cfg := newTestConfig(t)
	cfg.StaticDir = dir
	srv := server.New(cfg, nil).Handler

	rec := get(srv, "/faq")
	require.Equal(t, http.StatusOK, rec.Code)
	// The httptest request host is example.com.
	assert.Contains(t, rec.Body.String(), `content="https://example.com/faq"`)
}

// TestShellMeta_RealIndexHTMLIsRewritten guards against index.html drifting
// (an attribute reorder, a quote-style change, a renamed tag) in a way that
// silently turns the regex injection into a no-op. It runs the real shell, not
// the metaShell fixture, through the handler and confirms the tags still get
// overridden.
func TestShellMeta_RealIndexHTMLIsRewritten(t *testing.T) {
	_, thisFile, _, ok := runtime.Caller(0)
	require.True(t, ok)
	// thisFile is pkg/server/static_meta_test.go; the real index.html is two
	// directories up at the repo root.
	realIndex := filepath.Join(filepath.Dir(thisFile), "..", "..", "index.html")
	content, err := os.ReadFile(realIndex)
	require.NoError(t, err)

	dir := t.TempDir()
	require.NoError(t, os.WriteFile(filepath.Join(dir, "index.html"), content, 0o600))
	cfg := newTestConfig(t)
	cfg.StaticDir = dir
	cfg.CanonicalHost = metaHost
	srv := server.New(cfg, nil).Handler

	body := getCanonical(srv, "/schedule").Body.String()
	// Title, preview title, description, and canonical URL are all overridden...
	assert.Contains(t, body, "<title>Schedule · Robin &amp; Madeline</title>")
	assert.Contains(t, body, `content="Schedule · Robin &amp; Madeline"`)
	assert.Contains(t, body, "Times and places for Robin and Madeline&#39;s wedding at Arrowwood")
	assert.Contains(t, body, `content="https://www.robinandmadeline.com/schedule"`)
	// ...the generic default description is gone...
	assert.NotContains(t, body, "Robin and Madeline's wedding website")
	// ...and the image we never touch survives.
	assert.Contains(t, body, "https://www.robinandmadeline.com/og-image.jpg")
}
