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
	p1 := createParty(t, f, "Smiths", partyOpts{side: models.SideRobin, relation: models.RelationFamily})
	createGuest(t, f, p1.ID, "Alice", true, emailOf("alice@example.com"))
	createGuest(t, f, p1.ID, "Bob", false, nil)
	p2 := createParty(t, f, "Joneses", partyOpts{side: models.SideMadeline, relation: models.RelationFriend})
	createGuest(t, f, p2.ID, "Carol", true, emailOf("carol@example.com"))

	resp := getDashboard(t, f)
	assert.Equal(t, 2, resp.TotalParties)
	assert.Equal(t, 3, resp.TotalGuests)

	// Guests are attributed to their party's side/relation.
	assert.Equal(t, 2, resp.GuestBreakdown.BySide.Robin)
	assert.Equal(t, 1, resp.GuestBreakdown.BySide.Madeline)
	assert.Equal(t, 2, resp.GuestBreakdown.ByRelation.Family)
	assert.Equal(t, 1, resp.GuestBreakdown.ByRelation.Friend)
}

func TestDashboard_PerEventRSVPBreakdownAndSummary(t *testing.T) {
	// A public event backfills a pending RSVP for every guest; overriding two of
	// them to attending/not_attending leaves one pending. The per-event breakdown
	// and the site-wide summary must both reflect that.
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

	resp := getDashboard(t, f)
	require.Len(t, resp.Events, 1)
	b := resp.Events[0].RSVPBreakdown
	assert.Equal(t, 1, b.Attending)
	assert.Equal(t, 1, b.NotAttending)
	assert.Equal(t, 1, b.Pending)
	assert.Equal(t, 3, b.Total)

	// The summary rolls every event's rows up: 2 of 3 responded.
	assert.Equal(t, 1, resp.RSVPSummary.Attending)
	assert.Equal(t, 1, resp.RSVPSummary.NotAttending)
	assert.Equal(t, 1, resp.RSVPSummary.Pending)
	assert.Equal(t, 2, resp.RSVPSummary.Responded)
	assert.Equal(t, 3, resp.RSVPSummary.Total)
	assert.InDelta(t, 2.0/3.0, resp.RSVPSummary.ResponseRate, 0.0001)
}

func TestDashboard_InfoCollectionProgressUsesEffectiveStatus(t *testing.T) {
	// Effective status (ADR 0005): a not-requested digital party with its
	// primary's email present derives complete; one without it derives
	// incomplete. The dashboard count must match the model's derivation, not a
	// reimplementation.
	f := newAPI(t)
	complete := createParty(t, f, "Complete", partyOpts{invitationType: models.InvitationDigital})
	createGuest(t, f, complete.ID, "Primary", true, emailOf("primary@example.com"))

	incomplete := createParty(t, f, "Incomplete", partyOpts{invitationType: models.InvitationDigital})
	createGuest(t, f, incomplete.ID, "NoEmail", true, nil)

	resp := getDashboard(t, f)
	assert.Equal(t, 1, resp.InfoCollection.Complete)
	assert.Equal(t, 1, resp.InfoCollection.Incomplete)
	assert.Equal(t, 2, resp.InfoCollection.Total)
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

	// Real send: 2 delivered, 1 bounced, 1 sent (not yet upgraded), 1 queued.
	for _, status := range []string{
		models.EmailDelivered, models.EmailDelivered, models.EmailBounced,
		models.EmailSent, models.EmailQueued,
	} {
		insertRecipient(realSend.ID, status)
	}
	// Test send: a delivered row that must NOT be counted.
	insertRecipient(testSend.ID, models.EmailDelivered)

	resp := getDashboard(t, f)
	// Sent = delivered(2) + bounced(1) + sent(1) = 4; queued is not sent, and
	// the test send's delivered row is excluded.
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
