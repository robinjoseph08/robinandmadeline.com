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
// The tables below (publicPageMeta, puzzlePageTitles, and the noindex title
// tables) are the server-side mirror of those usePageTitle(...) calls; keep them
// in sync (see app/CLAUDE.md).
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
// calls in app/components/pages. Only public, shareable landing pages belong
// here; puzzle pages are titled via puzzlePageTitles and noindex routes via
// isNoindexPath/noindexTitle.
var publicPageMeta = map[string]shellMeta{
	"/":         {description: "Robin and Madeline are getting married on April 10, 2027 at Arrowwood in Palmer, TX."},
	"/story":    {label: "Our Story", description: "How Robin and Madeline met, and the road to April 10, 2027."},
	"/schedule": {label: "Schedule", description: "Times and places for Robin and Madeline's wedding at Arrowwood in Palmer, TX."},
	"/travel":   {label: "Travel", description: "Flights, hotels, rental cars, and parking for Robin and Madeline's wedding at Arrowwood in Palmer, TX."},
	"/photos":   {label: "Photos", description: "Photos of Robin and Madeline."},
	"/faq":      {label: "FAQ", description: "Answers to common questions about Robin and Madeline's wedding."},
	"/games":    {label: "Games", description: "Games and puzzles for Robin and Madeline's wedding."},
	"/rsvp":     {label: "RSVP", description: "RSVP to Robin and Madeline's wedding on April 10, 2027."},
}

// puzzlePageTitles maps a /games/:slug puzzle slug to the title its page shows.
// Each puzzle is a distinct page, so it gets its own title. The pages are gated
// client-side by RequireGamesAccess today, so they are also served noindex (see
// injectMeta); once that gate is removed and the games are public, they should be
// indexed like the /games landing they hang off. Mirror these with the
// PUZZLES_BY_SLUG registry (app/components/library/crossword/puzzles.ts) and the
// usePageTitle(puzzle?.title) call (app/components/pages/Crossword.tsx); keep them
// in sync.
var puzzlePageTitles = map[string]string{
	"mini":      "The Wedding Mini",
	"crossword": "The Wedding Crossword",
}

// The noindex routes that still get a generic, guest-data-free title so a shared
// link previews sensibly. The per-guest token/UUID links match by path prefix
// (their tail is an opaque token); the RSVP flow steps match by exact path. The
// admin back office is intentionally absent from both: it is served noindex with
// the default title, since it is login-gated and never shared. Keep these labels
// in sync with the usePageTitle(...) calls on the matching pages (InfoCollection,
// Unsubscribe, RSVPForm, RSVPConfirmation), the same as publicPageMeta.
var (
	noindexTitlePrefixes = []struct {
		prefix string
		label  string
	}{
		{"/i/", "Your Details"},
		{"/u/", "Unsubscribe"},
	}
	noindexTitleExact = map[string]string{
		"/rsvp/form":         "RSVP",
		"/rsvp/confirmation": "RSVP Confirmed",
	}
)

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

// injectMeta overrides the shell's head per route. Indexed landing pages
// (publicPageMeta) get their title, description, and canonical URL; puzzle pages
// get their own title and canonical URL but are noindex while gated; the
// token/UUID links and RSVP flow steps are noindex with a generic title and
// canonical URL so a shared link previews correctly and its preview card links
// back to the same page, without exposing guest data (the opaque token is the
// very URL being shared); the login-gated admin routes get noindex alone. Unknown
// routes pass through untouched. Every replacement is a no-op when its target tag
// is absent, so a shell without the tags is returned unchanged.
func injectMeta(doc, urlPath, canonicalHost string, req *http.Request) string {
	// Match case-insensitively: React Router resolves routes without regard to
	// case, so /Admin or /I/<token> render the same client page as their
	// lowercase form and must get the same server treatment (a noindex, not an
	// indexable generic shell). All real routes are lowercase ASCII.
	key := strings.ToLower(urlPath)

	// Indexed landing pages: title, description, and canonical URL.
	if meta, ok := publicPageMeta[key]; ok {
		doc = setHeadTitle(doc, meta.title())
		doc = setMetaContent(doc, descRe, meta.description)
		doc = setMetaContent(doc, ogDescRe, meta.description)
		doc = setCanonicalURL(doc, canonicalHost, req, key)
		doc = setMetaContent(doc, twDescRe, meta.description)
		return doc
	}

	// Puzzle pages (/games/:slug): each is a distinct page with its own title, no
	// description. They are gated client-side by RequireGamesAccess, so they are
	// served noindex for now; when that gate is removed and the games are public,
	// drop the addNoindex here so the puzzles are indexed like the /games landing.
	if label, ok := puzzleTitle(key); ok {
		doc = addNoindex(doc)
		doc = setHeadTitle(doc, label+titleSep+appName)
		return setCanonicalURL(doc, canonicalHost, req, key)
	}

	// Noindex routes. The token/UUID links and RSVP flow steps additionally get a
	// generic, guest-data-free title and a self-referential canonical URL so a
	// shared link previews sensibly and its preview card links back to the same
	// page, not the home default; the login-gated admin back office, never shared,
	// gets noindex with the default title and og:url.
	if isNoindexPath(key) {
		doc = addNoindex(doc)
		if label, found := noindexTitle(key); found {
			doc = setHeadTitle(doc, label+titleSep+appName)
			doc = setCanonicalURL(doc, canonicalHost, req, key)
		}
		return doc
	}

	// Unknown route: served verbatim.
	return doc
}

// setHeadTitle overwrites the shell's <title> and its og:title/twitter:title
// preview tags with the same value (each HTML-escaped). It is the title half of
// a public override and the whole of a private one, which adds no description.
func setHeadTitle(doc, title string) string {
	doc = setTitle(doc, title)
	doc = setMetaContent(doc, ogTitleRe, title)
	doc = setMetaContent(doc, twTitleRe, title)
	return doc
}

// setCanonicalURL rewrites og:url to the route's own absolute URL so a shared
// link's preview card points back to the same page rather than the shell's
// home-page default (which Facebook and the like treat as the card's click
// target). It is a no-op when no host resolves (a hostless request), leaving the
// shell's default og:url in place.
func setCanonicalURL(doc, canonicalHost string, req *http.Request, urlPath string) string {
	if u := absoluteURL(canonicalHost, req, urlPath); u != "" {
		return setMetaContent(doc, ogURLRe, u)
	}
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

// isNoindexPath reports whether a route must be served noindex: the admin back
// office, the per-guest token/UUID links (/i/:token, /u/:guestId), and the RSVP
// flow steps. The admin pages and per-guest links must never be indexed; the RSVP
// steps are mid-flow pages no one should land on from search.
func isNoindexPath(p string) bool {
	if p == "/admin" || strings.HasPrefix(p, "/admin/") {
		return true
	}
	if _, ok := noindexTitleExact[p]; ok {
		return true
	}
	for _, e := range noindexTitlePrefixes {
		if strings.HasPrefix(p, e.prefix) {
			return true
		}
	}
	return false
}

// noindexTitle returns the generic title label for a noindex route and whether
// one exists. The token/UUID links and RSVP steps have one; the admin routes do
// not (they keep the default title).
func noindexTitle(p string) (string, bool) {
	if label, ok := noindexTitleExact[p]; ok {
		return label, true
	}
	for _, e := range noindexTitlePrefixes {
		if strings.HasPrefix(p, e.prefix) {
			return e.label, true
		}
	}
	return "", false
}

// puzzleTitle returns the title for a /games/:slug puzzle page and whether the
// slug is a known puzzle. Only a single path segment after /games/ matches; an
// unknown slug (or /games itself, handled as a public route) returns false so the
// route falls through unchanged.
func puzzleTitle(p string) (string, bool) {
	slug, ok := strings.CutPrefix(p, "/games/")
	if !ok || slug == "" || strings.Contains(slug, "/") {
		return "", false
	}
	label, ok := puzzlePageTitles[slug]
	return label, ok
}

// absoluteURL builds the canonical absolute https URL for a route's og:url. It
// prefers the configured canonical host (production) and falls back to the
// request host so a non-canonical deployment still emits an absolute URL. A
// public wedding site is only ever served over https, so the scheme is fixed
// rather than read from a client-supplied X-Forwarded-Proto. It returns "" when
// no host can be resolved (a hostless request), signaling the caller to leave
// the shell's default og:url in place.
func absoluteURL(canonicalHost string, req *http.Request, urlPath string) string {
	host := canonicalHost
	if host == "" {
		host = req.Host
	}
	if host == "" {
		return ""
	}
	return "https://" + host + urlPath
}
