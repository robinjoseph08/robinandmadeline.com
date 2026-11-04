package server_test

import (
	"context"
	"io"
	"net/http"
	"net/http/httptest"
	"net/url"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"testing"

	"github.com/robinjoseph08/robinandmadeline.com/pkg/config"
	"github.com/robinjoseph08/robinandmadeline.com/pkg/server"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

const analyticsShell = `<html><head><title>Robin &amp; Madeline</title></head><body></body></html>`

// upstreamOnlyHeaders would apply to the site's whole origin if forwarded.
var upstreamOnlyHeaders = []string{"Nel", "Report-To", "Alt-Svc", "Strict-Transport-Security", "Set-Cookie", "Location", "Access-Control-Allow-Origin"}

// umamiRequest is what a fake Umami saw.
type umamiRequest struct {
	method       string
	path         string
	host         string
	userAgent    string
	forwardedFor string
	contentType  string
	cookie       string
	auth         string
	body         string
}

// fakeUmami records every request and answers like Umami does.
func fakeUmami(t *testing.T) (*httptest.Server, func() []umamiRequest) {
	t.Helper()
	var mu sync.Mutex
	var seen []umamiRequest
	upstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		body, _ := io.ReadAll(r.Body)
		mu.Lock()
		seen = append(seen, umamiRequest{
			method:       r.Method,
			path:         r.URL.Path,
			host:         r.Host,
			userAgent:    r.Header.Get("User-Agent"),
			forwardedFor: r.Header.Get("X-Forwarded-For"),
			contentType:  r.Header.Get("Content-Type"),
			cookie:       r.Header.Get("Cookie"),
			auth:         r.Header.Get("Authorization"),
			body:         string(body),
		})
		mu.Unlock()
		switch r.URL.Path {
		case "/script.js":
			if r.Header.Get("If-None-Match") == `"v1"` {
				w.WriteHeader(http.StatusNotModified)
				return
			}
			w.Header().Set("ETag", `"v1"`)
			for _, name := range upstreamOnlyHeaders {
				w.Header().Set(name, "from-umami")
			}
			w.Header().Set("Content-Type", "application/javascript")
			w.Header().Set("Cache-Control", "public, max-age=86400")
			_, _ = io.WriteString(w, "/* tracker */")
		case "/api/send":
			w.Header().Set("Content-Type", "application/json")
			_, _ = io.WriteString(w, `{"cache":"abc","sessionId":"s1","visitId":"v1"}`)
		default:
			http.NotFound(w, r)
		}
	}))
	t.Cleanup(upstream.Close)
	return upstream, func() []umamiRequest {
		mu.Lock()
		defer mu.Unlock()
		return append([]umamiRequest(nil), seen...)
	}
}

// analyticsConfig serves analyticsShell the way production does, with Umami at
// rawURL.
func analyticsConfig(t *testing.T, rawURL string) *config.Config {
	t.Helper()
	dir := t.TempDir()
	require.NoError(t, os.WriteFile(filepath.Join(dir, "index.html"), []byte(analyticsShell), 0o600))
	target, err := url.Parse(rawURL)
	require.NoError(t, err)
	cfg := newTestConfig(t)
	cfg.StaticDir = dir
	cfg.UmamiURL = target
	cfg.UmamiWebsiteID = "site-1"
	return cfg
}

func analyticsHandler(t *testing.T, rawURL string) http.Handler {
	t.Helper()
	return server.New(analyticsConfig(t, rawURL), nil).Handler
}

func sendEvent(handler http.Handler, body string) *httptest.ResponseRecorder {
	req := httptest.NewRequestWithContext(context.Background(), http.MethodPost, "/stats/api/send", strings.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	rec := httptest.NewRecorder()
	handler.ServeHTTP(rec, req)
	return rec
}

func TestAnalytics_ForwardsTheScript(t *testing.T) {
	upstream, seen := fakeUmami(t)
	handler := analyticsHandler(t, upstream.URL)

	req := httptest.NewRequestWithContext(context.Background(), http.MethodGet, "/stats/script.js", http.NoBody)
	req.Header.Set("User-Agent", "Mozilla/5.0 (test)")
	rec := httptest.NewRecorder()
	handler.ServeHTTP(rec, req)

	assert.Equal(t, http.StatusOK, rec.Code)
	assert.Equal(t, "/* tracker */", rec.Body.String())
	assert.Equal(t, "public, max-age=3600", rec.Header().Get("Cache-Control"), "kept for an hour, whatever Umami says")
	assert.Equal(t, `"v1"`, rec.Header().Get("ETag"))
	assert.Equal(t, "application/javascript", rec.Header().Get("Content-Type"))
	for _, name := range upstreamOnlyHeaders {
		assert.Empty(t, rec.Header().Get(name), name)
	}
	require.Len(t, seen(), 1)
	got := seen()[0]
	assert.Equal(t, "/script.js", got.path, "the /stats prefix is stripped")
	assert.Equal(t, strings.TrimPrefix(upstream.URL, "http://"), got.host, "Umami sees its own host name, not the site's")
	assert.Equal(t, "Mozilla/5.0 (test)", got.userAgent)
}

func TestAnalytics_ScriptRevalidationKeepsItsCaching(t *testing.T) {
	upstream, _ := fakeUmami(t)
	handler := analyticsHandler(t, upstream.URL)

	req := httptest.NewRequestWithContext(context.Background(), http.MethodGet, "/stats/script.js", http.NoBody)
	req.Header.Set("If-None-Match", `"v1"`)
	rec := httptest.NewRecorder()
	handler.ServeHTTP(rec, req)

	assert.Equal(t, http.StatusNotModified, rec.Code)
	assert.Equal(t, "public, max-age=3600", rec.Header().Get("Cache-Control"))
}

func TestAnalytics_ForwardsEvents(t *testing.T) {
	upstream, seen := fakeUmami(t)
	cfg := analyticsConfig(t, upstream.URL)
	cfg.TrustProxyHeaders = true
	handler := server.New(cfg, nil).Handler
	payload := `{"type":"event","payload":{"website":"site-1","title":"FAQ · Robin & Madeline","url":"https://www.robinandmadeline.com/faq?utm_source=email","referrer":"https://www.google.com/","data":{"score":1.50}}}`

	req := httptest.NewRequestWithContext(context.Background(), http.MethodPost, "/stats/api/send", strings.NewReader(payload))
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Fly-Client-IP", "198.51.100.4")
	req.Header.Set("User-Agent", "Mozilla/5.0 (test)")
	req.Header.Set("Cookie", "session=secret")
	req.Header.Set("Authorization", "Bearer secret")
	rec := httptest.NewRecorder()
	handler.ServeHTTP(rec, req)

	assert.Equal(t, http.StatusOK, rec.Code)
	assert.JSONEq(t, `{"cache":"abc","sessionId":"s1","visitId":"v1"}`, rec.Body.String(), "Umami's answer goes back unchanged")
	assert.Equal(t, []string{"no-store"}, rec.Header().Values("Cache-Control"))
	require.Len(t, seen(), 1)
	got := seen()[0]
	assert.Equal(t, http.MethodPost, got.method)
	assert.Equal(t, "/api/send", got.path)
	assert.Equal(t, strings.TrimPrefix(upstream.URL, "http://"), got.host)
	assert.Equal(t, "Mozilla/5.0 (test)", got.userAgent)
	assert.Equal(t, "application/json", got.contentType)
	assert.JSONEq(t, `{"type":"event","payload":{"website":"site-1","title":"FAQ · Robin & Madeline","url":"https://www.robinandmadeline.com/faq?utm_source=email","referrer":"https://www.google.com/","data":{"score":1.50},"ip":"198.51.100.4"}}`, got.body, "the event arrives as the tracker wrote it, plus the visitor's address")
	assert.Contains(t, got.body, "1.50", "numbers aren't reformatted")
	assert.Empty(t, got.forwardedFor, "the event's ip is the only claim about who the visitor is")
	assert.Empty(t, got.cookie, "the site's cookies stay here")
	assert.Empty(t, got.auth, "the site's credentials stay here")
}

func TestAnalytics_VisitorCannotChooseTheirAddress(t *testing.T) {
	upstream, seen := fakeUmami(t)
	cfg := analyticsConfig(t, upstream.URL)
	cfg.TrustProxyHeaders = true
	handler := server.New(cfg, nil).Handler

	req := httptest.NewRequestWithContext(context.Background(), http.MethodPost, "/stats/api/send", strings.NewReader(`{"payload":{"url":"/faq","ip":"192.0.2.99"}}`))
	req.Header.Set("Fly-Client-IP", "198.51.100.4")
	handler.ServeHTTP(httptest.NewRecorder(), req)

	require.Len(t, seen(), 1)
	assert.Contains(t, seen()[0].body, `"ip":"198.51.100.4"`)
	assert.NotContains(t, seen()[0].body, "192.0.2.99")
}

func TestAnalytics_DropsAnAdminReferrer(t *testing.T) {
	upstream, seen := fakeUmami(t)
	handler := analyticsHandler(t, upstream.URL)

	rec := sendEvent(handler, `{"payload":{"url":"/","referrer":"/admin/parties/019f9533","title":"Home"}}`)

	assert.Equal(t, http.StatusOK, rec.Code)
	require.Len(t, seen(), 1, "the public page is still recorded")
	assert.NotContains(t, seen()[0].body, "admin")
	assert.Contains(t, seen()[0].body, "Home")
}

func TestAnalytics_KeepsAPageviewWithAMalformedReferrer(t *testing.T) {
	upstream, seen := fakeUmami(t)
	handler := analyticsHandler(t, upstream.URL)

	rec := sendEvent(handler, `{"payload":{"url":"/faq","referrer":"https://example.com/100%/off"}}`)

	assert.Equal(t, http.StatusOK, rec.Code)
	require.Len(t, seen(), 1)
	assert.Contains(t, seen()[0].body, `"url":"/faq"`)
	assert.NotContains(t, seen()[0].body, "example.com")
}

func TestAnalytics_ScriptHeadReportsItsRealLength(t *testing.T) {
	upstream, _ := fakeUmami(t)
	site := httptest.NewServer(analyticsHandler(t, upstream.URL))
	t.Cleanup(site.Close)

	res, err := http.Head(site.URL + "/stats/script.js") //nolint:noctx // a one-shot test request
	require.NoError(t, err)
	defer res.Body.Close()

	assert.Equal(t, http.StatusOK, res.StatusCode)
	assert.Equal(t, int64(len("/* tracker */")), res.ContentLength)
}

func TestAnalytics_BrokenTrackerDownloadIsABadGateway(t *testing.T) {
	upstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.Header().Set("Content-Length", "1000")
		w.WriteHeader(http.StatusOK)
		_, _ = io.WriteString(w, "/* partial tracker")
		w.(http.Flusher).Flush() //nolint:forcetypeassert // httptest's writer flushes
		panic(http.ErrAbortHandler)
	}))
	t.Cleanup(upstream.Close)
	site := httptest.NewServer(analyticsHandler(t, upstream.URL))
	t.Cleanup(site.Close)

	res, err := http.Get(site.URL + "/stats/script.js") //nolint:noctx // a one-shot test request
	require.NoError(t, err)
	defer res.Body.Close()
	body, err := io.ReadAll(res.Body)

	require.NoError(t, err)
	assert.Equal(t, http.StatusBadGateway, res.StatusCode)
	assert.Equal(t, "no-store", res.Header.Get("Cache-Control"), "a browser can't keep this")
	assert.Empty(t, body)
}

func TestAnalytics_SendsGuestLinksAsTheyAre(t *testing.T) {
	upstream, seen := fakeUmami(t)
	handler := analyticsHandler(t, upstream.URL)

	for _, want := range []string{
		`"url":"https://www.robinandmadeline.com/i/sometoken"`,
		`"referrer":"/i/sometoken"`,
		`"title":"Amanda's Info"`,
		`"id":"Amanda Example"`,
	} {
		rec := sendEvent(handler, `{"type":"event","payload":{"url":"https://www.robinandmadeline.com/i/sometoken","referrer":"/i/sometoken","title":"Amanda's Info","id":"Amanda Example"}}`)
		assert.Equal(t, http.StatusOK, rec.Code)
		requests := seen()
		require.NotEmpty(t, requests)
		assert.Contains(t, requests[len(requests)-1].body, want)
	}
}

func TestAnalytics_DoesNotSendTheBackOffice(t *testing.T) {
	upstream, seen := fakeUmami(t)
	handler := analyticsHandler(t, upstream.URL)

	for _, page := range []string{
		"https://www.robinandmadeline.com/admin",
		"https://www.robinandmadeline.com/admin/parties/019f9533",
		"https://www.robinandmadeline.com/Admin/login",
		"/admin/guests",
	} {
		rec := sendEvent(handler, `{"type":"event","payload":{"website":"site-1","url":"`+page+`","title":"Secret Party · Admin"}}`)

		assert.Equal(t, http.StatusOK, rec.Code, page)
		assert.JSONEq(t, `{}`, rec.Body.String(), "the tracker parses every response as JSON")
	}
	assert.Empty(t, seen())
}

func TestAnalytics_KeepsPagesThatOnlyLookPrivate(t *testing.T) {
	upstream, seen := fakeUmami(t)
	handler := analyticsHandler(t, upstream.URL)

	rec := sendEvent(handler, `{"type":"event","payload":{"url":"https://www.robinandmadeline.com/administer"}}`)

	assert.Equal(t, http.StatusOK, rec.Code)
	require.Len(t, seen(), 1)
	assert.Contains(t, seen()[0].body, "/administer")
}

func TestAnalytics_RejectsEventsItCannotRead(t *testing.T) {
	upstream, seen := fakeUmami(t)
	handler := analyticsHandler(t, upstream.URL)

	for _, body := range []string{
		``,
		`not json`,
		`{"type":"event","payload":"/admin"}`,
		`{"type":"event","payload":{"url":["/admin"]}}`,
		`{"type":"event","payload":{"url":"/admin/%zz"}}`,
		`{"type":"event"}`,
		`{"type":"event","payload":null}`,
	} {
		rec := sendEvent(handler, body)
		assert.Equal(t, http.StatusBadRequest, rec.Code, body)
	}
	assert.Empty(t, seen(), "an event that can't be read never reaches Umami")
}

func TestAnalytics_RejectsLargeEvents(t *testing.T) {
	upstream, seen := fakeUmami(t)
	handler := analyticsHandler(t, upstream.URL)

	rec := sendEvent(handler, `{"payload":{"url":"`+strings.Repeat("x", 64<<10)+`"}}`)

	assert.Equal(t, http.StatusRequestEntityTooLarge, rec.Code)
	assert.Empty(t, seen(), "the oversized body never reaches Umami")
}

func TestAnalytics_OnlyForwardsTheTwoRoutes(t *testing.T) {
	upstream, seen := fakeUmami(t)
	handler := analyticsHandler(t, upstream.URL)

	for _, request := range []struct{ method, target string }{
		{http.MethodGet, "/stats"},
		{http.MethodGet, "/stats/"},
		{http.MethodGet, "/stats/api/websites"},
		{http.MethodPost, "/stats/api/websites"},
		{http.MethodGet, "/stats/api/send"},
		{http.MethodPost, "/stats/script.js"},
		{http.MethodGet, "/stats/login"},
		{http.MethodGet, "/stats/../api/health"},
		{http.MethodGet, "/STATS/script.js"},
	} {
		req := httptest.NewRequestWithContext(context.Background(), request.method, request.target, http.NoBody)
		rec := httptest.NewRecorder()
		handler.ServeHTTP(rec, req)
		assert.Contains(t, []int{http.StatusNotFound, http.StatusMethodNotAllowed}, rec.Code, request.method+" "+request.target)
		assert.NotContains(t, rec.Body.String(), "<html>", request.method+" "+request.target)
	}
	assert.Empty(t, seen(), "nothing else reaches Umami")
}

func TestAnalytics_UnreachableUmamiIsABadGateway(t *testing.T) {
	upstream := httptest.NewServer(http.NotFoundHandler())
	upstream.Close()
	handler := analyticsHandler(t, upstream.URL)

	rec := get(handler, "/stats/script.js")

	assert.Equal(t, http.StatusBadGateway, rec.Code)
	assert.Equal(t, "no-store", rec.Header().Get("Cache-Control"))
}

func TestAnalytics_ShellGetsTheTracker(t *testing.T) {
	upstream, _ := fakeUmami(t)
	handler := analyticsHandler(t, upstream.URL)

	for _, page := range []string{"/", "/faq", "/i/sometoken", "/admin"} {
		rec := get(handler, page)
		assert.Equal(t, http.StatusOK, rec.Code, page)
		assert.Contains(t, rec.Body.String(), `<script async src="/stats/script.js" data-website-id="site-1" data-before-send="umamiBeforeSend"></script></head>`, page)
		assert.NotContains(t, rec.Body.String(), upstream.URL, "Umami's address stays out of the page")
	}
}

func TestAnalytics_WebsiteIDCannotAddATag(t *testing.T) {
	upstream, _ := fakeUmami(t)
	cfg := analyticsConfig(t, upstream.URL)
	cfg.UmamiWebsiteID = `id"><script>alert(1)</script>`

	rec := get(server.New(cfg, nil).Handler, "/")

	assert.Equal(t, 1, strings.Count(rec.Body.String(), "<script"))
}

func TestAnalytics_OffWithoutBothSettings(t *testing.T) {
	upstream, seen := fakeUmami(t)

	for name, change := range map[string]func(*config.Config){
		"neither":    func(c *config.Config) { c.UmamiURL, c.UmamiWebsiteID = nil, "" },
		"no website": func(c *config.Config) { c.UmamiWebsiteID = "" },
		"no url":     func(c *config.Config) { c.UmamiURL = nil },
	} {
		t.Run(name, func(t *testing.T) {
			cfg := analyticsConfig(t, upstream.URL)
			change(cfg)
			handler := server.New(cfg, nil).Handler

			assert.Equal(t, http.StatusNotFound, get(handler, "/stats/script.js").Code)
			assert.NotEqual(t, http.StatusOK, sendEvent(handler, `{"payload":{"url":"/faq"}}`).Code)
			shell := get(handler, "/")
			assert.Equal(t, http.StatusOK, shell.Code)
			assert.NotContains(t, shell.Body.String(), "<script")
		})
	}
	assert.Empty(t, seen())
}
