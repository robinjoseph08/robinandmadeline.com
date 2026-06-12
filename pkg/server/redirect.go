package server

import (
	"net"
	"net/http"
	"strings"

	"github.com/labstack/echo/v4"
)

// canonicalHostMiddleware permanently redirects every request whose Host is
// not canonicalHost to https://canonicalHost, preserving path and query: 301
// for GET/HEAD, 308 for everything else so a redirected write keeps its
// method and body instead of degrading to a GET. This is how the alternate
// domains (madelineandrobin.com, robeline.co) and www variants all land on
// the one canonical site: Cloudflare only does DNS, so the Go server is the
// layer that sees the original Host and consolidates it.
//
// The health endpoint is exempt because Fly's checks hit the machine with an
// internal Host and expect a 200, not a redirect. The exemption compares the
// raw (still-encoded) path, the same form Echo routes on, so it is exactly as
// wide as the route itself.
func canonicalHostMiddleware(canonicalHost string) echo.MiddlewareFunc {
	return func(next echo.HandlerFunc) echo.HandlerFunc {
		return func(c echo.Context) error {
			req := c.Request()
			if req.URL.EscapedPath() == healthPath {
				return next(c)
			}
			if strings.EqualFold(hostWithoutPort(req.Host), canonicalHost) {
				return next(c)
			}

			// EscapedPath keeps the request's percent-encoding intact: building
			// from the decoded Path would turn an encoded "?" into a bogus query
			// separator and encoded CRLF into raw control bytes in the header.
			target := "https://" + canonicalHost + req.URL.EscapedPath()
			if req.URL.RawQuery != "" {
				target += "?" + req.URL.RawQuery
			}
			status := http.StatusMovedPermanently
			if req.Method != http.MethodGet && req.Method != http.MethodHead {
				status = http.StatusPermanentRedirect
			}
			return c.Redirect(status, target)
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
