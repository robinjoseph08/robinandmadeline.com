package subscriptions_test

import (
	"context"
	"testing"

	"github.com/google/uuid"
	"github.com/robinjoseph08/golib/pointerutil"
	"github.com/robinjoseph08/robinandmadeline.com/internal/databasetest"
	"github.com/robinjoseph08/robinandmadeline.com/pkg/errcodes"
	"github.com/robinjoseph08/robinandmadeline.com/pkg/models"
	"github.com/robinjoseph08/robinandmadeline.com/pkg/parties"
	"github.com/robinjoseph08/robinandmadeline.com/pkg/subscriptions"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"github.com/uptrace/bun"
)

func ctx() context.Context { return context.Background() }

// newService returns a subscriptions.Service plus the parties service used for
// fixtures, backed by a dedicated Postgres test database. Truncating parties
// cascades to guests. Tests using it must not call t.Parallel(): the package
// shares this one database and relies on truncation for isolation.
func newService(t *testing.T) (*subscriptions.Service, *parties.Service, *bun.DB) {
	t.Helper()
	db := databasetest.NewIsolated(t, "robinandmadeline_subscriptions_test")
	databasetest.Truncate(t, db, "parties")
	return subscriptions.NewService(db), parties.NewService(db), db
}

// newGuest creates a party with one primary guest carrying the given email and
// returns it. A freshly created guest is subscribed by default (ADR 0009).
func newGuest(t *testing.T, partySvc *parties.Service, email string) *models.Guest {
	t.Helper()
	p, err := partySvc.CreateParty(ctx(), parties.CreatePartyPayload{
		Name:           "The Smiths",
		Side:           models.SideRobin,
		Relation:       models.RelationFriend,
		InvitationType: models.InvitationDigital,
	})
	require.NoError(t, err)
	g, err := partySvc.CreateGuest(ctx(), p.ID, parties.CreateGuestPayload{
		FullName:  "Alice Smith",
		Email:     pointerutil.String(email),
		IsPrimary: true,
	})
	require.NoError(t, err)
	return g
}

// guestRow reads one guests row straight from the DB.
func guestRow(t *testing.T, db *bun.DB, id string) *models.Guest {
	t.Helper()
	row := new(models.Guest)
	require.NoError(t, db.NewSelect().Model(row).Where("g.id = ?", id).Scan(ctx()))
	return row
}

// assertNotFound asserts that err resolves to a 404 errcode.
func assertNotFound(t *testing.T, err error) {
	t.Helper()
	require.Error(t, err)
	var e *errcodes.Error
	require.ErrorAs(t, err, &e)
	require.Equal(t, string(errcodes.CodeNotFound), e.Code)
}

func TestSubscription_ReturnsGuestView(t *testing.T) {
	svc, partySvc, _ := newService(t)
	g := newGuest(t, partySvc, "alice@example.com")

	resp, err := svc.Subscription(ctx(), g.ID)
	require.NoError(t, err)
	assert.Equal(t, "Alice Smith", resp.FullName)
	require.NotNil(t, resp.Email)
	assert.Equal(t, "alice@example.com", *resp.Email)
	assert.True(t, resp.Subscribed) // a new guest is subscribed by default
}

func TestSubscription_UnknownAndMalformedID_404(t *testing.T) {
	svc, _, _ := newService(t)

	// A well-formed but unknown UUID: a missing row.
	_, err := svc.Subscription(ctx(), uuid.Must(uuid.NewV7()).String())
	assertNotFound(t, err)

	// A malformed id is a 404 too, not a 500: it never reaches Postgres as a
	// failing text-to-uuid cast.
	_, err = svc.Subscription(ctx(), "not-a-uuid")
	assertNotFound(t, err)
}

func TestSetSubscription_UnsubscribeThenResubscribe(t *testing.T) {
	svc, partySvc, db := newService(t)
	g := newGuest(t, partySvc, "alice@example.com")

	// Unsubscribe: the response and the stored row both flip to false.
	resp, err := svc.SetSubscription(ctx(), g.ID, false)
	require.NoError(t, err)
	assert.False(t, resp.Subscribed)
	assert.False(t, guestRow(t, db, g.ID).Subscribed)

	// Resubscribe flips it back.
	resp, err = svc.SetSubscription(ctx(), g.ID, true)
	require.NoError(t, err)
	assert.True(t, resp.Subscribed)
	assert.True(t, guestRow(t, db, g.ID).Subscribed)
}

func TestSetSubscription_Idempotent(t *testing.T) {
	svc, partySvc, db := newService(t)
	g := newGuest(t, partySvc, "alice@example.com")

	// Setting the value it already holds is a no-op write, not an error.
	resp, err := svc.SetSubscription(ctx(), g.ID, true)
	require.NoError(t, err)
	assert.True(t, resp.Subscribed)
	assert.True(t, guestRow(t, db, g.ID).Subscribed)
}

func TestSetSubscription_UnknownID_404(t *testing.T) {
	svc, _, _ := newService(t)
	_, err := svc.SetSubscription(ctx(), "not-a-uuid", false)
	assertNotFound(t, err)
}
