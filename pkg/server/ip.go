package server

import (
	"net"
	"net/http"
	"strings"

	"github.com/labstack/echo/v4"
)

// ipExtractor picks how the server resolves the client IP that keys the
// per-IP login rate limiter (ADR 0006).
//
// Without an explicit extractor Echo's RealIP would believe an
// X-Forwarded-For header on any connection, letting a direct caller mint
// fresh rate-limit buckets by spoofing it. So both modes are explicit:
//
//   - trustProxyHeaders=false (dev, tests, anywhere the server is hit
//     directly): only the socket peer address counts; forwarded headers are
//     ignored.
//   - trustProxyHeaders=true (production behind Fly's edge proxy): the proxy
//     terminates the client connection, so the socket address is the proxy's
//     and the real client IP arrives in the Fly-Client-IP header, with
//     X-Forwarded-For as the fallback.
func ipExtractor(trustProxyHeaders bool) echo.IPExtractor {
	if !trustProxyHeaders {
		return echo.ExtractIPDirect()
	}

	// Fly sets Fly-Client-IP on every proxied request. The X-Forwarded-For
	// fallback walks the chain right to left, skipping trusted hops (private
	// ranges, which is where Fly's proxy connects from), so a client-supplied
	// prefix in the header cannot impersonate another address.
	xff := echo.ExtractIPFromXFFHeader()
	return func(req *http.Request) string {
		if raw := strings.TrimSpace(req.Header.Get("Fly-Client-IP")); raw != "" {
			if ip := net.ParseIP(raw); ip != nil {
				return ip.String()
			}
		}
		return xff(req)
	}
}
