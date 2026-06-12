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

func TestStaticServing_FallsBackToShellForClientRoutes(t *testing.T) {
	cfg := newTestConfig(t)
	cfg.StaticDir = newStaticDir(t)
	srv := server.New(cfg, nil)

	// A client-side route has no file on disk; the SPA shell is served so the
	// frontend router can take over.
	rec := get(srv.Handler, "/rsvp/some/deep/link")
	require.Equal(t, http.StatusOK, rec.Code)
	assert.Equal(t, "<html>spa shell</html>", rec.Body.String())
	assert.Equal(t, "no-cache", rec.Header().Get("Cache-Control"))
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
		{target: "/rsvp/some/deep/link", wantCacheControl: "no-cache"},
	}
	for _, tt := range tests {
		req := httptest.NewRequestWithContext(context.Background(), http.MethodHead, tt.target, http.NoBody)
		rec := httptest.NewRecorder()
		srv.Handler.ServeHTTP(rec, req)
		require.Equal(t, http.StatusOK, rec.Code, tt.target)
		assert.Equal(t, tt.wantCacheControl, rec.Header().Get("Cache-Control"), tt.target)
		assert.Empty(t, rec.Body.String(), tt.target)
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

	// A frontend route merely sharing the /api prefix is not API surface; it
	// gets the shell.
	apiary := get(srv.Handler, "/apiary")
	require.Equal(t, http.StatusOK, apiary.Code)
	assert.Equal(t, "<html>spa shell</html>", apiary.Body.String())
}

func TestStaticServing_NonGETFallsThroughToRouter(t *testing.T) {
	cfg := newTestConfig(t)
	cfg.StaticDir = newStaticDir(t)
	srv := server.New(cfg, nil)

	// Writes never hit the filesystem or the SPA fallback: a POST to a
	// client route is a routing 404, not a 200 shell that would mask the
	// dropped write.
	req := httptest.NewRequestWithContext(context.Background(), http.MethodPost, "/rsvp", http.NoBody)
	rec := httptest.NewRecorder()
	srv.Handler.ServeHTTP(rec, req)
	require.Equal(t, http.StatusNotFound, rec.Code)
	assert.NotEqual(t, "<html>spa shell</html>", rec.Body.String())
}

func TestStaticServing_DirectoriesFallBackToShell(t *testing.T) {
	cfg := newTestConfig(t)
	cfg.StaticDir = newStaticDir(t)
	srv := server.New(cfg, nil)

	// A directory is not a servable file; it falls back to the shell like
	// any other client route.
	for _, target := range []string{"/assets", "/assets/"} {
		rec := get(srv.Handler, target)
		require.Equal(t, http.StatusOK, rec.Code, target)
		assert.Equal(t, "<html>spa shell</html>", rec.Body.String(), target)
		assert.Equal(t, "no-cache", rec.Header().Get("Cache-Control"), target)
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

	// A client route whose decoded path contains a stray % still gets the
	// shell instead of leaking a router 404.
	route := get(srv.Handler, "/100%25off")
	require.Equal(t, http.StatusOK, route.Code)
	assert.Equal(t, "<html>spa shell</html>", route.Body.String())
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

	// Plain and percent-encoded escape attempts resolve inside the static
	// root, so they fall back to the SPA shell instead of reading the
	// sentinel.
	for _, target := range []string{"/../secret.txt", "/%2e%2e/secret.txt", "/..%2Fsecret.txt"} {
		rec := get(srv.Handler, target)
		require.Equal(t, http.StatusOK, rec.Code, target)
		assert.Equal(t, "<html>spa shell</html>", rec.Body.String(), target)
		assert.NotContains(t, rec.Body.String(), "outside the root", target)
	}
}
