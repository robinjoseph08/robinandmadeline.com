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
// Vite bundle: index.html at the root and a content-hashed file under assets/.
func newStaticDir(t *testing.T) string {
	t.Helper()
	dir := t.TempDir()
	require.NoError(t, os.WriteFile(filepath.Join(dir, "index.html"), []byte("<html>spa shell</html>"), 0o600))
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

func TestStaticServing_MissingAssetIs404NotShell(t *testing.T) {
	cfg := newTestConfig(t)
	cfg.StaticDir = newStaticDir(t)
	srv := server.New(cfg, nil)

	// A missing hashed asset must 404, never fall back to index.html: the
	// long-lived asset cache headers would otherwise pin the shell's HTML to a
	// .js URL.
	rec := get(srv.Handler, "/assets/index-gone.js")
	assert.Equal(t, http.StatusNotFound, rec.Code)
	assert.NotEqual(t, "<html>spa shell</html>", rec.Body.String())
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
	cfg := newTestConfig(t)
	cfg.StaticDir = newStaticDir(t)
	srv := server.New(cfg, nil)

	// An escape attempt resolves inside the static root, so it falls back to
	// the SPA shell instead of reading files outside it.
	rec := get(srv.Handler, "/../config.go")
	require.Equal(t, http.StatusOK, rec.Code)
	assert.Equal(t, "<html>spa shell</html>", rec.Body.String())
}
