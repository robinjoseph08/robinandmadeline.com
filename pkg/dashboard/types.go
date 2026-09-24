package dashboard

import (
	"github.com/robinjoseph08/robinandmadeline.com/pkg/events"
	"github.com/robinjoseph08/robinandmadeline.com/pkg/models"
)

// This file is the single home for the package's response types: handlers never
// use anonymous structs, echo.Map, or map[string]any. The dashboard is
// read-only (one GET), so there is no request payload; every type here is a
// response shape.

// SideBreakdown counts guests on each side. The two sides are a closed set
// (ADR-style enum on the party), so they are explicit fields rather than a map:
// the shape is fixed, the counts sum to the total guest count, and the frontend
// reads them without a missing-key guard.
type SideBreakdown struct {
	Robin    int `json:"robin"`
	Madeline int `json:"madeline"`
}

// RelationBreakdown counts guests by their party's relation (the other closed
// set), as explicit fields for the same reasons as SideBreakdown.
type RelationBreakdown struct {
	Family int `json:"family"`
	Friend int `json:"friend"`
}

// AgeBreakdown counts expected guests (see models.AttendanceExpected) by the
// is_child flag.
type AgeBreakdown struct {
	Adults   int `json:"adults"`
	Children int `json:"children"`
}

// DrinkingBreakdown counts expected guests (see models.AttendanceExpected) by
// the is_drinking flag.
type DrinkingBreakdown struct {
	Drinking    int `json:"drinking"`
	NotDrinking int `json:"not_drinking"`
}

// GuestBreakdown counts every guest by their party's side and relation, and
// the expected guests by their own child and drinking flags (the counts that
// plan catering and the bar, so declines drop out). The side and relation
// counts each sum to the total guest count; the age and drinking counts each
// sum to the expected count.
type GuestBreakdown struct {
	BySide     SideBreakdown     `json:"by_side"`
	ByRelation RelationBreakdown `json:"by_relation"`
	ByAge      AgeBreakdown      `json:"by_age"`
	ByDrinking DrinkingBreakdown `json:"by_drinking"`
}

// EventRSVPStats is one event's RSVP tally for the dashboard: the event facts
// the card shows plus the per-status breakdown (a row is the invitation, ADR
// 0002, so Total is also the invited count). It embeds the stored event by
// value so tygo flattens it into a plain `extends models.Event`, and reuses the
// events package's RSVPBreakdown so the per-event shape stays identical to the
// events list's.
type EventRSVPStats struct {
	models.Event  `tstype:",extends"`
	RSVPBreakdown events.RSVPBreakdown `json:"rsvp_breakdown" tstype:"events.RSVPBreakdown"`
}

// GuestAttendanceCounts counts guests in each attendance bucket (see
// models.GuestAttendanceCondition for the definitions), so the dashboard can
// show the headcount shrinking as declines come in. Coming, Awaiting, and
// Declined partition Total (every guest on the list); Expected is Coming +
// Awaiting (equivalently Total - Declined).
type GuestAttendanceCounts struct {
	Total    int `json:"total"`
	Expected int `json:"expected"`
	Coming   int `json:"coming"`
	Awaiting int `json:"awaiting"`
	Declined int `json:"declined"`
}

// PartyRSVPProgressCounts counts parties in each RSVP progress bucket (see
// models.PartyRSVPProgressCondition for the definitions). The three buckets
// sum to Total, the party count.
type PartyRSVPProgressCounts struct {
	Total        int `json:"total"`
	Responded    int `json:"responded"`
	Partial      int `json:"partial"`
	NotResponded int `json:"not_responded"`
}

// RSVPSummary is the site-wide RSVP rollup across every event's rows: the
// response rate the dashboard's headline stat shows. Responded is attending +
// not_attending (a stamped response either way), Total is every Event RSVP row,
// and ResponseRate is Responded/Total as a 0..1 fraction (0 when there are no
// rows, never a divide-by-zero).
type RSVPSummary struct {
	Attending    int     `json:"attending"`
	NotAttending int     `json:"not_attending"`
	Pending      int     `json:"pending"`
	Responded    int     `json:"responded"`
	Total        int     `json:"total"`
	ResponseRate float64 `json:"response_rate"`
}

// InfoCollectionProgress is the parties' info-collection rollup (ADR 0005): how
// many parties read complete versus incomplete by their effective status
// (derived for not-requested parties, the confirmed flag for requested ones).
// Complete + Incomplete equals the total party count, and Rate is
// Complete/Total as a 0..1 fraction (0 when there are no parties).
type InfoCollectionProgress struct {
	Complete   int     `json:"complete"`
	Incomplete int     `json:"incomplete"`
	Total      int     `json:"total"`
	Rate       float64 `json:"rate"`
}

// EmailStats is the email-delivery rollup over every recipient row. Sent counts
// the recipients whose current status is sent, delivered, or bounced (a
// delivered/bounced row is a sent row the webhook later upgraded); queued,
// sending, and failed rows are excluded. Delivered counts those Mailgun
// confirmed. DeliveryRate is Delivered/Sent as a 0..1 fraction (0 when nothing
// has been sent, never a divide-by-zero).
type EmailStats struct {
	Sent         int     `json:"sent"`
	Delivered    int     `json:"delivered"`
	DeliveryRate float64 `json:"delivery_rate"`
}

// Response is the body of GET /api/admin/dashboard: the overview stats the
// admin home renders. It is computed fresh on every request (no caching), so it
// always reflects the current data. RSVPDeadline is the current rsvp_deadline
// app setting (an RFC3339 string), null when unset.
type Response struct {
	GuestBreakdown    GuestBreakdown          `json:"guest_breakdown"`
	GuestAttendance   GuestAttendanceCounts   `json:"guest_attendance"`
	PartyRSVPProgress PartyRSVPProgressCounts `json:"party_rsvp_progress"`

	// Events is every event with its RSVP breakdown, in schedule order; an empty
	// list serializes as [] (never null) so the page can map over it unguarded.
	Events      []EventRSVPStats `json:"events"`
	RSVPSummary RSVPSummary      `json:"rsvp_summary"`

	InfoCollection InfoCollectionProgress `json:"info_collection"`
	Emails         EmailStats             `json:"emails"`

	RSVPDeadline *string `json:"rsvp_deadline"`
}
