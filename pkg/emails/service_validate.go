package emails

import (
	"fmt"
	"strings"

	"github.com/robinjoseph08/robinandmadeline.com/pkg/models"
)

// mergeFieldProblems reports the merge fields a draft references that would
// resolve empty for at least one of its recipients, the backbone of the
// "a sent email can never contain a blank merge field" rule. The same checks
// power two surfaces: Preview returns them as a non-fatal warnings list (so the
// compose page can show them and disable Send) and CreateSend turns any
// non-empty result into a hard 422 (so even a direct API call cannot dispatch a
// blank field).
//
// Two known fields can resolve empty:
//   - {{event_name}} / {{event_date}}: the event for merge fields is the one
//     named in the recipient filter (one event per send), so with no event
//     selected (or one that no longer exists) these render empty for everyone.
//   - {{rsvp_code}}: a matching recipient's party may have no RSVP code (a
//     cleared code stays empty), which renders empty for that recipient.
//
// It reuses usedMergeFields, so the field set here can never drift from what
// Render resolves. event is the resolved filter event (nil when none is
// selected or it was deleted); recipients are the already-resolved guests with
// their Party loaded.
func mergeFieldProblems(subject, body string, event *models.Event, recipients []*models.Guest) []MergeFieldWarning {
	used := map[string]struct{}{}
	for _, field := range usedMergeFields(subject, body) {
		used[field] = struct{}{}
	}

	var problems []MergeFieldWarning

	_, usesEventName := used["event_name"]
	_, usesEventDate := used["event_date"]
	if (usesEventName || usesEventDate) && event == nil {
		field := "event_name"
		if !usesEventName {
			field = "event_date"
		}
		problems = append(problems, MergeFieldWarning{
			Field:   field,
			Message: "uses {{event_name}}/{{event_date}} but no event is selected in the recipient filter.",
		})
	}

	if _, usesCode := used["rsvp_code"]; usesCode {
		missing := 0
		for _, g := range recipients {
			if g.Party == nil || g.Party.RSVPCode == nil {
				missing++
			}
		}
		if missing > 0 {
			problems = append(problems, MergeFieldWarning{
				Field: "rsvp_code",
				Message: fmt.Sprintf("uses {{rsvp_code}} but %d of %d recipient%s have no RSVP code.",
					missing, len(recipients), plural(len(recipients))),
			})
		}
	}

	return problems
}

// plural returns "s" unless n is exactly 1, for grammatical agreement in the
// warning messages.
func plural(n int) string {
	if n == 1 {
		return ""
	}
	return "s"
}

// joinProblems renders the problems' messages into one sentence for the
// CreateSend hard-fail, so a direct API caller sees exactly what would have
// gone blank.
func joinProblems(problems []MergeFieldWarning) string {
	msgs := make([]string, 0, len(problems))
	for _, p := range problems {
		msgs = append(msgs, p.Message)
	}
	return strings.Join(msgs, " ")
}
