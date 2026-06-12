package server_test

import (
	"context"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/robinjoseph08/robinandmadeline.com/pkg/config"
	"github.com/robinjoseph08/robinandmadeline.com/pkg/server"
	"github.com/stretchr/testify/require"
)

// The login rate limiter keys on the client IP the server's IPExtractor
// resolves (ADR 0006), so these tests observe IP extraction through the
// limiter: requests that share a resolved IP share a budget, requests that
// don't, don't. A tight limit (burst 1, trickle refill) makes the second
// request on a bucket deterministically 429.
func newRateLimitedConfig(t *testing.T, trustProxyHeaders bool) *config.Config {
	t.Helper()
	cfg := newTestConfig(t)
	cfg.LoginRatePerMinute = 1
	cfg.LoginRateBurst = 1
	cfg.TrustProxyHeaders = trustProxyHeaders
	return cfg
}

// postLogin fires an admin login attempt with a deliberately wrong password
// (so every attempt is a 401 unless the limiter turns it into a 429) and
// returns the response status code. remoteAddr and headers shape how the
// server resolves the client IP.
func postLogin(t *testing.T, handler http.Handler, remoteAddr string, headers map[string]string) int {
	t.Helper()
	body := `{"username":"admin","password":"wrong"}`
	req := httptest.NewRequestWithContext(context.Background(), http.MethodPost, "/api/auth/admin/login", strings.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	if remoteAddr != "" {
		req.RemoteAddr = remoteAddr
	}
	for k, v := range headers {
		req.Header.Set(k, v)
	}
	rec := httptest.NewRecorder()
	handler.ServeHTTP(rec, req)
	return rec.Code
}

func TestRateLimiterIP_IgnoresForwardedHeadersByDefault(t *testing.T) {
	srv := server.New(newRateLimitedConfig(t, false), nil)

	// Without TrustProxyHeaders, a spoofed Fly-Client-IP must not buy a fresh
	// rate-limit bucket: both requests come from the same socket address, so
	// the second is throttled despite the differing headers.
	first := postLogin(t, srv.Handler, "", map[string]string{"Fly-Client-IP": "203.0.113.1"})
	require.Equal(t, http.StatusUnauthorized, first)

	second := postLogin(t, srv.Handler, "", map[string]string{"Fly-Client-IP": "203.0.113.2"})
	require.Equal(t, http.StatusTooManyRequests, second)
}

func TestRateLimiterIP_IgnoresXForwardedForByDefault(t *testing.T) {
	srv := server.New(newRateLimitedConfig(t, false), nil)

	first := postLogin(t, srv.Handler, "", map[string]string{"X-Forwarded-For": "203.0.113.1"})
	require.Equal(t, http.StatusUnauthorized, first)

	second := postLogin(t, srv.Handler, "", map[string]string{"X-Forwarded-For": "203.0.113.2"})
	require.Equal(t, http.StatusTooManyRequests, second)
}

func TestRateLimiterIP_KeysOnFlyClientIPWhenTrusted(t *testing.T) {
	srv := server.New(newRateLimitedConfig(t, true), nil)

	// Two clients behind Fly's proxy share a socket address (the proxy's) but
	// carry their own Fly-Client-IP, so they get separate buckets.
	first := postLogin(t, srv.Handler, "", map[string]string{"Fly-Client-IP": "203.0.113.1"})
	require.Equal(t, http.StatusUnauthorized, first)

	otherClient := postLogin(t, srv.Handler, "", map[string]string{"Fly-Client-IP": "203.0.113.2"})
	require.Equal(t, http.StatusUnauthorized, otherClient)

	// The first client's second attempt drains its own bucket.
	sameClient := postLogin(t, srv.Handler, "", map[string]string{"Fly-Client-IP": "203.0.113.1"})
	require.Equal(t, http.StatusTooManyRequests, sameClient)
}

func TestRateLimiterIP_FallsBackToXFFWhenTrusted(t *testing.T) {
	srv := server.New(newRateLimitedConfig(t, true), nil)

	// No Fly-Client-IP, but the connection comes from a private (trusted proxy)
	// address with an X-Forwarded-For: the forwarded client IP keys the bucket.
	proxyAddr := "172.16.0.5:4242"
	first := postLogin(t, srv.Handler, proxyAddr, map[string]string{"X-Forwarded-For": "203.0.113.1"})
	require.Equal(t, http.StatusUnauthorized, first)

	otherClient := postLogin(t, srv.Handler, proxyAddr, map[string]string{"X-Forwarded-For": "203.0.113.2"})
	require.Equal(t, http.StatusUnauthorized, otherClient)

	sameClient := postLogin(t, srv.Handler, proxyAddr, map[string]string{"X-Forwarded-For": "203.0.113.1"})
	require.Equal(t, http.StatusTooManyRequests, sameClient)
}

func TestRateLimiterIP_FlyClientIPWinsOverXFF(t *testing.T) {
	srv := server.New(newRateLimitedConfig(t, true), nil)

	// When both headers arrive, Fly-Client-IP is authoritative: rotating
	// X-Forwarded-For values must not mint fresh buckets for the same client.
	first := postLogin(t, srv.Handler, "", map[string]string{
		"Fly-Client-IP":   "203.0.113.1",
		"X-Forwarded-For": "198.51.100.1",
	})
	require.Equal(t, http.StatusUnauthorized, first)

	second := postLogin(t, srv.Handler, "", map[string]string{
		"Fly-Client-IP":   "203.0.113.1",
		"X-Forwarded-For": "198.51.100.2",
	})
	require.Equal(t, http.StatusTooManyRequests, second)
}

func TestRateLimiterIP_UnparseableFlyClientIPFallsThrough(t *testing.T) {
	srv := server.New(newRateLimitedConfig(t, true), nil)

	// A garbage Fly-Client-IP never becomes a bucket key: both requests fall
	// through to the socket address and share one budget.
	first := postLogin(t, srv.Handler, "", map[string]string{"Fly-Client-IP": "not-an-ip"})
	require.Equal(t, http.StatusUnauthorized, first)

	second := postLogin(t, srv.Handler, "", map[string]string{"Fly-Client-IP": "also-not-an-ip"})
	require.Equal(t, http.StatusTooManyRequests, second)
}
