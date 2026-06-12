package emails_test

import (
	"context"
	"testing"

	"github.com/robinjoseph08/golib/pointerutil"
	"github.com/robinjoseph08/robinandmadeline.com/internal/databasetest"
	"github.com/robinjoseph08/robinandmadeline.com/pkg/emails"
	"github.com/robinjoseph08/robinandmadeline.com/pkg/errcodes"
	"github.com/robinjoseph08/robinandmadeline.com/pkg/events"
	"github.com/robinjoseph08/robinandmadeline.com/pkg/models"
	"github.com/robinjoseph08/robinandmadeline.com/pkg/parties"
	"github.com/stretchr/testify/require"
	"github.com/uptrace/bun"
)

// testBaseURL is the public origin merge-field links are built on in tests.
const testBaseURL = "https://example.test"

// testSentBy is the admin username recorded on test sends.
const testSentBy = "admin"

// testDailySendLimit is the daily send budget the fixture service reports on
// previews. High enough that no unrelated test ever brushes against it.
const testDailySendLimit = 100

// fixtures bundles the services the email tests build their data with.
type fixtures struct {
	emails  *emails.Service
	parties *parties.Service
	events  *events.Service
	db      *bun.DB
}

// newFixtures returns the services backed by this package's own Postgres test
// database (NewIsolated: these tests truncate parties and events, which other
// package binaries own in the shared database), truncating all touched tables
// so each test starts clean. Tests using it must not call t.Parallel().
func newFixtures(t *testing.T) fixtures {
	t.Helper()
	db := databasetest.NewIsolated(t, "robinandmadeline_emails_test")
	databasetest.Truncate(t, db, "email_templates", "email_sends", "events", "parties")
	return fixtures{
		emails:  emails.NewService(db, testBaseURL, testSentBy, testDailySendLimit),
		parties: parties.NewService(db),
		events:  events.NewService(db),
		db:      db,
	}
}

// ctx returns a background context for service calls in tests.
func ctx() context.Context { return context.Background() }

// assertErrCode asserts that err resolves to an *errcodes.Error with the given
// code.
func assertErrCode(t *testing.T, err error, code errcodes.Code) {
	t.Helper()
	require.Error(t, err)
	var e *errcodes.Error
	require.ErrorAs(t, err, &e)
	require.Equal(t, string(code), e.Code)
}

// partyOpts tweaks a party fixture before creation.
type partyOpts struct {
	side           string
	relation       string
	circle         []string
	invitationType string
	rsvpCode       *string
}

// createPartyT creates a party fixture. Defaults: Robin's side, friend,
// digital invitation, no circles.
func createPartyT(t *testing.T, f fixtures, name string, opts partyOpts) *models.Party {
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
		Circle:         opts.circle,
		InvitationType: opts.invitationType,
		RSVPCode:       opts.rsvpCode,
	})
	require.NoError(t, err)
	return p
}

// guestOpts tweaks a guest fixture before creation. primary matters to the
// info-collection status tests: the completion gate reads the PRIMARY guest's
// email (ADR 0005), and CreateGuest does not auto-promote.
type guestOpts struct {
	email   *string
	tags    []string
	primary bool
}

// createGuestT adds a guest fixture to a party.
func createGuestT(t *testing.T, f fixtures, partyID, name string, opts guestOpts) *models.Guest {
	t.Helper()
	g, err := f.parties.CreateGuest(ctx(), partyID, parties.CreateGuestPayload{
		FullName:  name,
		Email:     opts.email,
		Tags:      opts.tags,
		IsPrimary: opts.primary,
	})
	require.NoError(t, err)
	return g
}

// emailOf is a shorthand for a guest email pointer.
func emailOf(addr string) *string { return pointerutil.String(addr) }

// templateInput is a minimal valid template payload.
func templateInput() emails.CreateTemplatePayload {
	return emails.CreateTemplatePayload{
		Name:    "Save the date",
		Subject: "Save the date, {{guest_name}}!",
		Body:    "Hi {{guest_name}}, save {{event_date}} for {{event_name}}.",
	}
}

// createTemplateT creates a template via the service.
func createTemplateT(t *testing.T, f fixtures, in emails.CreateTemplatePayload) *models.EmailTemplate {
	t.Helper()
	tpl, err := f.emails.CreateTemplate(ctx(), in)
	require.NoError(t, err)
	return tpl
}

// recipientsForSend reads every email_recipients row for a send straight from
// the DB, keyed by guest id, so assertions reflect persisted state.
func recipientsForSend(t *testing.T, db *bun.DB, sendID string) map[string]*models.EmailRecipient {
	t.Helper()
	var rows []*models.EmailRecipient
	err := db.NewSelect().Model(&rows).Where("send_id = ?", sendID).Scan(ctx())
	require.NoError(t, err)
	byGuest := make(map[string]*models.EmailRecipient, len(rows))
	for _, r := range rows {
		byGuest[r.GuestID] = r
	}
	return byGuest
}
