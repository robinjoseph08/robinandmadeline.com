package parties_test

import (
	"testing"

	"github.com/robinjoseph08/golib/pointerutil"
	"github.com/robinjoseph08/robinandmadeline.com/pkg/errcodes"
	"github.com/robinjoseph08/robinandmadeline.com/pkg/models"
	"github.com/robinjoseph08/robinandmadeline.com/pkg/parties"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestCreateParty_GeneratesInfoToken(t *testing.T) {
	svc, _ := newService(t)

	p := createPartyT(t, svc, digitalPartyInput())

	assert.NotEmpty(t, p.ID)
	assert.NotEmpty(t, p.InfoToken, "info token should be auto-generated")
	// The token is lowercase alphanumerics only (no symbols, no mixed case), at
	// a length that keeps it unguessable: it is the link's sole authentication.
	assert.Regexp(t, "^[a-z0-9]{30}$", p.InfoToken)
	assert.False(t, p.InfoCollectionRequested)
	assert.False(t, p.InfoCollectionConfirmed)
	// Distinct parties get distinct tokens.
	p2 := createPartyT(t, svc, digitalPartyInput())
	assert.NotEqual(t, p.InfoToken, p2.InfoToken)
}

func TestCreateParty_DuplicateRSVPCodeConflicts(t *testing.T) {
	svc, _ := newService(t)

	in := digitalPartyInput()
	in.RSVPCode = pointerutil.String("KALEL")
	_, err := svc.CreateParty(ctx(), in)
	require.NoError(t, err)

	// A second party with the same RSVP code must conflict.
	in2 := digitalPartyInput()
	in2.RSVPCode = pointerutil.String("KALEL")
	_, err = svc.CreateParty(ctx(), in2)
	assertErrCode(t, err, errcodes.CodeConflict)
}

// TestCreateParty_InsertTimeUniqueViolationMapsByConstraint pins the insert-time
// 23505 mapping with a real driver error. The create paths check uniqueness up
// front, so the index only fires when a concurrent racer slips a duplicate in
// between the check and the insert; that interleaving itself is untested by
// design (it needs two in-flight transactions), but the mapping it relies on is
// driven here with the genuine error a duplicate insert produces: a 409 when
// the named constraint matches, untouched passthrough when it does not.
func TestCreateParty_InsertTimeUniqueViolationMapsByConstraint(t *testing.T) {
	svc, db := newService(t)

	in := digitalPartyInput()
	in.RSVPCode = pointerutil.String("RACER")
	createPartyT(t, svc, in)

	dup := &models.Party{
		ID:             "11111111-1111-1111-1111-111111111111",
		Name:           "Dup",
		Side:           models.SideRobin,
		Relation:       models.RelationFriend,
		InvitationType: models.InvitationDigital,
		InfoToken:      "dup-info-token",
		RSVPCode:       pointerutil.String("RACER"),
	}
	_, err := db.NewInsert().Model(dup).Exec(ctx())
	require.Error(t, err, "the duplicate rsvp_code insert must violate ux_parties_rsvp_code")

	mapped := errcodes.ConflictOnConstraint(err, "ux_parties_rsvp_code", "A party with that RSVP code already exists.")
	assertErrCode(t, mapped, errcodes.CodeConflict)

	var appErr *errcodes.Error
	passedThrough := errcodes.ConflictOnConstraint(err, "ux_parties_info_token", "wrong constraint")
	require.NotErrorAs(t, passedThrough, &appErr, "a violation of a different constraint must pass through unmapped")
}

// rsvpCodePattern is the shape of a generated RSVP code: exactly five letters
// from the unambiguous uppercase alphabet (no vowels, no confusable I or O).
const rsvpCodePattern = `^[BCDFGHJKLMNPQRSTVWXZ]{5}$`

func TestCreateParty_GeneratesRSVPCodeWhenAbsent(t *testing.T) {
	svc, _ := newService(t)

	// No code supplied: the service draws one, so every party is born with a
	// usable RSVP code. (NULL codes now arise only from a PATCH clear; see
	// TestPatchParty_SetsAndClearsRSVPCode.)
	p := createPartyT(t, svc, digitalPartyInput())
	require.NotNil(t, p.RSVPCode, "a code-less create must auto-generate an rsvp_code")
	assert.Regexp(t, rsvpCodePattern, *p.RSVPCode)

	// The generated code is persisted, not just set on the returned struct.
	reloaded, err := svc.GetParty(ctx(), p.ID)
	require.NoError(t, err)
	require.NotNil(t, reloaded.RSVPCode)
	assert.Equal(t, *p.RSVPCode, *reloaded.RSVPCode)

	// A second code-less party draws its own distinct code, satisfying the
	// unique index where two NULLs used to.
	p2 := createPartyT(t, svc, digitalPartyInput())
	require.NotNil(t, p2.RSVPCode)
	assert.NotEqual(t, *p.RSVPCode, *p2.RSVPCode)
}

func TestCreateParty_KeepsProvidedRSVPCode(t *testing.T) {
	svc, _ := newService(t)

	// An explicit code is respected, never replaced by a generated one. (The
	// binder upper-cases it on the way in; that is covered at the handler level
	// by TestCreatePartyHandler_DefaultsInvitationAndUppercasesRSVP.)
	in := digitalPartyInput()
	in.RSVPCode = pointerutil.String("KALEL")
	p := createPartyT(t, svc, in)

	require.NotNil(t, p.RSVPCode)
	assert.Equal(t, "KALEL", *p.RSVPCode)
}

func TestCreateParty_NilCirclePersistsAsEmptyArray(t *testing.T) {
	svc, _ := newService(t)

	// A direct service call with a nil Circle (bypassing the binder's default:"[]")
	// must still persist '{}', not NULL: the model's BeforeAppendModel hook is the
	// code-path-independent backstop for the NOT NULL text[] column. Reload from
	// the DB so the assertion reflects persisted state.
	in := digitalPartyInput()
	in.Circle = nil
	p := createPartyT(t, svc, in)

	reloaded, err := svc.GetParty(ctx(), p.ID)
	require.NoError(t, err)
	assert.NotNil(t, reloaded.Circle, "nil circle should persist as an empty array, not null")
	assert.Empty(t, reloaded.Circle)
}

func TestCreatePartyWithGuest_CreatesPrimaryFirstGuest(t *testing.T) {
	svc, db := newService(t)

	// The public create path is born with its first guest, who is the primary.
	p, err := svc.CreatePartyWithGuest(ctx(), parties.CreatePartyWithGuestPayload{
		Name:           "The Smiths",
		Side:           models.SideRobin,
		Relation:       models.RelationFriend,
		InvitationType: models.InvitationDigital,
		Guest:          parties.FirstGuestPayload{FullName: "Pat Smith"},
	})
	require.NoError(t, err)
	assert.NotEmpty(t, p.InfoToken)
	// The public path auto-generates the omitted RSVP code too.
	require.NotNil(t, p.RSVPCode)
	assert.Regexp(t, rsvpCodePattern, *p.RSVPCode)
	require.Len(t, p.Guests, 1)
	assert.Equal(t, "Pat Smith", p.Guests[0].FullName)
	assert.True(t, p.Guests[0].IsPrimary, "the first guest is the party's primary")
	assert.Equal(t, 1, countPrimaries(t, db, p.ID))

	// Both rows persisted in one transaction.
	reloaded, err := svc.GetParty(ctx(), p.ID)
	require.NoError(t, err)
	require.Len(t, reloaded.Guests, 1)
	assert.True(t, reloaded.Guests[0].IsPrimary)
}

func TestCreatePartyWithGuest_DuplicateRSVPRollsBack(t *testing.T) {
	svc, db := newService(t)

	in := parties.CreatePartyWithGuestPayload{
		Name: "First", Side: models.SideRobin, Relation: models.RelationFriend,
		InvitationType: models.InvitationDigital, RSVPCode: pointerutil.String("KALEL"),
		Guest: parties.FirstGuestPayload{FullName: "A"},
	}
	_, err := svc.CreatePartyWithGuest(ctx(), in)
	require.NoError(t, err)

	// A second party reusing the code conflicts, and the whole transaction rolls
	// back so the failed attempt leaves no orphaned guest behind.
	in2 := in
	in2.Name = "Second"
	in2.Guest = parties.FirstGuestPayload{FullName: "B"}
	_, err = svc.CreatePartyWithGuest(ctx(), in2)
	assertErrCode(t, err, errcodes.CodeConflict)

	n, err := db.NewSelect().Model((*models.Guest)(nil)).Where("full_name = ?", "B").Count(ctx())
	require.NoError(t, err)
	assert.Equal(t, 0, n, "a rolled-back create leaves no guest behind")
}

func TestGetParty_NotFound(t *testing.T) {
	svc, _ := newService(t)

	_, err := svc.GetParty(ctx(), "00000000-0000-0000-0000-000000000000")
	assertErrCode(t, err, errcodes.CodeNotFound)
}

func TestUpdateParty_DoesNotTouchCollectionFlags(t *testing.T) {
	svc, _ := newService(t)

	// Mark a party complete (sets requested+confirmed) then edit a field. The
	// edit must not reset the collection flags (ADR 0005).
	p := createPartyT(t, svc, physicalPartyInput())
	addGuestT(t, svc, p.ID, parties.CreateGuestPayload{FullName: "Pat Jones", Email: pointerutil.String("pat@example.com"), IsPrimary: true})
	line1, city, state, postal, country := fullAddress()
	updatePartyAddress(t, svc, p.ID, line1, city, state, postal, country)

	marked, err := svc.MarkComplete(ctx(), p.ID)
	require.NoError(t, err)
	require.True(t, marked.InfoCollectionRequested)
	require.True(t, marked.InfoCollectionConfirmed)

	// Now edit an unrelated field.
	updated := updatePartyName(t, svc, p.ID, "The Jones Family")
	assert.True(t, updated.InfoCollectionRequested, "edit must not clear requested")
	assert.True(t, updated.InfoCollectionConfirmed, "edit must not clear confirmed")
	assert.Equal(t, "The Jones Family", updated.Name)
}

func TestUpdateParty_DuplicateRSVPCodeConflicts(t *testing.T) {
	svc, _ := newService(t)

	a := digitalPartyInput()
	a.RSVPCode = pointerutil.String("PEPPER")
	createPartyT(t, svc, a)

	b := createPartyT(t, svc, digitalPartyInput())

	// Updating b to reuse a's code must conflict.
	_, err := svc.UpdateParty(ctx(), b.ID, parties.UpdatePartyPayload{
		Name:           b.Name,
		Side:           b.Side,
		Relation:       b.Relation,
		Circle:         b.Circle,
		InvitationType: b.InvitationType,
		RSVPCode:       pointerutil.String("PEPPER"),
	})
	assertErrCode(t, err, errcodes.CodeConflict)
}

func TestUpdateParty_NotFound(t *testing.T) {
	svc, _ := newService(t)

	_, err := svc.UpdateParty(ctx(), "00000000-0000-0000-0000-000000000000", parties.UpdatePartyPayload{
		Name:           "x",
		Side:           models.SideRobin,
		Relation:       models.RelationFriend,
		InvitationType: models.InvitationDigital,
	})
	assertErrCode(t, err, errcodes.CodeNotFound)
}

func TestDeleteParty_CascadesGuests(t *testing.T) {
	svc, _ := newService(t)

	p := createPartyT(t, svc, digitalPartyInput())
	g := addGuestT(t, svc, p.ID, parties.CreateGuestPayload{FullName: "Solo Guest", IsPrimary: true})

	require.NoError(t, svc.DeleteParty(ctx(), p.ID))

	// The party is gone.
	_, err := svc.GetParty(ctx(), p.ID)
	assertErrCode(t, err, errcodes.CodeNotFound)
	// And its guest was removed by the FK cascade.
	_, err = svc.GetGuest(ctx(), g.ID)
	assertErrCode(t, err, errcodes.CodeNotFound)
}

func TestDeleteParty_NotFound(t *testing.T) {
	svc, _ := newService(t)
	err := svc.DeleteParty(ctx(), "00000000-0000-0000-0000-000000000000")
	assertErrCode(t, err, errcodes.CodeNotFound)
}
