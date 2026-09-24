package models

// Guest attendance and party RSVP progress are derived from Event RSVP rows
// (a row is the invitation, ADR 0002). Each is defined once here, as a SQL
// condition, so the dashboard's counts and the admin list filters that link
// from them can never disagree about who falls in which bucket.

// Guest attendance buckets, across all of a guest's Event RSVPs:
//   - coming: attending at least one event (the derived "coming" of CONTEXT.md)
//   - declined: invited to at least one event and declined every one
//   - awaiting: neither, so no yes yet but something still pending (or no
//     invitations at all)
//   - expected: coming or awaiting, the guests who may still show up
const (
	//tygo:emit export type GuestAttendance = typeof AttendanceExpected | typeof AttendanceComing | typeof AttendanceAwaiting | typeof AttendanceDeclined;
	AttendanceExpected = "expected"
	AttendanceComing   = "coming"
	AttendanceAwaiting = "awaiting"
	AttendanceDeclined = "declined"
)

// Party RSVP progress buckets, across every Event RSVP of the party's guests:
//   - responded: every invitation answered (attending or not_attending)
//   - partial: some answered, some still pending
//   - not_responded: nothing answered (including a party invited to nothing)
const (
	//tygo:emit export type PartyRSVPProgress = typeof ProgressResponded | typeof ProgressPartial | typeof ProgressNotResponded;
	ProgressResponded    = "responded"
	ProgressPartial      = "partial"
	ProgressNotResponded = "not_responded"
)

// The building blocks, correlated to a guest aliased g or a party aliased p.
// The statuses are package constants inlined as literals, never user input.
const (
	guestHasRSVP       = "EXISTS (SELECT 1 FROM event_rsvps AS att_er WHERE att_er.guest_id = g.id)"
	guestAttendingSome = "EXISTS (SELECT 1 FROM event_rsvps AS att_er WHERE att_er.guest_id = g.id AND att_er.status = '" + RSVPAttending + "')"
	guestNotDeclined   = "EXISTS (SELECT 1 FROM event_rsvps AS att_er WHERE att_er.guest_id = g.id AND att_er.status <> '" + RSVPNotAttending + "')"
	guestDeclinedAll   = "(" + guestHasRSVP + " AND NOT " + guestNotDeclined + ")"

	partyAnsweredSome = "EXISTS (SELECT 1 FROM event_rsvps AS prog_er JOIN guests AS prog_g ON prog_g.id = prog_er.guest_id WHERE prog_g.party_id = p.id AND prog_er.status <> '" + RSVPPending + "')"
	partyPendingSome  = "EXISTS (SELECT 1 FROM event_rsvps AS prog_er JOIN guests AS prog_g ON prog_g.id = prog_er.guest_id WHERE prog_g.party_id = p.id AND prog_er.status = '" + RSVPPending + "')"
)

// GuestAttendanceCondition returns the SQL condition, over a guest aliased g,
// matching guests in the given attendance bucket. Callers validate the value
// first (the binder's oneof does); an unknown bucket matches nothing rather
// than producing malformed SQL.
func GuestAttendanceCondition(attendance string) string {
	switch attendance {
	case AttendanceComing:
		return guestAttendingSome
	case AttendanceDeclined:
		return guestDeclinedAll
	case AttendanceAwaiting:
		return "(NOT " + guestAttendingSome + " AND NOT " + guestDeclinedAll + ")"
	case AttendanceExpected:
		return "(NOT " + guestDeclinedAll + ")"
	}
	return "FALSE"
}

// PartyRSVPProgressCondition returns the SQL condition, over a party aliased
// p, matching parties in the given progress bucket. Callers validate the value
// first (the binder's oneof does); an unknown bucket matches nothing rather
// than producing malformed SQL.
func PartyRSVPProgressCondition(progress string) string {
	switch progress {
	case ProgressResponded:
		return "(" + partyAnsweredSome + " AND NOT " + partyPendingSome + ")"
	case ProgressPartial:
		return "(" + partyAnsweredSome + " AND " + partyPendingSome + ")"
	case ProgressNotResponded:
		return "(NOT " + partyAnsweredSome + ")"
	}
	return "FALSE"
}
