package emails

import (
	"regexp"
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
var knownMergeFields = map[string]struct{}{
	"guest_name": {},
	"rsvp_code":  {},
	"rsvp_link":  {},
	"info_link":  {},
	"event_name": {},
	"event_date": {},
}

// Render resolves every known merge field placeholder in text against the
// given context. Unknown placeholders are left intact so a typo stays visible
// in the preview instead of silently vanishing from the sent email.
//
// Supported fields: {{guest_name}}, {{rsvp_code}}, {{rsvp_link}},
// {{info_link}}, {{event_name}}, {{event_date}}.
func Render(text string, mctx MergeContext) string {
	return placeholderRE.ReplaceAllStringFunc(text, func(match string) string {
		field := placeholderRE.FindStringSubmatch(match)[1]
		value, ok := mctx.resolve(field)
		if !ok {
			return match
		}
		return value
	})
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
