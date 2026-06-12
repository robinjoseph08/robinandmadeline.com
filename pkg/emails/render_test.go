package emails

import (
	"testing"

	"github.com/robinjoseph08/golib/pointerutil"
	"github.com/robinjoseph08/robinandmadeline.com/pkg/models"
	"github.com/stretchr/testify/assert"
)

// mergeFixture builds a fully-populated merge context; tests blank out fields
// to exercise the absent-value branches.
func mergeFixture() MergeContext {
	return MergeContext{
		Guest: &models.Guest{FullName: "Alice Smith"},
		Party: &models.Party{
			Name:      "The Smiths",
			InfoToken: "tok123abc",
			RSVPCode:  pointerutil.String("KALEL"),
		},
		Event: &models.Event{
			Name: "Reception",
			Date: "2026-10-17",
		},
		PublicBaseURL: "https://robinandmadeline.com",
	}
}

func TestRender_ResolvesEveryMergeField(t *testing.T) {
	mctx := mergeFixture()
	in := "Hi {{guest_name}} of {{party_name}}: code {{rsvp_code}}, rsvp at {{rsvp_link}}, " +
		"info at {{info_link}}, see you at {{event_name}} on {{event_date}}."
	got := Render(in, mctx)
	assert.Equal(t,
		"Hi Alice Smith of The Smiths: code KALEL, rsvp at https://robinandmadeline.com/rsvp, "+
			"info at https://robinandmadeline.com/i/tok123abc, see you at Reception on Saturday, October 17, 2026.",
		got)
}

func TestRender_AllowsWhitespaceInsidePlaceholders(t *testing.T) {
	got := Render("Hi {{ guest_name }}!", mergeFixture())
	assert.Equal(t, "Hi Alice Smith!", got)
}

func TestRender_LeavesUnknownPlaceholdersIntact(t *testing.T) {
	// A typo stays visible in the rendered output instead of vanishing, so the
	// preview surfaces it before the send goes out.
	got := Render("Hi {{guest_nam}}!", mergeFixture())
	assert.Equal(t, "Hi {{guest_nam}}!", got)
}

func TestRender_MissingRSVPCodeRendersEmpty(t *testing.T) {
	mctx := mergeFixture()
	mctx.Party.RSVPCode = nil
	got := Render("Code: {{rsvp_code}}.", mctx)
	assert.Equal(t, "Code: .", got)
}

func TestRender_NoEventRendersEventFieldsEmpty(t *testing.T) {
	// Event fields resolve from the event in the recipient filter; a send with
	// no event filter has no event to name.
	mctx := mergeFixture()
	mctx.Event = nil
	got := Render("{{event_name}} on {{event_date}}", mctx)
	assert.Equal(t, " on ", got)
}

func TestRender_UnparseableEventDateFallsBackToRawValue(t *testing.T) {
	mctx := mergeFixture()
	mctx.Event.Date = "not-a-date"
	got := Render("{{event_date}}", mctx)
	assert.Equal(t, "not-a-date", got)
}

func TestRender_PlaceholderGuestUsesItsCurrentName(t *testing.T) {
	// An unnamed plus-one slot's full_name is its placeholder text, so the
	// email addresses the slot by its descriptor until the party names it.
	mctx := mergeFixture()
	mctx.Guest.FullName = "Guest of John Doe"
	got := Render("Hi {{guest_name}}", mctx)
	assert.Equal(t, "Hi Guest of John Doe", got)
}
