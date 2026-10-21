package emails

import (
	"testing"

	"github.com/stretchr/testify/assert"
)

func TestRenderText_ReducesMarkdownToReadableText(t *testing.T) {
	body := "Hey {{guest_first_name}}! We're **close**.\n\n" +
		"---\n\n" +
		"## Hotel Blocks\n\n" +
		"Book on [our travel page](https://example.com/travel) or at <https://example.com>.\n" +
		"Thanks,\nRobin\n\n" +
		"- Free parking\n- Free *breakfast*\n\n" +
		"1. RSVP\n2. Book a room\n\n" +
		"> Rates end March 9 {{hearts}}\n\n" +
		"[RSVP now]({{rsvp_link}})"

	got := RenderText(body, mergeFixture())

	assert.Equal(t, "Hey Alice! We're close.\n\n"+
		"Hotel Blocks\n\n"+
		"Book on our travel page (https://example.com/travel) or at https://example.com.\n"+
		"Thanks,\nRobin\n\n"+
		"- Free parking\n- Free breakfast\n\n"+
		"1. RSVP\n2. Book a room\n\n"+
		"Rates end March 9 \U0001F499\U0001FA77\n\n"+
		"RSVP now (https://robinandmadeline.com/rsvp)", got)
}

func TestRenderEmail_PreheaderIsPlainTextNotMarkdown(t *testing.T) {
	html := RenderEmail("s", "Hey everyone!\n\n---\n\n## Hotel Blocks\n\nWe've been **working** on it.", mergeFixture())

	// The inbox preview line reads like the email, not its Markdown source.
	assert.Contains(t, html, "Hey everyone! Hotel Blocks We&#39;ve been working on it.")
	assert.NotContains(t, html, "## Hotel")
	assert.NotContains(t, html, "--- ")
}

func TestRenderText_ResolvesEscapesAndEntitiesButNotInCode(t *testing.T) {
	got := RenderText("Fish \\*and\\* chips &amp; more &copy; &#233;\n\n1\\. done \\`code\\`\n\nRun `a\\*b &amp; c`", mergeFixture())
	assert.Equal(t, "Fish *and* chips & more \u00a9 \u00e9\n\n1. done `code`\n\nRun a\\*b &amp; c", got)
}
