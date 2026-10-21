package emails

import (
	"regexp"
	"strings"
)

// EmailAssetPath is where the shell's hosted images and fonts are served from,
// relative to the site origin. The files live in public/email, which the build
// copies to the site root. The site serves them as immutable (cached for a
// year), because sent emails link to them forever: to change one, add it under
// a new file name and point the shell at that, never edit a file in place.
const EmailAssetPath = "/email"

// The font stacks the email uses, mirroring the site's faces. Clients without
// web font support (Gmail, Outlook) fall back to the system faces after them.
const (
	bodyFontStack    = `'Winky Rough', -apple-system, BlinkMacSystemFont, 'Segoe UI', Helvetica, Arial, sans-serif`
	displayFontStack = `'Magics Flavor', 'Hoefler Text', Georgia, serif`
	monoFontStack    = `'Courier Prime', ui-monospace, Menlo, Consolas, monospace`
)

// contentStyles is the inline style for each tag goldmark emits. Many email
// clients drop <style> blocks, so the body's styling rides on each element.
// Colors are the site palette: ink text, a deepened rose for link text (the
// site rose is too light to read as small text), and the rose tint for quotes.
var contentStyles = map[string]string{
	"p":          "margin: 0 0 18px 0;",
	"h1":         "margin: 0 0 14px 0; font-family: " + displayFontStack + "; font-size: 30px; line-height: 1.2; font-weight: normal; color: #2a2622;",
	"h2":         "margin: 26px 0 12px 0; font-family: " + displayFontStack + "; font-size: 24px; line-height: 1.25; font-weight: normal; color: #2a2622;",
	"h3":         "margin: 22px 0 10px 0; font-family: " + displayFontStack + "; font-size: 19px; line-height: 1.3; font-weight: normal; color: #2a2622;",
	"h4":         "margin: 20px 0 8px 0; font-size: 16px; line-height: 1.4; font-weight: 700; color: #2a2622;",
	"h5":         "margin: 20px 0 8px 0; font-size: 16px; line-height: 1.4; font-weight: 700; color: #2a2622;",
	"h6":         "margin: 20px 0 8px 0; font-size: 16px; line-height: 1.4; font-weight: 700; color: #2a2622;",
	"ul":         "margin: 0 0 18px 0; padding-left: 22px;",
	"ol":         "margin: 0 0 18px 0; padding-left: 22px;",
	"li":         "margin: 0 0 6px 0;",
	"a":          "color: #a9545a; text-decoration: underline;",
	"strong":     "font-weight: 700; color: #2a2622;",
	"blockquote": "margin: 0 0 18px 0; padding: 16px 20px 1px 20px; background-color: #f3e1e1; border-left: 3px solid #d6787b; border-radius: 10px; color: #2a2622;",
	"hr":         "margin: 28px 0; border: 0; border-top: 1px solid #e0d9d0; height: 0;",
	"pre":        "margin: 0 0 18px 0; padding: 14px 16px; background-color: #f1ede7; border-radius: 8px; white-space: pre-wrap; font-size: 14px;",
	"code":       "font-family: " + monoFontStack + "; font-size: 0.92em; background-color: #f1ede7; border-radius: 4px; padding: 1px 5px;",
	"img":        "max-width: 100%; height: auto; border: 0; border-radius: 10px;",
}

// contentTagRE matches the opening of a tag goldmark emits. goldmark writes bare
// tags (the only attributes are href, title, src, alt, and an ordered list's
// start), so a style attribute can be added right after the name.
var contentTagRE = regexp.MustCompile(`<(p|h[1-6]|ul|ol|li|a|strong|blockquote|hr|pre|code|img)([\s>/])`)

// buttonRE matches a paragraph whose whole content is one plain-text link, after
// styleContent has styled it: the shape a "[RSVP now]({{rsvp_link}})" line
// renders to.
var buttonRE = regexp.MustCompile(
	`<p style="` + regexp.QuoteMeta(contentStyles["p"]) + `"><a style="` + regexp.QuoteMeta(contentStyles["a"]) + `" (href="[^"]*"[^>]*)>([^<]+)</a></p>`,
)

// buttonHTML is a bulletproof button (the color sits on the table cell, so it
// survives clients that ignore padding on links). $1 is the link's attributes
// and $2 its text. The fill is the site rose deepened just enough for white text
// to pass contrast (4.6:1).
const buttonHTML = `<table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin: 4px 0 22px 0;"><tr>` +
	`<td align="center" bgcolor="#b35b5f" style="background-color: #b35b5f; border-radius: 10px;">` +
	`<a $1 style="display: inline-block; padding: 13px 28px; font-family: ` + bodyFontStack + `; font-size: 16px; font-weight: 600; line-height: 1.2; color: #ffffff; text-decoration: none; border-radius: 10px;">$2</a>` +
	`</td></tr></table>`

// htmlTagRE matches one tag in goldmark's output. goldmark escapes "<" and ">"
// inside attribute values, so a tag never contains either.
var htmlTagRE = regexp.MustCompile(`<[^<>]*>`)

// decorateHTML swaps decoration shortcodes in rendered HTML for their images,
// but only in text. Inside a tag (a link's title, an image's alt text) an
// <img> would break the markup, so the emoji stands in there instead.
func decorateHTML(html, assetBaseURL string) string {
	images := decorationImages(assetBaseURL)
	var b strings.Builder
	last := 0
	for _, loc := range htmlTagRE.FindAllStringIndex(html, -1) {
		b.WriteString(replaceDecorations(html[last:loc[0]], images))
		b.WriteString(replaceDecorations(html[loc[0]:loc[1]], decorationEmoji))
		last = loc[1]
	}
	b.WriteString(replaceDecorations(html[last:], images))
	return b.String()
}

// decorationImages renders decorations as inline images hosted under
// assetBaseURL. They are sized in em to track the surrounding text like the
// site's hearts (0.8em, a hair below the baseline); the width and height
// attributes are the 16px-body fallback for clients that drop the style.
func decorationImages(assetBaseURL string) func([]decoration) string {
	return func(decs []decoration) string {
		var b strings.Builder
		for i, d := range decs {
			margin := ""
			if i > 0 {
				margin = " margin-left: 0.15em;"
			}
			b.WriteString(`<img src="` + assetBaseURL + "/" + d.file + `" width="13" height="13" alt="` + d.emoji + `"` +
				` style="display: inline-block; width: 0.8em; height: 0.8em; border: 0; vertical-align: -0.05em;` + margin + `">`)
		}
		return b.String()
	}
}

// styleContent inlines the email's styles into goldmark's HTML and turns each
// paragraph that is only a link into a rose button, so a call to action stands
// out without the compose box needing anything beyond Markdown.
func styleContent(body string) string {
	styled := contentTagRE.ReplaceAllStringFunc(body, func(match string) string {
		m := contentTagRE.FindStringSubmatch(match)
		return "<" + m[1] + ` style="` + contentStyles[m[1]] + `"` + m[2]
	})
	return buttonRE.ReplaceAllString(styled, buttonHTML)
}
