package parties_test

import (
	"context"
	"testing"

	"github.com/robinjoseph08/robinandmadeline.com/internal/databasetest"
	"github.com/robinjoseph08/robinandmadeline.com/pkg/errcodes"
	"github.com/robinjoseph08/robinandmadeline.com/pkg/models"
	"github.com/robinjoseph08/robinandmadeline.com/pkg/parties"
	"github.com/stretchr/testify/require"
	"github.com/uptrace/bun"
)

// newService returns a parties.Service backed by the shared Postgres test
// database, truncating parties (and via cascade, guests) before the test runs so
// each test starts clean. Tests using it must not call t.Parallel() because they
// share one database and rely on truncation for isolation.
func newService(t *testing.T) (*parties.Service, *bun.DB) {
	t.Helper()
	db := databasetest.New(t)
	databasetest.Truncate(t, db, "parties")
	return parties.NewService(db), db
}

// ctx returns a background context for service calls in tests.
func ctx() context.Context { return context.Background() }

// ptr is a tiny helper for taking the address of a literal (e.g. ptr("x")).
func ptr[T any](v T) *T { return &v }

// assertErrCode asserts that err resolves to an *errcodes.Error with the given
// code, the replacement for the old sentinel ErrorIs checks.
func assertErrCode(t *testing.T, err error, code errcodes.Code) {
	t.Helper()
	require.Error(t, err)
	var e *errcodes.Error
	require.ErrorAs(t, err, &e)
	require.Equal(t, string(code), e.Code)
}

// createPartyT creates a party via the service and fails the test on error.
func createPartyT(t *testing.T, svc *parties.Service, in parties.CreatePartyPayload) *models.Party {
	t.Helper()
	p, err := svc.CreateParty(ctx(), in)
	require.NoError(t, err)
	return p
}

// digitalPartyInput is a minimal valid input for a digital party (no address
// required). Callers override fields as needed.
func digitalPartyInput() parties.CreatePartyPayload {
	return parties.CreatePartyPayload{
		Name:           "The Smiths",
		Side:           models.SideRobin,
		Relation:       models.RelationFriend,
		Circle:         []string{"College"},
		InvitationType: models.InvitationDigital,
	}
}

// physicalPartyInput is a minimal valid input for a physical party. Its address
// is intentionally absent so completion tests can add it explicitly.
func physicalPartyInput() parties.CreatePartyPayload {
	return parties.CreatePartyPayload{
		Name:           "The Joneses",
		Side:           models.SideMadeline,
		Relation:       models.RelationFamily,
		Circle:         []string{"Immediate"},
		InvitationType: models.InvitationPhysical,
	}
}

// fullAddress returns the five required address fields populated, for building a
// complete physical party.
func fullAddress() (line1, city, state, postal, country *string) {
	return ptr("123 Main St"), ptr("Springfield"), ptr("IL"), ptr("62704"), ptr("USA")
}

// addGuestT adds a guest to a party via the service and fails on error.
func addGuestT(t *testing.T, svc *parties.Service, partyID string, in parties.CreateGuestPayload) *models.Guest {
	t.Helper()
	g, err := svc.CreateGuest(ctx(), partyID, in)
	require.NoError(t, err)
	return g
}

// updatePartyName updates only the party's name (preserving the other required
// fields by reloading first) and returns the updated party.
func updatePartyName(t *testing.T, svc *parties.Service, partyID, name string) *models.Party {
	t.Helper()
	p, err := svc.GetParty(ctx(), partyID)
	require.NoError(t, err)
	updated, err := svc.UpdateParty(ctx(), partyID, parties.UpdatePartyPayload{
		Name:            name,
		Side:            p.Side,
		Relation:        p.Relation,
		Circle:          p.Circle,
		InvitationType:  p.InvitationType,
		AddressLine1:    p.AddressLine1,
		AddressLine2:    p.AddressLine2,
		City:            p.City,
		StateOrProvince: p.StateOrProvince,
		PostalCode:      p.PostalCode,
		Country:         p.Country,
		RSVPCode:        p.RSVPCode,
	})
	require.NoError(t, err)
	return updated
}

// updatePartyAddress sets the party's mailing address (preserving its other
// fields) and returns the updated party. Used to make a physical party complete.
func updatePartyAddress(t *testing.T, svc *parties.Service, partyID string, line1, city, state, postal, country *string) *models.Party {
	t.Helper()
	p, err := svc.GetParty(ctx(), partyID)
	require.NoError(t, err)
	updated, err := svc.UpdateParty(ctx(), partyID, parties.UpdatePartyPayload{
		Name:            p.Name,
		Side:            p.Side,
		Relation:        p.Relation,
		Circle:          p.Circle,
		InvitationType:  p.InvitationType,
		AddressLine1:    line1,
		City:            city,
		StateOrProvince: state,
		PostalCode:      postal,
		Country:         country,
		RSVPCode:        p.RSVPCode,
	})
	require.NoError(t, err)
	return updated
}
