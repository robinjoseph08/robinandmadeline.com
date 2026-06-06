package parties_test

import (
	"context"
	"testing"

	"github.com/robinjoseph08/robinandmadeline.com/pkg/parties"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"github.com/uptrace/bun"
)

// countPrimaries returns how many guests in a party are flagged primary, read
// straight from the DB so it reflects persisted state, not in-memory values.
func countPrimaries(t *testing.T, db *bun.DB, partyID string) int {
	t.Helper()
	n, err := db.NewSelect().Model((*parties.Guest)(nil)).
		Where("party_id = ?", partyID).Where("is_primary = TRUE").Count(context.Background())
	require.NoError(t, err)
	return n
}

func TestCreateGuest_RequiresExistingParty(t *testing.T) {
	svc, _ := newService(t)

	_, err := svc.CreateGuest(ctx(), "00000000-0000-0000-0000-000000000000", parties.CreateGuestInput{FullName: "Ghost"})
	assert.ErrorIs(t, err, parties.ErrNotFound)
}

func TestCreateGuest_RejectsEmptyName(t *testing.T) {
	svc, _ := newService(t)
	p := createPartyT(t, svc, digitalPartyInput())

	_, err := svc.CreateGuest(ctx(), p.ID, parties.CreateGuestInput{FullName: "  "})
	assert.ErrorIs(t, err, parties.ErrValidation)
}

func TestCreateGuest_SecondPrimaryDemotesFirst(t *testing.T) {
	svc, db := newService(t)
	p := createPartyT(t, svc, digitalPartyInput())

	first := addGuestT(t, svc, p.ID, parties.CreateGuestInput{FullName: "First", IsPrimary: true})
	second := addGuestT(t, svc, p.ID, parties.CreateGuestInput{FullName: "Second", IsPrimary: true})

	// Exactly one primary remains, and it is the second guest.
	assert.Equal(t, 1, countPrimaries(t, db, p.ID))

	reFirst, err := svc.GetGuest(ctx(), first.ID)
	require.NoError(t, err)
	assert.False(t, reFirst.IsPrimary, "first guest should have been demoted")

	reSecond, err := svc.GetGuest(ctx(), second.ID)
	require.NoError(t, err)
	assert.True(t, reSecond.IsPrimary)
}

func TestUpdateGuest_PromotingDemotesPreviousPrimary(t *testing.T) {
	svc, db := newService(t)
	p := createPartyT(t, svc, digitalPartyInput())

	primary := addGuestT(t, svc, p.ID, parties.CreateGuestInput{FullName: "Primary", IsPrimary: true})
	other := addGuestT(t, svc, p.ID, parties.CreateGuestInput{FullName: "Other"})

	// Promote the non-primary guest via update.
	_, err := svc.UpdateGuest(ctx(), other.ID, parties.UpdateGuestInput{FullName: "Other", IsPrimary: true})
	require.NoError(t, err)

	assert.Equal(t, 1, countPrimaries(t, db, p.ID))
	rePrimary, err := svc.GetGuest(ctx(), primary.ID)
	require.NoError(t, err)
	assert.False(t, rePrimary.IsPrimary, "previous primary should have been demoted")
}

func TestUpdateGuest_ReaffirmingSamePrimaryKeepsExactlyOne(t *testing.T) {
	svc, db := newService(t)
	p := createPartyT(t, svc, digitalPartyInput())

	primary := addGuestT(t, svc, p.ID, parties.CreateGuestInput{FullName: "Primary", IsPrimary: true})

	// Updating the existing primary while keeping it primary must not trip the
	// one-primary-per-party index (the demotion excludes the guest itself).
	_, err := svc.UpdateGuest(ctx(), primary.ID, parties.UpdateGuestInput{FullName: "Primary Renamed", IsPrimary: true})
	require.NoError(t, err)
	assert.Equal(t, 1, countPrimaries(t, db, p.ID))
}

func TestPrimaryIsScopedPerParty(t *testing.T) {
	svc, db := newService(t)

	// Two parties may each have their own primary; demotion is party-scoped.
	a := createPartyT(t, svc, digitalPartyInput())
	b := createPartyT(t, svc, digitalPartyInput())
	addGuestT(t, svc, a.ID, parties.CreateGuestInput{FullName: "A Primary", IsPrimary: true})
	addGuestT(t, svc, b.ID, parties.CreateGuestInput{FullName: "B Primary", IsPrimary: true})

	assert.Equal(t, 1, countPrimaries(t, db, a.ID))
	assert.Equal(t, 1, countPrimaries(t, db, b.ID))
}

func TestDeletePrimaryGuest_LeavesPartyIncomplete(t *testing.T) {
	svc, db := newService(t)

	// A complete digital party loses its only primary: status falls back to
	// incomplete (no primary email) via derivation, and no primary remains.
	p := createPartyT(t, svc, digitalPartyInput())
	primary := addGuestT(t, svc, p.ID, parties.CreateGuestInput{FullName: "Primary", Email: ptr("p@example.com"), IsPrimary: true})

	require.NoError(t, svc.DeleteGuest(ctx(), primary.ID))
	assert.Equal(t, 0, countPrimaries(t, db, p.ID))

	reloaded, err := svc.GetParty(ctx(), p.ID)
	require.NoError(t, err)
	assert.Equal(t, parties.StatusIncomplete, parties.StatusOf(reloaded))
}

func TestDeleteGuest_NotFound(t *testing.T) {
	svc, _ := newService(t)
	err := svc.DeleteGuest(ctx(), "00000000-0000-0000-0000-000000000000")
	assert.ErrorIs(t, err, parties.ErrNotFound)
}

func TestUpdateGuest_NotFound(t *testing.T) {
	svc, _ := newService(t)
	_, err := svc.UpdateGuest(ctx(), "00000000-0000-0000-0000-000000000000", parties.UpdateGuestInput{FullName: "x"})
	assert.ErrorIs(t, err, parties.ErrNotFound)
}
