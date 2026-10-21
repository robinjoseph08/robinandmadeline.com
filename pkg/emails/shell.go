package emails

import (
	"bytes"
	_ "embed"
	"html/template"
	"strings"

	"github.com/robinjoseph08/golib/pointerutil"
	"github.com/yuin/goldmark"
	"github.com/yuin/goldmark/renderer/html"
)

// The HTML email shell: one in-repo, email-client-safe layout built from the
// site's design (a warm-white card on the soft grey page, the floral wreath
// monogram at the top, Magics Flavor headings and Winky Rough body text with
// system fallbacks, rose accents, and a signature footer below the card). Email
// clients ignore most external and <style> CSS, so the shell inlines its own
// styles and RenderEmail inlines the body's (styleContent). The Markdown body is
// rendered to HTML by goldmark with its safe defaults and injected as
// template.HTML; the subject stays plain text. Both a real send (worker.go) and
// the compose preview (service_send.go) build their HTML through RenderEmail, so
// the email the admin previews is the email that goes out.
//
// The monogram and heading font are hosted beside the site, in public/email,
// and referenced by absolute URL from PublicBaseURL, since an email cannot
// carry the site's fingerprinted build assets. The images keep transparent
// backgrounds so they sit cleanly on the card when a client (Gmail's apps)
// forces a dark mode and repaints it.

//go:embed shell.html
var shellHTML string

// Outlook for Windows needs conditional comments (a fixed-width column, since
// it ignores max-width; a font override, since it renders unknown web fonts as
// Times; and the desktop padding, since it ignores the media query that sets
// it everywhere else). html/template strips every comment from the template text, so the
// shell emits these through funcs instead.
var shellFuncs = template.FuncMap{
	"msoHeadStyles": func() template.HTML {
		return `<!--[if mso]><style>body,td,p,a,li,h1,h2,h3{font-family:Arial,sans-serif !important;}` +
			`.email-outer{padding:40px 16px !important;}.email-header{padding:36px 40px 4px !important;}` +
			`.email-content{padding:28px 48px 20px !important;}</style><![endif]-->`
	},
	"msoColumnOpen": func() template.HTML {
		return `<!--[if mso]><table role="presentation" width="600" cellpadding="0" cellspacing="0" border="0"><tr><td><![endif]-->`
	},
	"msoColumnClose": func() template.HTML {
		return `<!--[if mso]></td></tr></table><![endif]-->`
	},
}

// shellTemplate is the parsed shell, panicking at init on a malformed template
// (a programming error in an in-repo asset, never a runtime condition).
var shellTemplate = template.Must(template.New("emailShell").Funcs(shellFuncs).Parse(shellHTML))

// markdown renders the body to HTML. Hard wraps are on: a single newline in the
// compose box becomes a <br>, so two lines typed next to each other (for example
// a "Thanks,\nRobin" sign-off) stay on separate lines without the blank line a
// Markdown paragraph break would need; a blank line still starts a new, spaced
// paragraph. Otherwise goldmark keeps its safe defaults (raw HTML is dropped,
// not injected).
var markdown = goldmark.New(
	goldmark.WithRendererOptions(html.WithHardWraps()),
)

// shellData is the shell template's data: the plain-text subject (for the
// <title>), the inbox/notification preview line, and the body already rendered
// to HTML (injected verbatim).
type shellData struct {
	Subject string
	// Preheader is the inbox and notification preview line (the message's
	// opening), placed hidden at the top of the body so a client that builds the
	// snippet from the HTML previews the message rather than the shell's monogram.
	Preheader string
	Content   template.HTML
	// UnsubscribeURL is the per-recipient unsubscribe link in the footer (ADR
	// 0009). Empty when there is no addressable guest (a sample/preview with no
	// id), in which case the footer renders without the unsubscribe line.
	UnsubscribeURL string
	// RecipientEmail is the address the message went to, shown beside the
	// unsubscribe link so the reader knows which inbox the link affects.
	RecipientEmail string
	// SiteURL is the public site origin the monogram and footer link to.
	SiteURL string
	// AssetBaseURL is where the shell's hosted images and fonts live
	// (public/email on the site).
	AssetBaseURL string
}

// RenderEmail resolves the merge fields in the subject and Markdown body for one
// recipient, renders that body to HTML, and wraps it in the email shell,
// returning the full HTML document. The pipeline matches a real send exactly:
// merge fields resolve on the raw Markdown source first (so a link or code is
// substituted before Markdown parsing), then goldmark renders it, then the
// result is injected into the shell. On the rare chance goldmark errors, the
// merge-resolved source is wrapped as-is rather than failing the email.
func RenderEmail(subject, body string, mctx MergeContext) string {
	resolvedSubject := Render(subject, mctx)
	// Decorations stay as shortcodes through Markdown and become images after
	// it, so goldmark never sees (and drops) the raw <img> tags.
	mergedBody := resolveMergeFields(body, mctx)
	textBody := RenderText(body, mctx)
	assetBaseURL := mctx.PublicBaseURL + EmailAssetPath

	var htmlBody bytes.Buffer
	if err := markdown.Convert([]byte(mergedBody), &htmlBody); err != nil {
		// Failing a whole email over a Markdown render error would be worse than
		// sending the plain source; the text fallback carries the same content.
		htmlBody.Reset()
		htmlBody.WriteString(template.HTMLEscapeString(textBody))
	}
	content := decorateHTML(styleContent(htmlBody.String()), assetBaseURL)

	var out bytes.Buffer
	if err := shellTemplate.Execute(&out, shellData{
		Subject:   resolvedSubject,
		Preheader: preheaderText(textBody),
		// #nosec G203 -- the content is goldmark's own escaped HTML output (safe
		// defaults) plus the in-repo styles and decoration images, not raw user
		// input; injecting it verbatim is the point.
		Content:        template.HTML(content), //nolint:gosec
		UnsubscribeURL: unsubscribeURL(mctx),
		RecipientEmail: recipientEmail(mctx),
		SiteURL:        mctx.PublicBaseURL + "/",
		AssetBaseURL:   assetBaseURL,
	}); err != nil {
		// A shell execution failure is a programming error in an in-repo asset;
		// fall back to the rendered body so a send still carries content.
		return content
	}
	return out.String()
}

// preheaderText is the email's inbox and notification preview line: the
// merge-resolved body's opening, whitespace-collapsed and length-capped. The
// shell hides it at the top of the document, so a client that builds the snippet
// from the HTML previews the message instead of the monogram header. The text
// fallback already carries the body alone, so clients that snippet from that are
// unaffected.
func preheaderText(body string) string {
	const maxLen = 200
	collapsed := strings.Join(strings.Fields(body), " ")
	if len(collapsed) <= maxLen {
		return collapsed
	}
	// Cap by bytes, then drop a trailing rune the cut may have split in half.
	return strings.ToValidUTF8(collapsed[:maxLen], "")
}

// SampleSubject and SampleBody are the placeholder email the design previews
// start from: the dev shell-preview endpoint renders them as-is, and the email
// preview tool (cmd/emailpreview) seeds its editor with them. The body touches
// every merge field and the common Markdown shapes (including a lone link,
// which renders as a button) so the shell's styling of each is visible.
const (
	SampleSubject = "A note from {{guest_name}}'s favorite couple"
	SampleBody    = `Hi {{guest_first_name}},

We can't wait to celebrate with you! Here are the details for **{{event_name}}** on {{event_date}}.

## Before the big day

Your RSVP code is **{{rsvp_code}}**. A few things to do:

- Confirm your details on [your info page]({{info_link}})
- Book a room in one of our hotel blocks

[RSVP now]({{rsvp_link}})

> The hotel group rates end on March 9, 2027, so book soon!

See you soon! {{hearts}}
Robin & Madeline`
)

// SampleMergeContext is a merge context built from fixed sample entities, so
// every merge field resolves to a realistic value and a design preview is never
// blank. The guest carries an id and email so the footer's unsubscribe line
// renders too. It touches no database.
func SampleMergeContext(publicBaseURL string) MergeContext {
	guest := sampleGuest()
	guest.ID = "00000000-0000-0000-0000-000000000000"
	guest.Email = pointerutil.String("alex@example.com")
	return MergeContext{
		Guest:         guest,
		Party:         sampleParty(),
		Event:         sampleEvent(),
		PublicBaseURL: publicBaseURL,
	}
}

// ShellPreviewHTML renders the email shell with the fixed sample email, for the
// dev-only GET /emails/shell-preview endpoint. It lets a developer iterate on
// shell.html and the Markdown rendering: edit the file, refresh the browser (air
// hot-reloads the API), and see the result. It touches no database and uses no
// request data, so it is a pure design aid. For editing the body as well, use
// the email preview tool (mise preview:email).
func (s *Service) ShellPreviewHTML() string {
	return RenderEmail(SampleSubject, SampleBody, SampleMergeContext(s.publicBaseURL))
}
