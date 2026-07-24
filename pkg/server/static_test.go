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

// newStaticDir lays out a minimal built-frontend directory shaped like the
// Vite bundle: index.html and a stable-named root file (favicon.ico) at the
// root and a content-hashed file under assets/.
func newStaticDir(t *testing.T) string {
	t.Helper()
	dir := t.TempDir()
	require.NoError(t, os.WriteFile(filepath.Join(dir, "index.html"), []byte("<html>spa shell</html>"), 0o600))
	require.NoError(t, os.WriteFile(filepath.Join(dir, "favicon.ico"), []byte("icon bytes"), 0o600))
	require.NoError(t, os.MkdirAll(filepath.Join(dir, "assets"), 0o700))
	require.NoError(t, os.WriteFile(filepath.Join(dir, "assets", "index-abc123.js"), []byte("console.log('hashed')"), 0o600))
	return dir
}

func get(handler http.Handler, path string) *httptest.ResponseRecorder {
	req := httptest.NewRequestWithContext(context.Background(), http.MethodGet, path, http.NoBody)
	rec := httptest.NewRecorder()
	handler.ServeHTTP(rec, req)
	return rec
}

func TestStaticServing_DisabledWithoutStaticDir(t *testing.T) {
	srv := server.New(newTestConfig(t), nil)

	// No StaticDir configured (dev: Vite serves the frontend): non-API paths
	// stay plain 404s.
	rec := get(srv.Handler, "/")
	assert.Equal(t, http.StatusNotFound, rec.Code)
}

func TestStaticServing_ServesSPAShell(t *testing.T) {
	cfg := newTestConfig(t)
	cfg.StaticDir = newStaticDir(t)
	srv := server.New(cfg, nil)

	rec := get(srv.Handler, "/")
	require.Equal(t, http.StatusOK, rec.Code)
	assert.Equal(t, "<html>spa shell</html>", rec.Body.String())
	// The shell must always be revalidated so a new deploy's hashed asset
	// references reach returning browsers.
	assert.Equal(t, "no-cache", rec.Header().Get("Cache-Control"))
}

func TestStaticServing_ServesEveryFrontendRouteShape(t *testing.T) {
	cfg := newTestConfig(t)
	cfg.StaticDir = newStaticDir(t)
	srv := server.New(cfg, nil)

	// This inventory mirrors app/router.tsx. Route parameters deliberately use
	// values that are not valid business IDs: the server classifies route shapes
	// and leaves entity, token, and puzzle validation to the client and API.
	targets := []string{
		"/", "/story", "/schedule", "/travel", "/games", "/games/not-a-puzzle",
		"/photos", "/faq", "/rsvp", "/rsvp/form", "/rsvp/confirmation",
		"/i/not-a-token", "/u/not-a-uuid", "/admin/login", "/admin",
		"/admin/parties", "/admin/parties/not-an-id", "/admin/guests",
		"/admin/events", "/admin/events/not-an-id", "/admin/photo-groups",
		"/admin/crossword", "/admin/emails", "/admin/emails/compose",
		"/admin/emails/templates", "/admin/emails/sends/not-an-id", "/admin/settings",
	}
	for _, target := range targets {
		for _, method := range []string{http.MethodGet, http.MethodHead} {
			req := httptest.NewRequestWithContext(context.Background(), method, target, http.NoBody)
			rec := httptest.NewRecorder()
			srv.Handler.ServeHTTP(rec, req)
			require.Equal(t, http.StatusOK, rec.Code, method+" "+target)
			assert.Equal(t, "no-cache", rec.Header().Get("Cache-Control"), method+" "+target)
			if method == http.MethodGet {
				assert.Equal(t, "<html>spa shell</html>", rec.Body.String(), target)
			} else {
				assert.Empty(t, rec.Body.String(), target)
			}
		}
	}
}

func TestStaticServing_RouteMatchingMirrorsCaseAndTrailingSlash(t *testing.T) {
	cfg := newTestConfig(t)
	cfg.StaticDir = newStaticDir(t)
	srv := server.New(cfg, nil)

	for _, target := range []string{"/StOrY", "/STORY/", "/AdMiN/PaRtIeS/anything/"} {
		rec := get(srv.Handler, target)
		require.Equal(t, http.StatusOK, rec.Code, target)
		assert.Equal(t, "<html>spa shell</html>", rec.Body.String(), target)
	}
}

func TestStaticServing_UnknownDocumentRoutesAre404(t *testing.T) {
	cfg := newTestConfig(t)
	cfg.StaticDir = newStaticDir(t)
	srv := server.New(cfg, nil)

	for _, target := range []string{
		"/unknown", "/rsvp/some/deep/link", "/admin/unknown", "/story/extra",
		"/i/token/extra", "/admin/parties/id/extra", "/story//", "/rsvp//form",
	} {
		rec := get(srv.Handler, target)
		require.Equal(t, http.StatusNotFound, rec.Code, target)
		assert.NotEqual(t, "<html>spa shell</html>", rec.Body.String(), target)
		assert.Empty(t, rec.Header().Get("Cache-Control"), target)
	}
}

func TestStaticServing_HashedAssetsAreImmutable(t *testing.T) {
	cfg := newTestConfig(t)
	cfg.StaticDir = newStaticDir(t)
	srv := server.New(cfg, nil)

	rec := get(srv.Handler, "/assets/index-abc123.js")
	require.Equal(t, http.StatusOK, rec.Code)
	assert.Equal(t, "console.log('hashed')", rec.Body.String())
	// Vite content-hashes asset filenames, so they can be cached forever.
	assert.Equal(t, "public, max-age=31536000, immutable", rec.Header().Get("Cache-Control"))
}

func TestStaticServing_RootFilesAreNoCache(t *testing.T) {
	cfg := newTestConfig(t)
	cfg.StaticDir = newStaticDir(t)
	srv := server.New(cfg, nil)

	// Root-level files keep their names across deploys (only assets/ is
	// content-hashed), so they must be revalidated on every visit: an
	// immutable /index.html would pin browsers to a stale deploy's asset
	// references for a year.
	for _, target := range []string{"/index.html", "/favicon.ico"} {
		rec := get(srv.Handler, target)
		require.Equal(t, http.StatusOK, rec.Code, target)
		assert.Equal(t, "no-cache", rec.Header().Get("Cache-Control"), target)
	}
}

func TestStaticServing_HEADRequestsAreServed(t *testing.T) {
	cfg := newTestConfig(t)
	cfg.StaticDir = newStaticDir(t)
	srv := server.New(cfg, nil)

	// Uptime monitors and link checkers probe with HEAD; it must behave like
	// GET (status and caching) with an empty body.
	tests := []struct {
		target           string
		wantCacheControl string
	}{
		{target: "/", wantCacheControl: "no-cache"},
		{target: "/assets/index-abc123.js", wantCacheControl: "public, max-age=31536000, immutable"},
		{target: "/rsvp/form", wantCacheControl: "no-cache"},
		{target: "/admin/parties/not-an-id", wantCacheControl: "no-cache"},
	}
	for _, tt := range tests {
		req := httptest.NewRequestWithContext(context.Background(), http.MethodHead, tt.target, http.NoBody)
		rec := httptest.NewRecorder()
		srv.Handler.ServeHTTP(rec, req)
		require.Equal(t, http.StatusOK, rec.Code, tt.target)
		assert.Equal(t, tt.wantCacheControl, rec.Header().Get("Cache-Control"), tt.target)
		assert.Empty(t, rec.Body.String(), tt.target)
	}

	for _, target := range []string{"/unknown", "/i/token/extra", "/assets/index-gone.js"} {
		getRec := get(srv.Handler, target)
		req := httptest.NewRequestWithContext(context.Background(), http.MethodHead, target, http.NoBody)
		headRec := httptest.NewRecorder()
		srv.Handler.ServeHTTP(headRec, req)
		require.Equal(t, getRec.Code, headRec.Code, target)
		assert.Equal(t, getRec.Header().Get("Cache-Control"), headRec.Header().Get("Cache-Control"), target)
		assert.Empty(t, headRec.Body.String(), target)
	}
}

func TestStaticServing_MissingAssetIs404NotShell(t *testing.T) {
	cfg := newTestConfig(t)
	cfg.StaticDir = newStaticDir(t)
	srv := server.New(cfg, nil)

	// A missing hashed asset must 404, never fall back to index.html: a
	// module script or stylesheet request would otherwise receive HTML.
	rec := get(srv.Handler, "/assets/index-gone.js")
	assert.Equal(t, http.StatusNotFound, rec.Code)
	assert.NotEqual(t, "<html>spa shell</html>", rec.Body.String())
}

func TestStaticServing_UnreadableAssetIs404WithoutCacheHeader(t *testing.T) {
	if os.Getuid() == 0 {
		t.Skip("file permissions do not bind for root")
	}

	cfg := newTestConfig(t)
	dir := newStaticDir(t)
	require.NoError(t, os.WriteFile(filepath.Join(dir, "assets", "locked-def456.js"), []byte("nope"), 0o000))
	cfg.StaticDir = dir
	srv := server.New(cfg, nil)

	// A file that stats but fails to open must not send its 404 with the
	// immutable cache policy, or the error would be pinned to the asset URL
	// for a year.
	rec := get(srv.Handler, "/assets/locked-def456.js")
	require.Equal(t, http.StatusNotFound, rec.Code)
	assert.Empty(t, rec.Header().Get("Cache-Control"))
}

func TestStaticServing_APIRoutesTakePrecedence(t *testing.T) {
	cfg := newTestConfig(t)
	cfg.StaticDir = newStaticDir(t)
	srv := server.New(cfg, nil)

	// A real API route still works.
	health := get(srv.Handler, "/api/health")
	require.Equal(t, http.StatusOK, health.Code)
	assert.Equal(t, "application/json", health.Header().Get("Content-Type"))

	// An unknown API path renders the JSON 404 envelope, not the SPA shell.
	missing := get(srv.Handler, "/api/no-such-route")
	require.Equal(t, http.StatusNotFound, missing.Code)
	assert.Contains(t, missing.Body.String(), `"error"`)

	// Bare /api is API surface too, not a client route.
	bare := get(srv.Handler, "/api")
	require.Equal(t, http.StatusNotFound, bare.Code)
	assert.Contains(t, bare.Body.String(), `"error"`)

	// A document route merely sharing the /api prefix is not API surface, but
	// it is not on the frontend allowlist either.
	apiary := get(srv.Handler, "/apiary")
	require.Equal(t, http.StatusNotFound, apiary.Code)
	assert.NotEqual(t, "<html>spa shell</html>", apiary.Body.String())
}

func TestStaticServing_NonGETFallsThroughToRouter(t *testing.T) {
	cfg := newTestConfig(t)
	cfg.StaticDir = newStaticDir(t)
	srv := server.New(cfg, nil)

	// Writes never hit the filesystem or frontend shell handling: a POST to a
	// client route is a routing 404, not a 200 shell that would mask the
	// dropped write.
	req := httptest.NewRequestWithContext(context.Background(), http.MethodPost, "/rsvp", http.NoBody)
	rec := httptest.NewRecorder()
	srv.Handler.ServeHTTP(rec, req)
	require.Equal(t, http.StatusNotFound, rec.Code)
	assert.NotEqual(t, "<html>spa shell</html>", rec.Body.String())
}

func TestStaticServing_DirectoriesAreNotFilesOrRoutes(t *testing.T) {
	cfg := newTestConfig(t)
	cfg.StaticDir = newStaticDir(t)
	srv := server.New(cfg, nil)

	// A directory is neither a servable static file nor a frontend route.
	for _, target := range []string{"/assets", "/assets/"} {
		rec := get(srv.Handler, target)
		require.Equal(t, http.StatusNotFound, rec.Code, target)
		assert.NotEqual(t, "<html>spa shell</html>", rec.Body.String(), target)
		assert.Empty(t, rec.Header().Get("Cache-Control"), target)
	}
}

func TestStaticServing_LiteralPercentPathsAreNotDoubleDecoded(t *testing.T) {
	cfg := newTestConfig(t)
	dir := newStaticDir(t)
	require.NoError(t, os.WriteFile(filepath.Join(dir, "100%.txt"), []byte("percent file"), 0o600))
	cfg.StaticDir = dir
	srv := server.New(cfg, nil)

	// The request path is decoded exactly once: %25 arrives as a literal %
	// and must match the file on disk, not be decoded a second time.
	file := get(srv.Handler, "/100%25.txt")
	require.Equal(t, http.StatusOK, file.Code)
	assert.Equal(t, "percent file", file.Body.String())

	// A non-file document path is still subject to the route allowlist.
	route := get(srv.Handler, "/100%25off")
	require.Equal(t, http.StatusNotFound, route.Code)
	assert.NotEqual(t, "<html>spa shell</html>", route.Body.String())
}

func TestStaticServing_MissingShellIs404(t *testing.T) {
	cfg := newTestConfig(t)
	cfg.StaticDir = t.TempDir() // no index.html: a misconfigured STATIC_DIR
	srv := server.New(cfg, nil)

	// The fallback file being absent must surface as a 404, not a panic or a
	// hung response.
	rec := get(srv.Handler, "/")
	assert.Equal(t, http.StatusNotFound, rec.Code)
}

func TestStaticServing_PathTraversalStaysInsideRoot(t *testing.T) {
	// A sentinel file sits one level above the static root; if traversal
	// protection regresses, its content shows up in a response body.
	parent := t.TempDir()
	require.NoError(t, os.WriteFile(filepath.Join(parent, "secret.txt"), []byte("outside the root"), 0o600))
	root := filepath.Join(parent, "public")
	require.NoError(t, os.MkdirAll(root, 0o700))
	require.NoError(t, os.WriteFile(filepath.Join(root, "index.html"), []byte("<html>spa shell</html>"), 0o600))

	cfg := newTestConfig(t)
	cfg.StaticDir = root
	srv := server.New(cfg, nil)

	// Traversal paths are rejected rather than cleaned into either a static
	// file or a valid frontend route.
	for _, target := range []string{"/../secret.txt", "/%2e%2e/secret.txt", "/..%2Fsecret.txt"} {
		rec := get(srv.Handler, target)
		require.Equal(t, http.StatusNotFound, rec.Code, target)
		assert.NotEqual(t, "<html>spa shell</html>", rec.Body.String(), target)
		assert.NotContains(t, rec.Body.String(), "outside the root", target)
	}
}

func TestStaticServing_UnsafePathsCannotBecomeFrontendRoutes(t *testing.T) {
	cfg := newTestConfig(t)
	cfg.StaticDir = newStaticDir(t)
	srv := server.New(cfg, nil)

	targets := []string{
		"/rsvp%2fform", "/admin%2fparties", // encoded separators
		"/story\\", "/admin\\parties", // literal backslashes
		"//story", "/admin//parties", // repeated interior separators
		"/./story", "/admin/../story", // traversal and normalization
		"/i/token/extra", "/games/slug/extra", "/admin/events/id/extra",
	}
	for _, target := range targets {
		rec := get(srv.Handler, target)
		require.Equal(t, http.StatusNotFound, rec.Code, target)
		assert.NotEqual(t, "<html>spa shell</html>", rec.Body.String(), target)
	}
}

func TestStaticServing_MalformedRawEscapeIsRejected(t *testing.T) {
	cfg := newTestConfig(t)
	cfg.StaticDir = newStaticDir(t)
	srv := server.New(cfg, nil)

	// net/http rejects malformed and inconsistent escapes while parsing a real
	// request. Build RawPath directly to pin the middleware's defensive behavior.
	for _, rawPath := range []string{"/story%", "/schedule"} {
		req := httptest.NewRequestWithContext(context.Background(), http.MethodGet, "/story", http.NoBody)
		req.URL.RawPath = rawPath
		rec := httptest.NewRecorder()
		srv.Handler.ServeHTTP(rec, req)
		require.Equal(t, http.StatusNotFound, rec.Code, rawPath)
		assert.NotEqual(t, "<html>spa shell</html>", rec.Body.String(), rawPath)
	}
}

func TestStaticServing_ExistingFileWinsBeforeRouteClassification(t *testing.T) {
	cfg := newTestConfig(t)
	dir := newStaticDir(t)
	require.NoError(t, os.WriteFile(filepath.Join(dir, "story"), []byte("static story"), 0o600))
	cfg.StaticDir = dir
	srv := server.New(cfg, nil)

	rec := get(srv.Handler, "/story")
	require.Equal(t, http.StatusOK, rec.Code)
	assert.Equal(t, "static story", rec.Body.String())
	assert.Equal(t, "no-cache", rec.Header().Get("Cache-Control"))
}

func TestStaticServing_DynamicSegmentsMustBeSafeAndSingle(t *testing.T) {
	cfg := newTestConfig(t)
	cfg.StaticDir = newStaticDir(t)
	srv := server.New(cfg, nil)

	for _, target := range []string{
		"/i/value-with-dashes", "/u/not-a-business-valid-uuid", "/games/unknown-slug",
		"/admin/parties/not-a-business-valid-id", "/admin/events/123", "/admin/emails/sends/x",
	} {
		rec := get(srv.Handler, target)
		require.Equal(t, http.StatusOK, rec.Code, target)
	}

	for _, target := range []string{"/i/.", "/u/..", "/games/%00", "/games/%FF", "/admin/parties/id/extra"} {
		rec := get(srv.Handler, target)
		require.Equal(t, http.StatusNotFound, rec.Code, target)
	}
}
