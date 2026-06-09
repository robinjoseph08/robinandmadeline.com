package parties_test

import (
	"context"
	"testing"

	"github.com/robinjoseph08/robinandmadeline.com/pkg/errcodes"
	"github.com/robinjoseph08/robinandmadeline.com/pkg/models"
	"github.com/robinjoseph08/robinandmadeline.com/pkg/parties"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"github.com/uptrace/bun"
)

// countPrimaries returns how many guests in a party are flagged primary, read
// straight from the DB so it reflects persisted state, not in-memory values.
func countPrimaries(t *testing.T, db *bun.DB, partyID string) int {
	t.Helper()
	n, err := db.NewSelect().Model((*models.Guest)(nil)).
		Where("party_id = ?", partyID).Where("is_primary = TRUE").Count(context.Background())
	require.NoError(t, err)
	return n
}

func TestCreateGuest_RequiresExistingParty(t *testing.T) {
	svc, _ := newService(t)

	_, err := svc.CreateGuest(ctx(), "00000000-0000-0000-0000-000000000000", parties.CreateGuestPayload{FullName: "Ghost"})
	assertErrCode(t, err, errcodes.CodeNotFound)
}

func TestCreateGuest_NilTagsPersistsAsEmptyArray(t *testing.T) {
	svc, _ := newService(t)
	p := createPartyT(t, svc, digitalPartyInput())

	// A direct service call with nil Tags must persist '{}', not NULL, via the
	// model's BeforeAppendModel hook (the same backstop as Party.Circle).
	g := addGuestT(t, svc, p.ID, parties.CreateGuestPayload{FullName: "No Tags"})

	reloaded, err := svc.GetGuest(ctx(), g.ID)
	require.NoError(t, err)
	assert.NotNil(t, reloaded.Tags, "nil tags should persist as an empty array, not null")
	assert.Empty(t, reloaded.Tags)
}

func TestCreateGuest_SecondPrimaryDemotesFirst(t *testing.T) {
	svc, db := newService(t)
	p := createPartyT(t, svc, digitalPartyInput())

	first := addGuestT(t, svc, p.ID, parties.CreateGuestPayload{FullName: "First", IsPrimary: true})
	second := addGuestT(t, svc, p.ID, parties.CreateGuestPayload{FullName: "Second", IsPrimary: true})

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

	primary := addGuestT(t, svc, p.ID, parties.CreateGuestPayload{FullName: "Primary", IsPrimary: true})
	other := addGuestT(t, svc, p.ID, parties.CreateGuestPayload{FullName: "Other"})

	// Promote the non-primary guest via update.
	_, err := svc.UpdateGuest(ctx(), other.ID, parties.UpdateGuestPayload{FullName: "Other", IsPrimary: true})
	require.NoError(t, err)

	assert.Equal(t, 1, countPrimaries(t, db, p.ID))
	rePrimary, err := svc.GetGuest(ctx(), primary.ID)
	require.NoError(t, err)
	assert.False(t, rePrimary.IsPrimary, "previous primary should have been demoted")
}

func TestUpdateGuest_ReaffirmingSamePrimaryKeepsExactlyOne(t *testing.T) {
	svc, db := newService(t)
	p := createPartyT(t, svc, digitalPartyInput())

	primary := addGuestT(t, svc, p.ID, parties.CreateGuestPayload{FullName: "Primary", IsPrimary: true})

	// Updating the existing primary while keeping it primary must not trip the
	// one-primary-per-party index (the demotion excludes the guest itself).
	_, err := svc.UpdateGuest(ctx(), primary.ID, parties.UpdateGuestPayload{FullName: "Primary Renamed", IsPrimary: true})
	require.NoError(t, err)
	assert.Equal(t, 1, countPrimaries(t, db, p.ID))
}

func TestPrimaryIsScopedPerParty(t *testing.T) {
	svc, db := newService(t)

	// Two parties may each have their own primary; demotion is party-scoped.
	a := createPartyT(t, svc, digitalPartyInput())
	b := createPartyT(t, svc, digitalPartyInput())
	addGuestT(t, svc, a.ID, parties.CreateGuestPayload{FullName: "A Primary", IsPrimary: true})
	addGuestT(t, svc, b.ID, parties.CreateGuestPayload{FullName: "B Primary", IsPrimary: true})

	assert.Equal(t, 1, countPrimaries(t, db, a.ID))
	assert.Equal(t, 1, countPrimaries(t, db, b.ID))
}

func TestDeleteGuest_LastGuestDeletesParty(t *testing.T) {
	svc, _ := newService(t)

	// A party never outlives its last guest: deleting the only guest deletes the
	// party too, so an empty party can never linger.
	p := createPartyT(t, svc, digitalPartyInput())
	only := addGuestT(t, svc, p.ID, parties.CreateGuestPayload{FullName: "Only", IsPrimary: true})

	require.NoError(t, svc.DeleteGuest(ctx(), only.ID))

	_, err := svc.GetParty(ctx(), p.ID)
	assertErrCode(t, err, errcodes.CodeNotFound)
}

func TestDeleteGuest_PrimaryWithOthersPromotesOldest(t *testing.T) {
	svc, db := newService(t)

	// Deleting the primary while other guests remain promotes the oldest remaining
	// one, so the party keeps exactly one primary rather than dropping to zero.
	p := createPartyT(t, svc, digitalPartyInput())
	primary := addGuestT(t, svc, p.ID, parties.CreateGuestPayload{FullName: "Primary", IsPrimary: true})
	older := addGuestT(t, svc, p.ID, parties.CreateGuestPayload{FullName: "Older"})
	addGuestT(t, svc, p.ID, parties.CreateGuestPayload{FullName: "Younger"})

	require.NoError(t, svc.DeleteGuest(ctx(), primary.ID))

	assert.Equal(t, 1, countPrimaries(t, db, p.ID))
	rePromoted, err := svc.GetGuest(ctx(), older.ID)
	require.NoError(t, err)
	assert.True(t, rePromoted.IsPrimary, "the oldest remaining guest should be promoted")
}

func TestDeleteGuest_NotFound(t *testing.T) {
	svc, _ := newService(t)
	err := svc.DeleteGuest(ctx(), "00000000-0000-0000-0000-000000000000")
	assertErrCode(t, err, errcodes.CodeNotFound)
}

func TestUpdateGuest_NotFound(t *testing.T) {
	svc, _ := newService(t)
	_, err := svc.UpdateGuest(ctx(), "00000000-0000-0000-0000-000000000000", parties.UpdateGuestPayload{FullName: "x"})
	assertErrCode(t, err, errcodes.CodeNotFound)
}
