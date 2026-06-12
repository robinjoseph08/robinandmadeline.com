package server_test

import (
	"context"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/robinjoseph08/robinandmadeline.com/pkg/config"
	"github.com/robinjoseph08/robinandmadeline.com/pkg/server"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

// newCanonicalHostConfig builds a config with the production canonical host
// set, which is what arms the host-redirect middleware.
func newCanonicalHostConfig(t *testing.T) *config.Config {
	t.Helper()
	cfg := newTestConfig(t)
	cfg.CanonicalHost = "robinandmadeline.com"
	return cfg
}

func getWithHost(handler http.Handler, host, target string) *httptest.ResponseRecorder {
	req := httptest.NewRequestWithContext(context.Background(), http.MethodGet, target, http.NoBody)
	req.Host = host
	rec := httptest.NewRecorder()
	handler.ServeHTTP(rec, req)
	return rec
}

func TestHostRedirect_DisabledWithoutCanonicalHost(t *testing.T) {
	// Default config (no CanonicalHost): localhost dev and tests see no
	// redirects no matter the Host header.
	srv := server.New(newTestConfig(t), nil)

	rec := getWithHost(srv.Handler, "madelineandrobin.com", "/")
	assert.Equal(t, http.StatusNotFound, rec.Code)
}

func TestHostRedirect_AlternateDomainsRedirectToCanonical(t *testing.T) {
	srv := server.New(newCanonicalHostConfig(t), nil)

	tests := []struct {
		name         string
		host         string
		target       string
		wantLocation string
	}{
		{
			name:         "madelineandrobin.com preserves path and query",
			host:         "madelineandrobin.com",
			target:       "/schedule?guest=1",
			wantLocation: "https://robinandmadeline.com/schedule?guest=1",
		},
		{
			name:         "robeline.co passes its path through",
			host:         "robeline.co",
			target:       "/rsvp",
			wantLocation: "https://robinandmadeline.com/rsvp",
		},
		{
			name:         "www variant of the canonical domain",
			host:         "www.robinandmadeline.com",
			target:       "/",
			wantLocation: "https://robinandmadeline.com/",
		},
		{
			name:         "www variant of an alternate domain",
			host:         "www.madelineandrobin.com",
			target:       "/photos",
			wantLocation: "https://robinandmadeline.com/photos",
		},
		{
			name:         "host with port still redirects",
			host:         "robeline.co:8080",
			target:       "/",
			wantLocation: "https://robinandmadeline.com/",
		},
		{
			// Only /api/health is exempt; every other API path consolidates
			// onto the canonical host like the rest of the site.
			name:         "non-health API path redirects",
			host:         "robeline.co",
			target:       "/api/schedule",
			wantLocation: "https://robinandmadeline.com/api/schedule",
		},
		{
			// The Location must keep the request's percent-encoding: decoding
			// %3F into a literal "?" would truncate the path into a bogus
			// query, and %0d%0a would put raw CRLF into the header.
			name:         "encoded path segments stay encoded",
			host:         "madelineandrobin.com",
			target:       "/a%20b/sched%3Fule?x=1",
			wantLocation: "https://robinandmadeline.com/a%20b/sched%3Fule?x=1",
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			rec := getWithHost(srv.Handler, tt.host, tt.target)
			require.Equal(t, http.StatusMovedPermanently, rec.Code)
			assert.Equal(t, tt.wantLocation, rec.Header().Get("Location"))
		})
	}
}

func TestHostRedirect_CanonicalHostIsNotRedirected(t *testing.T) {
	srv := server.New(newCanonicalHostConfig(t), nil)

	tests := []struct {
		name string
		host string
	}{
		{name: "exact match", host: "robinandmadeline.com"},
		{name: "case-insensitive match", host: "RobinAndMadeline.com"},
		{name: "match with port", host: "robinandmadeline.com:443"},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			// No StaticDir in this config, so a served (non-redirected) root is a
			// plain 404 rather than a 301.
			rec := getWithHost(srv.Handler, tt.host, "/")
			assert.Equal(t, http.StatusNotFound, rec.Code)
		})
	}
}

func TestHostRedirect_HealthCheckIsExempt(t *testing.T) {
	srv := server.New(newCanonicalHostConfig(t), nil)

	// Fly's health checks hit the machine with a non-canonical Host; the
	// liveness endpoint must answer 200, not bounce them through a redirect.
	rec := getWithHost(srv.Handler, "some-machine.internal:8080", "/api/health")
	assert.Equal(t, http.StatusOK, rec.Code)
}

func TestHostRedirect_NonGETMethodsUse308(t *testing.T) {
	srv := server.New(newCanonicalHostConfig(t), nil)

	// A 301 would let the client degrade a redirected POST to a GET, silently
	// dropping the write; 308 requires the method and body to be kept.
	req := httptest.NewRequestWithContext(context.Background(), http.MethodPost, "/api/auth/admin/login", strings.NewReader(`{}`))
	req.Host = "robeline.co"
	req.Header.Set("Content-Type", "application/json")
	rec := httptest.NewRecorder()
	srv.Handler.ServeHTTP(rec, req)

	require.Equal(t, http.StatusPermanentRedirect, rec.Code)
	assert.Equal(t, "https://robinandmadeline.com/api/auth/admin/login", rec.Header().Get("Location"))
}

func TestHostRedirect_WinsOverStaticServing(t *testing.T) {
	// Production runs with both CANONICAL_HOST and STATIC_DIR set; the
	// redirect must run before static serving or alternate domains would
	// serve the site directly instead of consolidating onto the canonical
	// host.
	cfg := newCanonicalHostConfig(t)
	cfg.StaticDir = newStaticDir(t)
	srv := server.New(cfg, nil)

	redirected := getWithHost(srv.Handler, "www.robinandmadeline.com", "/")
	require.Equal(t, http.StatusMovedPermanently, redirected.Code)
	assert.Equal(t, "https://robinandmadeline.com/", redirected.Header().Get("Location"))

	// The canonical host itself is served, not redirected.
	served := getWithHost(srv.Handler, "robinandmadeline.com", "/")
	require.Equal(t, http.StatusOK, served.Code)
	assert.Equal(t, "<html>spa shell</html>", served.Body.String())
}
