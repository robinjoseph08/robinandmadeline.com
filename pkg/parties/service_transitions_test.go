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

// completePhysicalParty builds a physical party that satisfies all required
// fields (primary email + full address), the precondition for marking complete.
func completePhysicalParty(t *testing.T, svc *parties.Service) *models.Party {
	t.Helper()
	p := createPartyT(t, svc, physicalPartyInput())
	addGuestT(t, svc, p.ID, parties.CreateGuestPayload{FullName: "Pat Jones", Email: pointerutil.String("pat@example.com"), IsPrimary: true})
	line1, city, state, postal, country := fullAddress()
	return updatePartyAddress(t, svc, p.ID, line1, city, state, postal, country)
}

func TestMarkComplete_Rejected422WhenRequiredFieldsMissing(t *testing.T) {
	svc, _ := newService(t)

	// Physical party with a primary email but NO address: not markable.
	p := createPartyT(t, svc, physicalPartyInput())
	addGuestT(t, svc, p.ID, parties.CreateGuestPayload{FullName: "Pat Jones", Email: pointerutil.String("pat@example.com"), IsPrimary: true})

	_, err := svc.MarkComplete(ctx(), p.ID)
	assertErrCode(t, err, errcodes.CodeValidationError)
}

func TestMarkComplete_RejectedWhenPrimaryEmailMissing(t *testing.T) {
	svc, _ := newService(t)

	// Digital party (no address needed) but the primary has no email.
	p := createPartyT(t, svc, digitalPartyInput())
	addGuestT(t, svc, p.ID, parties.CreateGuestPayload{FullName: "No Email", IsPrimary: true})

	_, err := svc.MarkComplete(ctx(), p.ID)
	assertErrCode(t, err, errcodes.CodeValidationError)
}

func TestMarkComplete_SetsRequestedAndConfirmed(t *testing.T) {
	svc, _ := newService(t)

	p := completePhysicalParty(t, svc)
	marked, err := svc.MarkComplete(ctx(), p.ID)
	require.NoError(t, err)

	assert.True(t, marked.InfoCollectionRequested)
	assert.True(t, marked.InfoCollectionConfirmed)
	assert.Equal(t, models.StatusComplete, marked.InfoCollectionStatus())
}

func TestRequestInfo_SetsRequestedAndResetsConfirmed(t *testing.T) {
	svc, _ := newService(t)

	// Start from a complete (confirmed) party, then send the info link: that
	// must reset it to waiting (requested=true, confirmed=false, incomplete).
	p := completePhysicalParty(t, svc)
	_, err := svc.MarkComplete(ctx(), p.ID)
	require.NoError(t, err)

	reopened, err := svc.RequestInfo(ctx(), p.ID)
	require.NoError(t, err)
	assert.True(t, reopened.InfoCollectionRequested)
	assert.False(t, reopened.InfoCollectionConfirmed)
	assert.Equal(t, models.StatusIncomplete, reopened.InfoCollectionStatus(),
		"a requested-but-unconfirmed party is incomplete even with all fields present")
}

func TestMarkIncomplete_ReopensParty(t *testing.T) {
	svc, _ := newService(t)

	p := completePhysicalParty(t, svc)
	_, err := svc.MarkComplete(ctx(), p.ID)
	require.NoError(t, err)

	reopened, err := svc.MarkIncomplete(ctx(), p.ID)
	require.NoError(t, err)
	assert.True(t, reopened.InfoCollectionRequested)
	assert.False(t, reopened.InfoCollectionConfirmed)
	assert.Equal(t, models.StatusIncomplete, reopened.InfoCollectionStatus())
}

func TestStatus_DerivedBeforeRequested(t *testing.T) {
	svc, _ := newService(t)

	// A never-requested digital party with a primary email reads complete by
	// derivation alone, without any mark action.
	p := createPartyT(t, svc, digitalPartyInput())
	addGuestT(t, svc, p.ID, parties.CreateGuestPayload{FullName: "Has Email", Email: pointerutil.String("has@example.com"), IsPrimary: true})

	reloaded, err := svc.GetParty(ctx(), p.ID)
	require.NoError(t, err)
	assert.False(t, reloaded.InfoCollectionRequested)
	assert.Equal(t, models.StatusComplete, reloaded.InfoCollectionStatus())
}

func TestTransition_NotFound(t *testing.T) {
	svc, _ := newService(t)
	const missing = "00000000-0000-0000-0000-000000000000"

	_, err := svc.RequestInfo(ctx(), missing)
	assertErrCode(t, err, errcodes.CodeNotFound)
	_, err = svc.MarkComplete(ctx(), missing)
	assertErrCode(t, err, errcodes.CodeNotFound)
	_, err = svc.MarkIncomplete(ctx(), missing)
	assertErrCode(t, err, errcodes.CodeNotFound)
}
