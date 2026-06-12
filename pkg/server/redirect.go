package server

import (
	"net"
	"net/http"
	"strings"

	"github.com/labstack/echo/v4"
)

// canonicalHostMiddleware 301-redirects every request whose Host is not
// canonicalHost to https://canonicalHost, preserving path and query. This is
// how the alternate domains (madelineandrobin.com, robeline.co) and www
// variants all land on the one canonical site: Cloudflare only does DNS, so
// the Go server is the layer that sees the original Host and consolidates it.
//
// The health endpoint is exempt because Fly's checks hit the machine with an
// internal Host and expect a 200, not a redirect.
func canonicalHostMiddleware(canonicalHost string) echo.MiddlewareFunc {
	return func(next echo.HandlerFunc) echo.HandlerFunc {
		return func(c echo.Context) error {
			req := c.Request()
			if req.URL.Path == healthPath {
				return next(c)
			}
			if strings.EqualFold(hostWithoutPort(req.Host), canonicalHost) {
				return next(c)
			}

			target := "https://" + canonicalHost + req.URL.Path
			if req.URL.RawQuery != "" {
				target += "?" + req.URL.RawQuery
			}
			return c.Redirect(http.StatusMovedPermanently, target)
		}
	}
}

// hostWithoutPort strips an explicit :port from a request Host so host
// comparison works whether or not the client sent one.
func hostWithoutPort(host string) string {
	if h, _, err := net.SplitHostPort(host); err == nil {
		return h
	}
	return host
}
