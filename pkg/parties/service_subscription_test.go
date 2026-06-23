package parties_test

import (
	"testing"

	"github.com/robinjoseph08/golib/pointerutil"
	"github.com/robinjoseph08/robinandmadeline.com/pkg/parties"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestCreateGuest_DefaultsToSubscribed(t *testing.T) {
	svc, _ := newService(t)
	p := createPartyT(t, svc, digitalPartyInput())
	// The grid quick-add omits `subscribed` (a nil pointer); a new guest must
	// default to subscribed (ADR 0009), not the Go bool zero value false.
	g := addGuestT(t, svc, p.ID, parties.CreateGuestPayload{
		FullName: "Alice", IsPrimary: true, Email: pointerutil.String("alice@example.com"),
	})
	assert.True(t, g.Subscribed)

	got, err := svc.GetGuest(ctx(), g.ID)
	require.NoError(t, err)
	assert.True(t, got.Subscribed)
}

func TestCreateGuest_HonorsExplicitUnsubscribe(t *testing.T) {
	svc, _ := newService(t)
	p := createPartyT(t, svc, digitalPartyInput())
	g := addGuestT(t, svc, p.ID, parties.CreateGuestPayload{
		FullName:   "Alice",
		IsPrimary:  true,
		Email:      pointerutil.String("alice@example.com"),
		Subscribed: pointerutil.Bool(false),
	})
	assert.False(t, g.Subscribed)

	got, err := svc.GetGuest(ctx(), g.ID)
	require.NoError(t, err)
	assert.False(t, got.Subscribed)
}

func TestUpdateGuest_PersistsSubscription(t *testing.T) {
	svc, _ := newService(t)
	p := createPartyT(t, svc, digitalPartyInput())
	g := addGuestT(t, svc, p.ID, parties.CreateGuestPayload{
		FullName: "Alice", IsPrimary: true, Email: pointerutil.String("alice@example.com"),
	})
	require.True(t, g.Subscribed)

	// A full-state edit can unsubscribe while keeping the (required) email on
	// file: subscription is independent of email presence (ADR 0009).
	updated, err := svc.UpdateGuest(ctx(), g.ID, parties.UpdateGuestPayload{
		FullName:   "Alice",
		IsPrimary:  true,
		Email:      pointerutil.String("alice@example.com"),
		Subscribed: false,
	})
	require.NoError(t, err)
	assert.False(t, updated.Subscribed)

	got, err := svc.GetGuest(ctx(), g.ID)
	require.NoError(t, err)
	assert.False(t, got.Subscribed)
}
