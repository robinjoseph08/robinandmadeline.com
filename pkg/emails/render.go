package emails

import (
	"regexp"
	"strings"
	"time"

	"github.com/robinjoseph08/robinandmadeline.com/pkg/models"
)

// MergeContext carries the per-recipient values the merge fields resolve to.
// Guest and Party must be set (every recipient has both); Event is the event
// named in the send's recipient filter and may be nil, in which case the event
// fields render empty.
type MergeContext struct {
	Guest         *models.Guest
	Party         *models.Party
	Event         *models.Event
	PublicBaseURL string
}

// placeholderRE matches a merge field placeholder: {{field_name}}, with
// optional whitespace inside the braces.
var placeholderRE = regexp.MustCompile(`\{\{\s*([a-z_]+)\s*\}\}`)

// knownMergeFields is the single source of truth for which placeholder names
// resolve to a value: render's resolve, the merge-field emptiness validation
// (service_validate.go), and usedMergeFields all read this one set. A name not
// in here is an unknown placeholder, left intact by Render.
var knownMergeFields = toSet(mergeFieldOrder)

// mergeFieldOrder lists the merge fields in the order hints show them.
var mergeFieldOrder = []string{
	"guest_name",
	"guest_first_name",
	"rsvp_code",
	"rsvp_link",
	"info_link",
	"event_name",
	"event_date",
}

// MergeFieldNames returns the supported merge field names in display order,
// for tools that list them (the email preview). The compose page keeps its
// own copy in app/components/pages/admin/emails/merge-fields.ts.
func MergeFieldNames() []string { return append([]string(nil), mergeFieldOrder...) }

// DecorationNames returns the decoration shortcode names in display order.
func DecorationNames() []string { return append([]string(nil), decorationOrder...) }

func toSet(names []string) map[string]struct{} {
	set := make(map[string]struct{}, len(names))
	for _, n := range names {
		set[n] = struct{}{}
	}
	return set
}

// Render resolves every known merge field placeholder in text against the
// given context, and every decoration shortcode to its emoji (the plain-text
// stand-in for the images the HTML email shows; see RenderEmail). Unknown
// placeholders are left intact so a typo stays visible in the preview instead
// of silently vanishing from the sent email.
//
// Supported fields: {{guest_name}}, {{guest_first_name}}, {{rsvp_code}},
// {{rsvp_link}}, {{info_link}}, {{event_name}}, {{event_date}}. Decorations:
// {{hearts}}, {{blue_heart}}, {{pink_heart}}.
func Render(text string, mctx MergeContext) string {
	return replaceDecorations(resolveMergeFields(text, mctx), decorationEmoji)
}

// resolveMergeFields resolves the known merge fields in text, leaving every
// other placeholder (decorations included) intact.
func resolveMergeFields(text string, mctx MergeContext) string {
	return placeholderRE.ReplaceAllStringFunc(text, func(match string) string {
		field := placeholderRE.FindStringSubmatch(match)[1]
		value, ok := mctx.resolve(field)
		if !ok {
			return match
		}
		return value
	})
}

// decoration is one small inline image from the site, the hearts set at the end
// of a sentence (app/components/library/Hearts.tsx). The HTML email shows the
// hosted image; plain text, the subject, and an email with images blocked show
// the emoji, which keeps the color.
type decoration struct {
	file  string
	emoji string
}

var (
	blueHeart = decoration{file: "heart-blue.png", emoji: "\U0001F499"}
	pinkHeart = decoration{file: "heart-pink.png", emoji: "\U0001FA77"}
)

// decorations maps each shortcode to the images it renders, in order.
var decorations = map[string][]decoration{
	"hearts":     {blueHeart, pinkHeart},
	"blue_heart": {blueHeart},
	"pink_heart": {pinkHeart},
}

// decorationOrder lists the decoration shortcodes in the order hints show
// them; every name must be a key of decorations.
var decorationOrder = []string{"hearts", "blue_heart", "pink_heart"}

// replaceDecorations swaps each decoration shortcode in text for render's
// output, leaving every other placeholder intact.
func replaceDecorations(text string, render func([]decoration) string) string {
	return placeholderRE.ReplaceAllStringFunc(text, func(match string) string {
		decs, ok := decorations[placeholderRE.FindStringSubmatch(match)[1]]
		if !ok {
			return match
		}
		return render(decs)
	})
}

// decorationEmoji renders decorations as their emoji, for text contexts.
func decorationEmoji(decs []decoration) string {
	var b strings.Builder
	for _, d := range decs {
		b.WriteString(d.emoji)
	}
	return b.String()
}

// usedMergeFields returns the distinct known merge fields referenced across the
// given texts (typically a send's subject and body), in a stable order. It
// shares knownMergeFields with Render so the validation in service_validate.go
// and the rendering can never disagree on what counts as a field; unknown
// placeholders are ignored here exactly as Render leaves them intact.
func usedMergeFields(texts ...string) []string {
	seen := map[string]struct{}{}
	var used []string
	for _, text := range texts {
		for _, match := range placeholderRE.FindAllStringSubmatch(text, -1) {
			field := match[1]
			if _, ok := knownMergeFields[field]; !ok {
				continue
			}
			if _, dup := seen[field]; dup {
				continue
			}
			seen[field] = struct{}{}
			used = append(used, field)
		}
	}
	return used
}

// resolve maps one field name to its value, reporting false for unknown
// fields. Absent values (no RSVP code, no event) resolve to "".
func (m MergeContext) resolve(field string) (string, bool) {
	switch field {
	case "guest_name":
		return m.Guest.FullName, true
	case "guest_first_name":
		return firstName(m.Guest.FullName), true
	case "rsvp_code":
		if m.Party.RSVPCode == nil {
			return "", true
		}
		return *m.Party.RSVPCode, true
	case "rsvp_link":
		// The RSVP flow authenticates with the party's RSVP code at /rsvp;
		// there is no tokenized per-party RSVP URL (ADR 0003).
		return m.PublicBaseURL + "/rsvp", true
	case "info_link":
		return m.PublicBaseURL + "/i/" + m.Party.InfoToken, true
	case "event_name":
		if m.Event == nil {
			return "", true
		}
		return m.Event.Name, true
	case "event_date":
		if m.Event == nil {
			return "", true
		}
		return formatEventDate(m.Event.Date), true
	default:
		return "", false
	}
}

// firstName is the first space-separated word of a full name ("Alice" for
// "Alice Smith"), ignoring leading and repeated spaces. A blank name yields "".
func firstName(fullName string) string {
	if fields := strings.Fields(fullName); len(fields) > 0 {
		return fields[0]
	}
	return ""
}

// formatEventDate renders a stored "YYYY-MM-DD" event date as a human-readable
// long date ("Saturday, October 17, 2026"). An unparseable value falls back to
// the raw string rather than erroring: by the time a send renders, failing the
// whole email over a date format would be worse than showing the stored text.
func formatEventDate(date string) string {
	d, err := time.Parse("2006-01-02", date)
	if err != nil {
		return date
	}
	return d.Format("Monday, January 2, 2006")
}

// unsubscribeURL is the per-recipient unsubscribe link placed in the email
// footer and the List-Unsubscribe header (ADR 0009): the public site origin
// plus /u/ and the guest's id. It is empty when there is no addressable guest
// id (a sample or preview context) or no configured base URL, so the footer
// line and the header are omitted rather than pointing at a dead /u/ link.
func unsubscribeURL(mctx MergeContext) string {
	if mctx.Guest == nil || mctx.Guest.ID == "" || mctx.PublicBaseURL == "" {
		return ""
	}
	return mctx.PublicBaseURL + "/u/" + mctx.Guest.ID
}

// recipientEmail is the guest's email, shown in the footer beside the
// unsubscribe link so the reader knows which inbox it affects. Empty when the
// guest has no email on file (then the footer shows just the link).
func recipientEmail(mctx MergeContext) string {
	if mctx.Guest == nil || mctx.Guest.Email == nil {
		return ""
	}
	return *mctx.Guest.Email
}
