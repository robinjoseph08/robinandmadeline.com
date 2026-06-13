package server

import (
	"net/http"
	"os"
	"path/filepath"
	"strings"

	"github.com/labstack/echo/v4"
)

// Cache-Control values for the two kinds of files in the Vite bundle.
//
// Vite content-hashes everything under assets/, so a given asset URL never
// changes content and can be cached forever. index.html (and any other
// root-level file) keeps its name across deploys, so browsers must revalidate
// it to pick up a new deploy's hashed asset references.
const (
	cacheControlImmutable = "public, max-age=31536000, immutable"
	cacheControlNoCache   = "no-cache"
)

// staticMiddleware serves the built frontend out of root with an SPA
// fallback: a GET/HEAD for a path with no file on disk gets index.html so the
// client-side router can take over. API paths are never touched, so unknown
// /api routes keep rendering the JSON 404 envelope, and a missing file under
// assets/ is a real 404 rather than the shell (a module script or stylesheet
// request would otherwise receive HTML).
func staticMiddleware(root string) echo.MiddlewareFunc {
	return func(next echo.HandlerFunc) echo.HandlerFunc {
		return func(c echo.Context) error {
			req := c.Request()
			if req.Method != http.MethodGet && req.Method != http.MethodHead {
				return next(c)
			}
			if isAPIPath(req.URL.Path) {
				return next(c)
			}

			// URL.Path is already percent-decoded by net/url; decoding again
			// would corrupt names containing a literal "%". Rooting Clean at "/"
			// collapses any ".." segments before the join, so the resolved path
			// cannot escape the static root.
			rel := filepath.Clean("/" + req.URL.Path)
			name := filepath.Join(root, rel)

			if info, err := os.Stat(name); err == nil && !info.IsDir() {
				return serveFile(c, name, assetCacheControl(rel))
			}

			// No file: hashed-asset misses 404 through the router; everything
			// else is a client-side route and gets the SPA shell.
			if strings.HasPrefix(rel, "/assets/") {
				return next(c)
			}
			return serveFile(c, filepath.Join(root, "index.html"), cacheControlNoCache)
		}
	}
}

// serveFile sends a file with the given Cache-Control header, clearing the
// header again if the send fails before writing (an unreadable or vanished
// file): the resulting 404 envelope must never carry the file's cache policy,
// or an immutable 404 would be pinned to an asset URL for a year.
func serveFile(c echo.Context, name, cacheControl string) error {
	c.Response().Header().Set("Cache-Control", cacheControl)
	if err := c.File(name); err != nil {
		c.Response().Header().Del("Cache-Control")
		return err
	}
	return nil
}

// isAPIPath reports whether the request path belongs to the API surface,
// which the static middleware and its SPA fallback must never shadow.
func isAPIPath(p string) bool {
	return p == "/api" || strings.HasPrefix(p, "/api/")
}

// assetCacheControl picks the Cache-Control for a file that exists on disk:
// immutable for Vite's content-hashed assets, no-cache for everything else
// (index.html and any stable-named root files).
func assetCacheControl(rel string) string {
	if strings.HasPrefix(rel, "/assets/") {
		return cacheControlImmutable
	}
	return cacheControlNoCache
}
