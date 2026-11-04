package server

import (
	"bytes"
	"context"
	"encoding/json"
	"html"
	"io"
	"net/http"
	"net/http/httputil"
	"net/url"
	"strconv"
	"strings"
	"time"

	"github.com/labstack/echo/v4"
	"github.com/pkg/errors"
	"github.com/robinjoseph08/golib/logger"
	"github.com/robinjoseph08/robinandmadeline.com/pkg/config"
	"github.com/robinjoseph08/robinandmadeline.com/pkg/errcodes"
)

// The site's web analytics come from a self-hosted Umami. The tracker and the
// events it sends go through /stats on this server, so they're same-origin: no
// CORS, fewer ad blockers, and Umami's address stays out of the page.
//
// Events reach Umami with guest links and names intact (ADR 0011). Only the back
// office is held back (see prepareAnalyticsEvent).
const (
	analyticsPrefix      = "/stats"
	analyticsScriptRoute = analyticsPrefix + "/script.js"
	analyticsSendRoute   = analyticsPrefix + "/api/send"
	// Tracker events are small JSON objects. This keeps anyone from using the
	// proxy to push large uploads at Umami.
	analyticsMaxBody = 64 << 10
	// The tracker script is under 5 KB, and Umami's answers to events are smaller.
	analyticsMaxResponse = 1 << 20
	// Umami runs on a home server. If it's slow or down, give up instead of
	// holding the visitor's request open.
	analyticsUpstreamTimeout = 10 * time.Second

	analyticsCacheScript = "public, max-age=3600"
	analyticsCacheNone   = "no-store"
)

// analyticsResponseHeaders are the only Umami response headers sent on to the
// visitor. Anything else would apply to this site's whole origin: Cloudflare in
// front of Umami adds Nel and Report-To (browsers would report this site's
// network errors to Cloudflare) and Alt-Svc (browsers would try HTTP/3 here), and
// Location would reveal Umami's address.
var analyticsResponseHeaders = []string{
	"Content-Encoding",
	"Content-Length",
	"Content-Type",
	"ETag",
	"Last-Modified",
	"Vary",
}

// analyticsEnabled reports whether Umami is set up. Without it, the shell gets
// no tracker and /stats isn't served.
func analyticsEnabled(cfg *config.Config) bool {
	return cfg.UmamiURL != nil && cfg.UmamiWebsiteID != ""
}

// analyticsTag is the tracker tag added to the shell's <head>, or nothing when
// analytics are off. The tracker records a pageview on every route change and
// sends to api/send next to where it was loaded from, so its events also go
// through /stats. It's async, not defer: deferred scripts run in order, so a
// slow or unreachable Umami would hold up the app's own module bundle. The
// before-send hook (app/libraries/analytics.ts) labels events with who sent them.
func analyticsTag(cfg *config.Config) string {
	if !analyticsEnabled(cfg) {
		return ""
	}
	return `<script async src="` + analyticsScriptRoute + `" data-website-id="` + html.EscapeString(cfg.UmamiWebsiteID) + `" data-before-send="umamiBeforeSend"></script>`
}

// isAnalyticsRoute reports whether static serving should leave a path to the
// router. When analytics are off, nothing is registered there, so it's a 404.
func isAnalyticsRoute(p string) bool {
	return p == analyticsScriptRoute || p == analyticsSendRoute
}

// registerAnalytics forwards the tracker script and its event endpoint to
// Umami, and nothing else.
func registerAnalytics(e *echo.Echo, target *url.URL) {
	proxy := &httputil.ReverseProxy{
		// SetURL sends Umami's own host name, which Cloudflare in front of it
		// requires, and Rewrite drops any incoming X-Forwarded-* headers. The
		// visitor's User-Agent passes through for Umami to read the browser and
		// device. Their cookies and credentials for this site don't.
		Rewrite: func(r *httputil.ProxyRequest) {
			r.Out.URL.Path = strings.TrimPrefix(r.In.URL.Path, analyticsPrefix)
			r.Out.URL.RawPath = ""
			r.SetURL(target)
			r.Out.Header.Del("Cookie")
			r.Out.Header.Del("Authorization")
		},
		ModifyResponse: prepareAnalyticsResponse,
		// Analytics being unreachable is Umami's problem, not a server error, so
		// it's a warning rather than a 500.
		ErrorHandler: func(w http.ResponseWriter, r *http.Request, err error) {
			logger.FromContext(r.Context()).Err(err).Warn("analytics proxy error")
			w.Header().Set("Cache-Control", analyticsCacheNone)
			w.WriteHeader(http.StatusBadGateway)
		},
	}
	forward := serveProxy(proxy)

	e.GET(analyticsScriptRoute, forward)
	e.HEAD(analyticsScriptRoute, forward)
	e.POST(analyticsSendRoute, func(c echo.Context) error {
		c.Response().Header().Set("Cache-Control", analyticsCacheNone)

		req := c.Request()
		body, err := io.ReadAll(http.MaxBytesReader(c.Response(), req.Body, analyticsMaxBody))
		if err != nil {
			var tooLarge *http.MaxBytesError
			if errors.As(err, &tooLarge) {
				return errors.WithStack(errcodes.PayloadTooLarge())
			}
			return errors.WithStack(err)
		}

		event, send, err := prepareAnalyticsEvent(body, c.RealIP())
		if err != nil {
			return errors.WithStack(errcodes.MalformedPayload())
		}
		if !send {
			// This body is for Umami's tracker, which reads JSON from every
			// response and has nothing to do with an empty object.
			return errors.WithStack(c.JSONBlob(http.StatusOK, []byte("{}")))
		}

		req.Body = io.NopCloser(bytes.NewReader(event))
		req.ContentLength = int64(len(event))
		// prepareAnalyticsResponse sets it from here on.
		c.Response().Header().Del("Cache-Control")
		return forward(c)
	})
}

// prepareAnalyticsResponse holds Umami's whole answer before any of it goes to
// the visitor. Streaming would commit a 200 and an hour of caching first, so a
// connection dropped partway through would leave a browser with a broken tracker
// for that hour. A read failure here is a 502 instead.
func prepareAnalyticsResponse(res *http.Response) error {
	body, err := io.ReadAll(io.LimitReader(res.Body, analyticsMaxResponse+1))
	_ = res.Body.Close()
	if err != nil {
		return errors.WithStack(err)
	}
	if len(body) > analyticsMaxResponse {
		return errors.New("analytics response too large")
	}
	res.Body = io.NopCloser(bytes.NewReader(body))
	res.ContentLength = int64(len(body))

	headers := http.Header{}
	for _, name := range analyticsResponseHeaders {
		if values := res.Header.Values(name); len(values) > 0 {
			headers[http.CanonicalHeaderKey(name)] = values
		}
	}
	// A HEAD has no body to measure, so it keeps the length Umami reported.
	if res.Request.Method != http.MethodHead {
		headers.Set("Content-Length", strconv.Itoa(len(body)))
	}

	fresh := res.StatusCode == http.StatusOK || res.StatusCode == http.StatusNotModified
	if res.Request.Method != http.MethodPost && fresh {
		headers.Set("Cache-Control", analyticsCacheScript)
	} else {
		headers.Set("Cache-Control", analyticsCacheNone)
	}
	res.Header = headers
	return nil
}

// prepareAnalyticsEvent gets a tracker event ready for Umami and reports whether
// to send it at all. Events from the admin back office aren't site traffic, so
// they aren't sent, and an admin page isn't recorded as where a visitor came
// from either. An event it can't read is an error, so it can't slip through.
//
// It sets the event's ip to the visitor's address. Umami would otherwise look to
// request headers, where Cloudflare in front of it describes this server: the
// address and location of every visitor would be the Fly machine's.
//
// Everything else stays as the tracker wrote it.
func prepareAnalyticsEvent(body []byte, ip string) ([]byte, bool, error) {
	var event map[string]json.RawMessage
	if err := json.Unmarshal(body, &event); err != nil {
		return nil, false, errors.WithStack(err)
	}
	var payload map[string]json.RawMessage
	if err := json.Unmarshal(event["payload"], &payload); err != nil {
		return nil, false, errors.WithStack(err)
	}
	if payload == nil {
		return nil, false, errors.New("analytics event has no payload")
	}

	admin, err := isAdminURL(payload, "url")
	if err != nil {
		return nil, false, err
	}
	if admin {
		return nil, false, nil
	}
	// A referrer can be any site's URL, so one that doesn't parse only costs the
	// referrer, not the pageview.
	if admin, err = isAdminURL(payload, "referrer"); admin || err != nil {
		delete(payload, "referrer")
	}

	encodedIP, err := json.Marshal(ip)
	if err != nil {
		return nil, false, errors.WithStack(err)
	}
	payload["ip"] = encodedIP

	event["payload"], err = json.Marshal(payload)
	if err != nil {
		return nil, false, errors.WithStack(err)
	}
	prepared, err := json.Marshal(event)
	if err != nil {
		return nil, false, errors.WithStack(err)
	}
	return prepared, true, nil
}

// isAdminURL reports whether payload[field] is an admin page. It can be absolute
// or a path depending on Umami's version, and an absent field isn't one. The
// match is case-insensitive because React Router's is: /Admin renders the same
// page as /admin.
func isAdminURL(payload map[string]json.RawMessage, field string) (bool, error) {
	raw, ok := payload[field]
	if !ok {
		return false, nil
	}
	var value string
	if err := json.Unmarshal(raw, &value); err != nil {
		return false, errors.Wrap(err, field)
	}
	page, err := url.Parse(value)
	if err != nil {
		return false, errors.Wrap(err, field)
	}
	p := strings.ToLower(page.Path)
	return p == "/admin" || strings.HasPrefix(p, "/admin/"), nil
}

// serveProxy runs a reverse proxy as an Echo handler, within the time Umami gets
// to answer.
func serveProxy(proxy *httputil.ReverseProxy) echo.HandlerFunc {
	return func(c echo.Context) error {
		// ReverseProxy panics with http.ErrAbortHandler when copying a response
		// fails partway through. Umami's answer is already in memory by then
		// (prepareAnalyticsResponse), so that means the visitor left, which is
		// routine and shouldn't reach the recovery middleware as a 500.
		defer func() {
			if recovered := recover(); recovered != nil {
				abort, ok := recovered.(error)
				if !ok || !errors.Is(abort, http.ErrAbortHandler) {
					panic(recovered)
				}
			}
		}()
		ctx, cancel := context.WithTimeout(c.Request().Context(), analyticsUpstreamTimeout)
		defer cancel()
		proxy.ServeHTTP(c.Response(), c.Request().WithContext(ctx))
		return nil
	}
}
