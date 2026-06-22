package info_test

import (
	"testing"

	"github.com/robinjoseph08/golib/pointerutil"
	"github.com/robinjoseph08/robinandmadeline.com/pkg/info"
	"github.com/robinjoseph08/robinandmadeline.com/pkg/models"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestUpdatePartyInfo_PersistsSubscription(t *testing.T) {
	svc, partySvc, _, db := newServices(t)
	p := createPartyT(t, partySvc, "The Smiths", models.InvitationDigital)
	alice := addPrimaryT(t, partySvc, p.ID, "Alice Smith")

	// Unsubscribe via the info form while keeping the primary's required email:
	// subscription is independent of email presence (ADR 0009), so this is a
	// valid, complete submit, not a 422.
	resp, err := svc.UpdatePartyInfo(ctx(), p.InfoToken, info.UpdatePartyInfoPayload{
		Guests: []info.GuestInfoUpdate{{
			GuestID:    alice.ID,
			FullName:   pointerutil.String("Alice Smith"),
			Email:      pointerutil.String("alice@example.com"),
			Subscribed: pointerutil.Bool(false),
		}},
	})
	require.NoError(t, err)
	require.Len(t, resp.Guests, 1)
	assert.False(t, resp.Guests[0].Subscribed)

	row := guestRow(t, db, alice.ID)
	assert.False(t, row.Subscribed)
	require.NotNil(t, row.Email) // the required email stays on file
	assert.Equal(t, "alice@example.com", *row.Email)
}

func TestUpdatePartyInfo_OmittedSubscriptionIsUntouched(t *testing.T) {
	svc, partySvc, _, db := newServices(t)
	p := createPartyT(t, partySvc, "The Smiths", models.InvitationDigital)
	alice := addPrimaryT(t, partySvc, p.ID, "Alice Smith")

	// First unsubscribe.
	_, err := svc.UpdatePartyInfo(ctx(), p.InfoToken, info.UpdatePartyInfoPayload{
		Guests: []info.GuestInfoUpdate{{
			GuestID:    alice.ID,
			Email:      pointerutil.String("alice@example.com"),
			Subscribed: pointerutil.Bool(false),
		}},
	})
	require.NoError(t, err)

	// A submit that omits `subscribed` (nil pointer) must leave the stored state
	// untouched, not silently resubscribe.
	_, err = svc.UpdatePartyInfo(ctx(), p.InfoToken, info.UpdatePartyInfoPayload{
		Guests: []info.GuestInfoUpdate{{
			GuestID: alice.ID,
			Email:   pointerutil.String("alice@example.com"),
		}},
	})
	require.NoError(t, err)
	assert.False(t, guestRow(t, db, alice.ID).Subscribed)
}
