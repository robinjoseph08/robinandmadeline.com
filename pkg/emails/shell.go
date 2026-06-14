package emails

import (
	"bytes"
	_ "embed"
	"html/template"
	"strings"

	"github.com/yuin/goldmark"
	"github.com/yuin/goldmark/renderer/html"
)

// The HTML email shell: one in-repo, email-client-safe layout (a centered
// max-width card with a monogram header, a single Markdown-filled content slot,
// and a small footer) styled in the site's palette with inline styles, since
// email clients ignore most external/<style> CSS. The Markdown body is rendered
// to HTML by goldmark with its safe defaults and injected as template.HTML; the
// subject stays plain text. Both a real send (worker.go) and the compose
// preview (service_send.go) build their HTML through RenderEmail, so the email
// the admin previews is the email that goes out.

//go:embed shell.html
var shellHTML string

// shellTemplate is the parsed shell, panicking at init on a malformed template
// (a programming error in an in-repo asset, never a runtime condition).
var shellTemplate = template.Must(template.New("emailShell").Parse(shellHTML))

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
	resolvedBody := Render(body, mctx)

	var htmlBody bytes.Buffer
	if err := markdown.Convert([]byte(resolvedBody), &htmlBody); err != nil {
		// Failing a whole email over a Markdown render error would be worse than
		// sending the plain source; the text fallback carries the same content.
		htmlBody.Reset()
		htmlBody.WriteString(template.HTMLEscapeString(resolvedBody))
	}

	var out bytes.Buffer
	if err := shellTemplate.Execute(&out, shellData{
		Subject:   resolvedSubject,
		Preheader: preheaderText(resolvedBody),
		// #nosec G203 -- the content is goldmark's own escaped HTML output (safe
		// defaults), not raw user input; injecting it verbatim is the point.
		Content: template.HTML(htmlBody.String()), //nolint:gosec
	}); err != nil {
		// A shell execution failure is a programming error in an in-repo asset;
		// fall back to the rendered body so a send still carries content.
		return htmlBody.String()
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

// ShellPreviewHTML renders the email shell with fixed sample Markdown content
// and sample merge values, for the dev-only GET /emails/shell-preview endpoint.
// It lets a developer iterate on shell.html and the Markdown rendering: edit the
// file, refresh the browser (air hot-reloads the API), and see the result. It
// touches no database and uses no request data, so it is a pure design aid.
func (s *Service) ShellPreviewHTML() string {
	mctx := MergeContext{
		Guest:         sampleGuest(),
		Party:         sampleParty(),
		Event:         sampleEvent(),
		PublicBaseURL: s.publicBaseURL,
	}
	const sampleBody = `Hi {{guest_name}},

We can't wait to celebrate with you! Here are the details for **{{event_name}}** on {{event_date}}.

Your RSVP code is **{{rsvp_code}}**. A few things to do:

- Confirm your details at [your info page]({{info_link}})
- RSVP at [our site]({{rsvp_link}})

See you soon!`
	return RenderEmail("Sample email", sampleBody, mctx)
}
