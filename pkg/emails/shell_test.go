package emails

import (
	"strings"
	"testing"

	"github.com/robinjoseph08/golib/pointerutil"
	"github.com/stretchr/testify/assert"
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
	assert.Contains(t, html, "R <span") // the monogram header

	// Merge fields resolved before Markdown rendering: the body shows the
	// values, never the placeholders.
	assert.Contains(t, html, "Alice Smith")
	assert.Contains(t, html, "KALEL")
	assert.NotContains(t, html, "{{guest_name}}")
	assert.NotContains(t, html, "{{rsvp_code}}")

	// Markdown rendered to HTML: bold became <strong>, the link became an <a>.
	assert.Contains(t, html, "<strong>Alice Smith</strong>")
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
	monogramIdx := strings.Index(html, "R <span")
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
