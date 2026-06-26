package server

import (
	"html"
	"net/http"
	"os"
	"path/filepath"
	"regexp"
	"strings"
	"time"

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
//
// canonicalHost is used to build the absolute og:url injected into the shell
// per route (see serveShell); it may be empty outside production.
func staticMiddleware(root, canonicalHost string) echo.MiddlewareFunc {
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
			return serveShell(c, root, rel, canonicalHost)
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

// serveShell renders the SPA shell (index.html) with per-route title and
// link-preview metadata injected. A missing or unreadable shell falls back to
// the plain file path so a misconfigured STATIC_DIR still surfaces as a 404
// (with no stale Cache-Control), matching the rest of the static handler.
func serveShell(c echo.Context, root, urlPath, canonicalHost string) error {
	indexPath := filepath.Join(root, "index.html")
	content, err := os.ReadFile(indexPath)
	if err != nil {
		return serveFile(c, indexPath, cacheControlNoCache)
	}
	doc := injectMeta(string(content), urlPath, canonicalHost, c.Request())
	c.Response().Header().Set("Cache-Control", cacheControlNoCache)
	// ServeContent (the primitive echo's c.File uses) sets the text/html type
	// and handles HEAD with an empty body. A zero modtime skips Last-Modified,
	// leaving the no-cache policy in charge.
	http.ServeContent(c.Response(), c.Request(), "index.html", time.Time{}, strings.NewReader(doc))
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

// The browser-tab and link-preview metadata injected into the SPA shell per
// route. Crawlers (iMessage, Slack, Facebook) and search engines do not run the
// client JS that usePageTitle relies on, so the shell that leaves the server is
// the only place a shared link gets a route-specific title and description.
// publicPageMeta below is the server-side mirror of those usePageTitle(...)
// calls; keep the two in sync (see app/CLAUDE.md).
const (
	appName  = "Robin & Madeline"
	titleSep = " · "
)

// shellMeta is one public route's head override. An empty label means just the
// app name (the home page).
type shellMeta struct {
	label       string
	description string
}

func (m shellMeta) title() string {
	if m.label == "" {
		return appName
	}
	return m.label + titleSep + appName
}

// publicPageMeta maps a client route to the title and description a link
// preview and search result should show. The labels mirror the usePageTitle(...)
// calls in app/components/pages. Only public, shareable routes belong here;
// private routes are handled by isPrivatePath/noindex.
var publicPageMeta = map[string]shellMeta{
	"/":         {description: "Robin and Madeline are getting married on April 10, 2027 at Arrowwood in Palmer, TX."},
	"/story":    {label: "Our Story", description: "How Robin and Madeline met, and the road to April 10, 2027."},
	"/schedule": {label: "Schedule", description: "Times and places for Robin and Madeline's wedding weekend at Arrowwood in Palmer, TX."},
	"/travel":   {label: "Travel", description: "Travel, lodging, and directions for Robin and Madeline's wedding at Arrowwood in Palmer, TX."},
	"/photos":   {label: "Photos", description: "Photos of Robin and Madeline."},
	"/faq":      {label: "FAQ", description: "Answers to common questions about Robin and Madeline's wedding."},
	"/games":    {label: "Games", description: "Play along with Robin and Madeline's wedding crosswords and games."},
	"/rsvp":     {label: "RSVP", description: "RSVP to Robin and Madeline's wedding on April 10, 2027."},
}

// Each regex captures a head tag's value between two groups so only the value is
// swapped. \s+ spans the whitespace (including any newlines prettier wraps a
// long <meta> across), so a pattern matches whether its tag sits on one line or
// several. They assume the identifying attribute (property/name) precedes
// content, which is how index.html is authored.
var (
	titleRe   = regexp.MustCompile(`<title>[^<]*</title>`)
	descRe    = regexp.MustCompile(`(<meta\s+name="description"\s+content=")[^"]*(")`)
	ogTitleRe = regexp.MustCompile(`(<meta\s+property="og:title"\s+content=")[^"]*(")`)
	ogDescRe  = regexp.MustCompile(`(<meta\s+property="og:description"\s+content=")[^"]*(")`)
	ogURLRe   = regexp.MustCompile(`(<meta\s+property="og:url"\s+content=")[^"]*(")`)
	twTitleRe = regexp.MustCompile(`(<meta\s+name="twitter:title"\s+content=")[^"]*(")`)
	twDescRe  = regexp.MustCompile(`(<meta\s+name="twitter:description"\s+content=")[^"]*(")`)
)

// injectMeta overrides the shell's head for known routes: public routes get
// their title, description, and canonical URL; private routes (admin and the
// per-guest token links) get noindex so guest-specific URLs never surface in a
// preview or search index. Unknown routes pass through untouched. Every
// replacement is a no-op when its target tag is absent, so a shell without the
// tags is returned unchanged.
func injectMeta(doc, urlPath, canonicalHost string, req *http.Request) string {
	meta, ok := publicPageMeta[urlPath]
	if !ok {
		if isPrivatePath(urlPath) {
			return addNoindex(doc)
		}
		return doc
	}

	title := meta.title()
	doc = setTitle(doc, title)
	doc = setMetaContent(doc, descRe, meta.description)
	doc = setMetaContent(doc, ogTitleRe, title)
	doc = setMetaContent(doc, ogDescRe, meta.description)
	doc = setMetaContent(doc, ogURLRe, absoluteURL(canonicalHost, req, urlPath))
	doc = setMetaContent(doc, twTitleRe, title)
	doc = setMetaContent(doc, twDescRe, meta.description)
	return doc
}

// setTitle replaces the <title> element's text, HTML-escaping the value.
func setTitle(doc, title string) string {
	return titleRe.ReplaceAllStringFunc(doc, func(string) string {
		return "<title>" + html.EscapeString(title) + "</title>"
	})
}

// setMetaContent replaces the content="" value of the tag matched by re,
// preserving the tag itself and HTML-escaping the new value.
// ReplaceAllStringFunc (rather than ReplaceAllString) keeps a $ in the value
// from being read as a capture-group reference.
func setMetaContent(doc string, re *regexp.Regexp, value string) string {
	esc := html.EscapeString(value)
	return re.ReplaceAllStringFunc(doc, func(match string) string {
		g := re.FindStringSubmatch(match)
		return g[1] + esc + g[2]
	})
}

// addNoindex inserts a robots noindex meta before </head>. It is a no-op when
// the shell has no </head>.
func addNoindex(doc string) string {
	const tag = "<meta name=\"robots\" content=\"noindex\" />\n    "
	if i := strings.Index(doc, "</head>"); i >= 0 {
		return doc[:i] + tag + doc[i:]
	}
	return doc
}

// isPrivatePath reports whether a route must not be indexed or previewed: the
// admin back office and the per-guest token links (/i/:token, /u/:guestId).
func isPrivatePath(p string) bool {
	return p == "/admin" || strings.HasPrefix(p, "/admin/") ||
		strings.HasPrefix(p, "/i/") || strings.HasPrefix(p, "/u/")
}

// absoluteURL builds the canonical absolute URL for a route's og:url. It
// prefers the configured canonical host (production), falling back to the
// request's scheme and host so a non-canonical deployment still emits an
// absolute URL.
func absoluteURL(canonicalHost string, req *http.Request, urlPath string) string {
	if canonicalHost != "" {
		return "https://" + canonicalHost + urlPath
	}
	scheme := "https"
	if proto := req.Header.Get("X-Forwarded-Proto"); proto != "" {
		scheme = proto
	} else if req.TLS == nil {
		scheme = "http"
	}
	return scheme + "://" + req.Host + urlPath
}
