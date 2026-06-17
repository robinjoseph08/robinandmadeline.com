package dashboard_test

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"github.com/google/uuid"
	"github.com/labstack/echo/v4"
	"github.com/robinjoseph08/golib/pointerutil"
	"github.com/robinjoseph08/robinandmadeline.com/internal/databasetest"
	"github.com/robinjoseph08/robinandmadeline.com/pkg/binder"
	"github.com/robinjoseph08/robinandmadeline.com/pkg/dashboard"
	"github.com/robinjoseph08/robinandmadeline.com/pkg/errcodes"
	"github.com/robinjoseph08/robinandmadeline.com/pkg/events"
	"github.com/robinjoseph08/robinandmadeline.com/pkg/models"
	"github.com/robinjoseph08/robinandmadeline.com/pkg/parties"
	"github.com/robinjoseph08/robinandmadeline.com/pkg/settings"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"github.com/uptrace/bun"
)

// fixtures bundles the services the dashboard tests build their data with, plus
// the wired-up API.
type fixtures struct {
	e        *echo.Echo
	db       *bun.DB
	parties  *parties.Service
	events   *events.Service
	settings *settings.Service
}

// newAPI wires the dashboard route onto a bare Echo group with the shared error
// handler and the custom binder (no auth middleware: these tests exercise the
// handler and the aggregation; auth is covered by the server package). It uses
// the package's own isolated Postgres test database (NewIsolated): these tests
// truncate parties/events/app_settings/email tables, which other package
// binaries own in the shared database. Every touched table is truncated so each
// test starts clean.
func newAPI(t *testing.T) fixtures {
	t.Helper()
	db := databasetest.NewIsolated(t, "robinandmadeline_dashboard_test")
	databasetest.Truncate(t, db, "parties", "events", "app_settings",
		"email_recipients", "email_sends")

	e := echo.New()
	b, err := binder.New()
	require.NoError(t, err)
	e.Binder = b
	e.HTTPErrorHandler = errcodes.NewHandler().Handle
	dashboard.RegisterRoutes(e.Group("/api/admin"), dashboard.NewService(db))

	return fixtures{
		e:        e,
		db:       db,
		parties:  parties.NewService(db),
		events:   events.NewService(db),
		settings: settings.NewService(db),
	}
}

func ctx() context.Context { return context.Background() }

// getDashboard issues the GET and decodes the response, asserting a 200.
func getDashboard(t *testing.T, f fixtures) dashboard.Response {
	t.Helper()
	req := httptest.NewRequestWithContext(ctx(), http.MethodGet, "/api/admin/dashboard", nil)
	rec := httptest.NewRecorder()
	f.e.ServeHTTP(rec, req)
	require.Equal(t, http.StatusOK, rec.Code, rec.Body.String())
	var resp dashboard.Response
	require.NoError(t, json.Unmarshal(rec.Body.Bytes(), &resp))
	return resp
}

// partyOpts tweaks a party fixture before creation.
type partyOpts struct {
	side           string
	relation       string
	invitationType string
}

// createParty creates a party fixture. Defaults: Robin's side, friend, digital.
func createParty(t *testing.T, f fixtures, name string, opts partyOpts) *models.Party {
	t.Helper()
	if opts.side == "" {
		opts.side = models.SideRobin
	}
	if opts.relation == "" {
		opts.relation = models.RelationFriend
	}
	if opts.invitationType == "" {
		opts.invitationType = models.InvitationDigital
	}
	p, err := f.parties.CreateParty(ctx(), parties.CreatePartyPayload{
		Name:           name,
		Side:           opts.side,
		Relation:       opts.relation,
		InvitationType: opts.invitationType,
	})
	require.NoError(t, err)
	return p
}

// createGuest adds a guest to a party.
func createGuest(t *testing.T, f fixtures, partyID, name string, primary bool, email *string) *models.Guest {
	t.Helper()
	g, err := f.parties.CreateGuest(ctx(), partyID, parties.CreateGuestPayload{
		FullName:  name,
		Email:     email,
		IsPrimary: primary,
	})
	require.NoError(t, err)
	return g
}

func emailOf(addr string) *string { return pointerutil.String(addr) }

// newID returns a fresh UUIDv7 string for fixtures inserted directly (the email
// send/recipient rows, which have no fixture service in this package).
func newID(t *testing.T) string {
	t.Helper()
	id, err := uuid.NewV7()
	require.NoError(t, err)
	return id.String()
}

func TestDashboard_EmptyIsAllZeros(t *testing.T) {
	// With no data the response is all zeros, the rate stats are 0 (no
	// divide-by-zero), the events list is [] not null, and the deadline is null.
	f := newAPI(t)

	resp := getDashboard(t, f)
	assert.Equal(t, 0, resp.TotalParties)
	assert.Equal(t, 0, resp.TotalGuests)
	assert.Equal(t, 0, resp.RSVPSummary.Total)
	assert.InDelta(t, 0, resp.RSVPSummary.ResponseRate, 0.0001)
	assert.Equal(t, 0, resp.InfoCollection.Total)
	assert.InDelta(t, 0, resp.InfoCollection.Rate, 0.0001)
	assert.Equal(t, 0, resp.Emails.Sent)
	assert.InDelta(t, 0, resp.Emails.DeliveryRate, 0.0001)
	assert.Nil(t, resp.RSVPDeadline)
	assert.NotNil(t, resp.Events)
	assert.Empty(t, resp.Events)
}

func TestDashboard_PartyAndGuestCounts(t *testing.T) {
	f := newAPI(t)
	// Side and relation are deliberately asymmetric (Robin 2 / Madeline 1 but
	// Family 1 / Friend 2) so a regression that mixes up the two dimensions or
	// queries the wrong column produces visibly wrong counts.
	p1 := createParty(t, f, "Smiths", partyOpts{side: models.SideRobin, relation: models.RelationFriend})
	createGuest(t, f, p1.ID, "Alice", true, emailOf("alice@example.com"))
	createGuest(t, f, p1.ID, "Bob", false, nil)
	p2 := createParty(t, f, "Joneses", partyOpts{side: models.SideMadeline, relation: models.RelationFamily})
	createGuest(t, f, p2.ID, "Carol", true, emailOf("carol@example.com"))

	resp := getDashboard(t, f)
	assert.Equal(t, 2, resp.TotalParties)
	assert.Equal(t, 3, resp.TotalGuests)

	// Guests are attributed to their party's side/relation.
	assert.Equal(t, 2, resp.GuestBreakdown.BySide.Robin)
	assert.Equal(t, 1, resp.GuestBreakdown.BySide.Madeline)
	assert.Equal(t, 1, resp.GuestBreakdown.ByRelation.Family)
	assert.Equal(t, 2, resp.GuestBreakdown.ByRelation.Friend)
}

func TestDashboard_PerEventRSVPBreakdownAndSummary(t *testing.T) {
	// A public event backfills a pending RSVP for every guest; overriding two of
	// them to attending/not_attending leaves one pending. A second public event
	// gets one attending override, the rest pending, so the site-wide summary
	// must sum across both events (not just reflect one), pinning the rollup as
	// an accumulation rather than an assignment.
	f := newAPI(t)
	p := createParty(t, f, "Smiths", partyOpts{})
	g1 := createGuest(t, f, p.ID, "Alice", true, emailOf("alice@example.com"))
	g2 := createGuest(t, f, p.ID, "Bob", false, nil)
	createGuest(t, f, p.ID, "Cara", false, nil)

	ev, err := f.events.CreateEvent(ctx(), events.CreateEventPayload{
		Name: "Ceremony", Date: "2026-08-01", IsPublic: true,
	})
	require.NoError(t, err)

	_, err = f.events.UpdateRSVPStatus(ctx(), ev.ID, g1.ID, events.UpdateEventRSVPPayload{Status: models.RSVPAttending})
	require.NoError(t, err)
	_, err = f.events.UpdateRSVPStatus(ctx(), ev.ID, g2.ID, events.UpdateEventRSVPPayload{Status: models.RSVPNotAttending})
	require.NoError(t, err)

	ev2, err := f.events.CreateEvent(ctx(), events.CreateEventPayload{
		Name: "Reception", Date: "2026-08-02", IsPublic: true,
	})
	require.NoError(t, err)

	_, err = f.events.UpdateRSVPStatus(ctx(), ev2.ID, g1.ID, events.UpdateEventRSVPPayload{Status: models.RSVPAttending})
	require.NoError(t, err)

	resp := getDashboard(t, f)
	require.Len(t, resp.Events, 2)
	// Events come back in schedule order: Ceremony (08-01) then Reception (08-02).
	ceremony := resp.Events[0].RSVPBreakdown
	assert.Equal(t, 1, ceremony.Attending)
	assert.Equal(t, 1, ceremony.NotAttending)
	assert.Equal(t, 1, ceremony.Pending)
	assert.Equal(t, 3, ceremony.Total)
	reception := resp.Events[1].RSVPBreakdown
	assert.Equal(t, 1, reception.Attending)
	assert.Equal(t, 0, reception.NotAttending)
	assert.Equal(t, 2, reception.Pending)
	assert.Equal(t, 3, reception.Total)

	// The summary rolls both events' rows up: 4 of 6 responded across the two.
	assert.Equal(t, 2, resp.RSVPSummary.Attending)
	assert.Equal(t, 1, resp.RSVPSummary.NotAttending)
	assert.Equal(t, 3, resp.RSVPSummary.Pending)
	assert.Equal(t, 3, resp.RSVPSummary.Responded)
	assert.Equal(t, 6, resp.RSVPSummary.Total)
	assert.InDelta(t, 3.0/6.0, resp.RSVPSummary.ResponseRate, 0.0001)
}

func TestDashboard_InfoCollectionProgressUsesEffectiveStatus(t *testing.T) {
	// Effective status (ADR 0005) has two branches the count must honor via the
	// model, not a reimplementation: a not-requested party derives complete iff
	// its required fields are present, while a requested party is complete only
	// when confirmed (its data alone is ignored). The fixtures exercise both:
	//   - derivedComplete:  not-requested, primary email present  -> complete
	//   - derivedIncomplete: not-requested, no primary email      -> incomplete
	//   - affirmedComplete: requested+confirmed (has email)        -> complete
	//   - affirmedPending:  requested, not confirmed (has email)   -> incomplete
	// The affirmedPending party has its email yet still reads incomplete, so the
	// count can never be a bare required-fields check, and the Relation("Guests")
	// load stays load-bearing (drop it and every party would read incomplete).
	f := newAPI(t)
	derivedComplete := createParty(t, f, "DerivedComplete", partyOpts{invitationType: models.InvitationDigital})
	createGuest(t, f, derivedComplete.ID, "Primary", true, emailOf("primary@example.com"))

	derivedIncomplete := createParty(t, f, "DerivedIncomplete", partyOpts{invitationType: models.InvitationDigital})
	createGuest(t, f, derivedIncomplete.ID, "NoEmail", true, nil)

	affirmedComplete := createParty(t, f, "AffirmedComplete", partyOpts{invitationType: models.InvitationDigital})
	createGuest(t, f, affirmedComplete.ID, "Primary", true, emailOf("affirmed@example.com"))
	_, err := f.parties.MarkComplete(ctx(), affirmedComplete.ID)
	require.NoError(t, err)

	affirmedPending := createParty(t, f, "AffirmedPending", partyOpts{invitationType: models.InvitationDigital})
	createGuest(t, f, affirmedPending.ID, "Primary", true, emailOf("pending@example.com"))
	_, err = f.parties.RequestInfo(ctx(), affirmedPending.ID)
	require.NoError(t, err)

	resp := getDashboard(t, f)
	assert.Equal(t, 2, resp.InfoCollection.Complete)
	assert.Equal(t, 2, resp.InfoCollection.Incomplete)
	assert.Equal(t, 4, resp.InfoCollection.Total)
	assert.InDelta(t, 0.5, resp.InfoCollection.Rate, 0.0001)
}

func TestDashboard_EmailStatsAndDeliveryRate(t *testing.T) {
	// Email stats roll the guest-facing email_recipients up: sent counts
	// dispatched rows (sent, delivered, bounced), delivered counts confirmed
	// ones, and the rate is delivered/sent. queued/sending/failed rows are
	// excluded from sent, and a TEST send's recipients are excluded entirely (a
	// test goes to the couple's inboxes, not guests, so it must not inflate the
	// guest-delivery headline).
	f := newAPI(t)
	p := createParty(t, f, "Smiths", partyOpts{})
	g := createGuest(t, f, p.ID, "Alice", true, emailOf("alice@example.com"))

	realSend := &models.EmailSend{
		ID: newID(t), Subject: "Hi", Body: "Body", SentAt: time.Now(), SentBy: "admin",
	}
	testSend := &models.EmailSend{
		ID: newID(t), Subject: "Test", Body: "Body", SentAt: time.Now(), SentBy: "admin", IsTest: true,
	}
	_, err := f.db.NewInsert().Model(realSend).Exec(ctx())
	require.NoError(t, err)
	_, err = f.db.NewInsert().Model(testSend).Exec(ctx())
	require.NoError(t, err)

	insertRecipient := func(sendID, status string) {
		rec := &models.EmailRecipient{
			ID: newID(t), SendID: sendID, GuestID: g.ID,
			EmailAddress: "alice@example.com", Status: status,
		}
		_, err := f.db.NewInsert().Model(rec).Exec(ctx())
		require.NoError(t, err)
	}

	// Real send: 2 delivered, 1 bounced, 1 sent (not yet upgraded), 1 queued,
	// 1 sending, 1 failed. The queued/sending/failed rows must all stay out of
	// Sent: queued and sending are not dispatched yet, and a failed row (whether
	// the worker never dispatched it or Mailgun permanently rejected it) is not
	// healthy delivery.
	for _, status := range []string{
		models.EmailDelivered, models.EmailDelivered, models.EmailBounced,
		models.EmailSent, models.EmailQueued, models.EmailSending, models.EmailFailed,
	} {
		insertRecipient(realSend.ID, status)
	}
	// Test send: a delivered row that must NOT be counted.
	insertRecipient(testSend.ID, models.EmailDelivered)

	resp := getDashboard(t, f)
	// Sent = delivered(2) + bounced(1) + sent(1) = 4; queued/sending/failed are
	// excluded, and the test send's delivered row is excluded.
	assert.Equal(t, 4, resp.Emails.Sent)
	assert.Equal(t, 2, resp.Emails.Delivered)
	assert.InDelta(t, 2.0/4.0, resp.Emails.DeliveryRate, 0.0001)
}

func TestDashboard_IncludesCurrentRSVPDeadline(t *testing.T) {
	// The dashboard surfaces the current rsvp_deadline app setting, reusing the
	// settings reader. Updating the setting changes the dashboard value, proving
	// the stats are computed fresh (not cached).
	f := newAPI(t)

	resp := getDashboard(t, f)
	assert.Nil(t, resp.RSVPDeadline)

	_, err := f.settings.Update(ctx(), settings.UpdateSettingsPayload{
		RSVPDeadline: pointerutil.String("2026-08-01T23:59:59Z"),
	})
	require.NoError(t, err)

	resp = getDashboard(t, f)
	require.NotNil(t, resp.RSVPDeadline)
	assert.Equal(t, "2026-08-01T23:59:59Z", *resp.RSVPDeadline)
}
