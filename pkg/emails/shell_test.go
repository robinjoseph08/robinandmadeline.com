package emails

import (
	"os"
	"path/filepath"
	"regexp"
	"strings"
	"testing"

	"github.com/robinjoseph08/golib/pointerutil"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestRenderEmail_WrapsResolvedMarkdownInShell(t *testing.T) {
	mctx := mergeFixture()
	html := RenderEmail(
		"Hi {{guest_name}}",
		"Hello **{{guest_name}}**, code {{rsvp_code}}.\n\nSee [our site]({{rsvp_link}}).",
		mctx,
	)

	// It is a full HTML document wrapped in the shell.
	assert.True(t, strings.HasPrefix(strings.TrimSpace(html), "<!doctype html>"))
	assert.Contains(t, html, `src="https://robinandmadeline.com/email/monogram.png"`) // the monogram header

	// Merge fields resolved before Markdown rendering: the body shows the
	// values, never the placeholders.
	assert.Contains(t, html, "Alice Smith")
	assert.Contains(t, html, "KALEL")
	assert.NotContains(t, html, "{{guest_name}}")
	assert.NotContains(t, html, "{{rsvp_code}}")

	// Markdown rendered to HTML: bold became <strong>, the link became an <a>.
	assert.Contains(t, html, ">Alice Smith</strong>")
	assert.Contains(t, html, `href="https://robinandmadeline.com/rsvp"`)

	// The resolved subject reaches the <title>.
	assert.Contains(t, html, "<title>Hi Alice Smith</title>")
}

func TestRenderEmail_SingleNewlineBecomesLineBreak(t *testing.T) {
	mctx := mergeFixture()
	// Hard wraps: two lines typed next to each other (one newline between them)
	// render as a line break, not collapsed onto one line, so a "Thanks,\nRobin"
	// sign-off keeps its two lines without needing a blank line between them.
	html := RenderEmail("s", "Thanks,\nRobin", mctx)
	assert.Contains(t, html, "Thanks,<br>")
	assert.Contains(t, html, "Robin")
}

func TestRenderEmail_LeadsWithAHiddenPreheaderNotTheMonogram(t *testing.T) {
	mctx := mergeFixture()
	html := RenderEmail("s", "Save the date for our wedding!", mctx)

	// The body's opening rides at the top of the document as a hidden preheader,
	// so a client that builds the inbox/notification snippet from the HTML previews
	// the message rather than the monogram ("R & M").
	assert.Contains(t, html, "display: none")
	preheaderIdx := strings.Index(html, "Save the date for our wedding!")
	monogramIdx := strings.Index(html, "monogram.png")
	assert.NotEqual(t, -1, preheaderIdx, "preheader text should be present")
	assert.NotEqual(t, -1, monogramIdx, "monogram should be present")
	assert.Less(t, preheaderIdx, monogramIdx, "preheader should come before the monogram")
}

func TestRenderEmail_DropsRawHTMLInTheBody(t *testing.T) {
	mctx := mergeFixture()
	// goldmark's safe defaults do not pass raw HTML through; a stray tag in the
	// body is omitted rather than injected into the email, so an admin's copy
	// can never smuggle a <script> into a guest's inbox.
	html := RenderEmail("s", "Watch out <script>alert(1)</script>", mctx)
	assert.NotContains(t, html, "<script>alert(1)</script>")
	// The visible text survives; only the raw tag is stripped.
	assert.Contains(t, html, "Watch out")
	assert.Contains(t, html, "alert(1)")
}

func TestRenderEmail_FooterCarriesPerGuestUnsubscribeLink(t *testing.T) {
	mctx := mergeFixture()
	mctx.Guest.Email = pointerutil.String("alice@example.com")
	html := RenderEmail("s", "Hello", mctx)

	// The footer links to the guest's own unsubscribe page and names the address
	// the mail went to (ADR 0009).
	assert.Contains(t, html, `href="https://robinandmadeline.com/u/11111111-1111-7111-8111-111111111111"`)
	assert.Contains(t, html, "This update was sent to")
	assert.Contains(t, html, "alice@example.com")
	assert.Contains(t, html, ">Unsubscribe</a")
}

func TestRenderEmail_OmitsUnsubscribeLinkWithoutGuestID(t *testing.T) {
	mctx := mergeFixture()
	// A sample/preview context with no addressable guest: no dead /u/ link.
	mctx.Guest.ID = ""
	html := RenderEmail("s", "Hello", mctx)

	assert.NotContains(t, html, "/u/")
	assert.NotContains(t, html, ">Unsubscribe</a")
}

func TestRenderEmail_InlinesBodyStyles(t *testing.T) {
	mctx := mergeFixture()
	html := RenderEmail("s", "## Details\n\nSee [the schedule](https://example.com/schedule) for **times**.\n\n> Book soon", mctx)

	// Clients that drop <style> still get the styling, since it rides on each tag.
	assert.Contains(t, html, `<h2 style="`+contentStyles["h2"]+`">Details</h2>`)
	assert.Contains(t, html, `<a style="`+contentStyles["a"]+`" href="https://example.com/schedule">the schedule</a>`)
	assert.Contains(t, html, `<strong style="`+contentStyles["strong"]+`">times</strong>`)
	assert.Contains(t, html, `<blockquote style="`+contentStyles["blockquote"]+`">`)
}

func TestRenderEmail_LoneLinkBecomesButton(t *testing.T) {
	mctx := mergeFixture()
	html := RenderEmail("s", "Intro.\n\n[RSVP now]({{rsvp_link}})\n\nInline [link](https://example.com) stays a link.", mctx)

	// A paragraph that is only a link renders as a bulletproof button.
	assert.Contains(t, html, `bgcolor="#b35b5f"`)
	assert.Regexp(t, `<a href="https://robinandmadeline.com/rsvp" style="display: inline-block;[^"]*">RSVP now</a>`, html)
	assert.NotContains(t, html, `<p style="`+contentStyles["p"]+`"><a style="`+contentStyles["a"]+`" href="https://robinandmadeline.com/rsvp">`)
	// A link inside running text stays an inline link.
	assert.Contains(t, html, `<a style="`+contentStyles["a"]+`" href="https://example.com">link</a> stays a link.`)
}

func TestRenderEmail_KeepsOutlookConditionalComments(t *testing.T) {
	mctx := mergeFixture()
	html := RenderEmail("s", "Hello", mctx)

	// html/template strips template comments, so these come from shellFuncs.
	assert.Contains(t, html, `<!--[if mso]><table role="presentation" width="600"`)
	assert.Contains(t, html, `<!--[if mso]></td></tr></table><![endif]-->`)
	assert.Contains(t, html, `<!--[if mso]><style>`)
}

func TestRenderEmail_LoadsHostedAssetsFromThePublicSite(t *testing.T) {
	mctx := mergeFixture()
	html := RenderEmail("s", "Hello", mctx)

	assert.Contains(t, html, `url("https://robinandmadeline.com/email/magics-flavor.woff2")`)
	assert.Contains(t, html, `href="https://robinandmadeline.com/"`)
	assert.Contains(t, html, `src="https://robinandmadeline.com/email/names.png"`)
}

func TestRenderEmail_DecorationsBecomeHostedImages(t *testing.T) {
	mctx := mergeFixture()
	html := RenderEmail("Hi {{hearts}}", "See you soon! {{hearts}}\n\nJust {{pink_heart}}", mctx)

	blue := `<img src="https://robinandmadeline.com/email/heart-blue.png" width="13" height="13" alt="` + "\U0001F499" + `"`
	pink := `<img src="https://robinandmadeline.com/email/heart-pink.png" width="13" height="13" alt="` + "\U0001FA77" + `"`
	assert.Contains(t, html, "See you soon! "+blue)
	assert.Contains(t, html, "Just "+pink)
	assert.Equal(t, 1, strings.Count(html, blue))
	assert.Equal(t, 2, strings.Count(html, pink))
	assert.NotContains(t, html, "{{hearts}}")
	assert.NotContains(t, html, "{{pink_heart}}")
	// The subject (the <title>) and the preheader use the emoji.
	assert.Contains(t, html, "<title>Hi \U0001F499\U0001FA77</title>")
	assert.Contains(t, html, "See you soon! \U0001F499\U0001FA77")
}

func TestRenderEmail_EveryHostedAssetExistsInPublicEmail(t *testing.T) {
	mctx := mergeFixture()
	html := RenderEmail("s", "Hi {{hearts}} {{blue_heart}} {{pink_heart}}", mctx)

	// The site serves public/email as immutable, so a renamed or missing file
	// would break every email that links to it; catch that here.
	assetRE := regexp.MustCompile(regexp.QuoteMeta(mctx.PublicBaseURL+EmailAssetPath+"/") + `([A-Za-z0-9._-]+)`)
	matches := assetRE.FindAllStringSubmatch(html, -1)
	require.NotEmpty(t, matches)
	seen := map[string]bool{}
	for _, m := range matches {
		name := m[1]
		if seen[name] {
			continue
		}
		seen[name] = true
		_, err := os.Stat(filepath.Join("..", "..", "public", "email", name))
		require.NoError(t, err, "public/email/%s", name)
	}
	// The monogram, script names, both hearts, and the heading font; a new
	// asset belongs in this list once its file is in public/email.
	assert.ElementsMatch(t, []string{"monogram.png", "names.png", "heart-blue.png", "heart-pink.png", "magics-flavor.woff2"}, keys(seen))
}

func TestRenderEmail_DecorationsInsideAttributesBecomeEmoji(t *testing.T) {
	html := RenderEmail("s", `[Our site](https://example.com "Love {{hearts}}") and ![{{pink_heart}}](https://example.com/a.png)`, mergeFixture())

	// An <img> inside an attribute would break the markup; the emoji keeps it.
	assert.Contains(t, html, `title="Love `+"\U0001F499\U0001FA77"+`"`)
	assert.Contains(t, html, `alt="`+"\U0001FA77"+`"`)
	assert.NotContains(t, html, `title="Love <img`)
	assert.NotContains(t, html, `alt="<img`)
}

func keys(m map[string]bool) []string {
	out := make([]string, 0, len(m))
	for k := range m {
		out = append(out, k)
	}
	return out
}
