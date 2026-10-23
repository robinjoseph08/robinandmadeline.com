package games_test

import (
	"context"
	"errors"
	"testing"
	"time"

	"github.com/robinjoseph08/golib/logger"
	"github.com/robinjoseph08/robinandmadeline.com/pkg/games"
	"github.com/robinjoseph08/robinandmadeline.com/pkg/geoip"
	"github.com/robinjoseph08/robinandmadeline.com/pkg/models"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"github.com/uptrace/bun"
)

// fakeGeoClient answers lookups from a fixed table and records every call.
// IPs missing from both tables resolve to an empty location.
type fakeGeoClient struct {
	locations map[string]geoip.Location
	errs      map[string]error
	calls     []string
}

func (c *fakeGeoClient) Lookup(_ context.Context, ip string) (geoip.Location, error) {
	c.calls = append(c.calls, ip)
	if err, ok := c.errs[ip]; ok {
		return geoip.Location{}, err
	}
	return c.locations[ip], nil
}

// fakeClock is a settable clock for the resolver's pause logic.
type fakeClock struct{ now time.Time }

func (c *fakeClock) Now() time.Time { return c.now }

func newResolver(db *bun.DB, client geoip.Client, clock *fakeClock) *games.GeoResolver {
	return games.NewGeoResolver(db, client, games.GeoResolverConfig{
		Pace: -1,
		Now:  clock.Now,
	}, logger.New())
}

func sessionWithIP(t *testing.T, svc *games.Service, ip string) *models.GameSession {
	t.Helper()
	session, err := svc.CreateSession(ctx(), games.CreateGameSessionInput{
		Payload: games.CreateGameSessionPayload{
			PuzzleID:   "wedding-mini-v1",
			Difficulty: models.GameDifficultyEasy,
		},
		IPAddress: ip,
		UserAgent: "games-service-test",
	})
	require.NoError(t, err)
	return session
}

var comcastRaleigh = geoip.Location{City: "Raleigh", Region: "North Carolina", Country: "US", Org: "AS7922 Comcast Cable Communications, LLC"}

func TestGeoResolver_ResolvesEachDistinctIPOnce(t *testing.T) {
	svc, _, db := newServices(t)
	first := sessionWithIP(t, svc, "8.8.8.8")
	second := sessionWithIP(t, svc, "8.8.8.8")
	client := &fakeGeoClient{locations: map[string]geoip.Location{"8.8.8.8": comcastRaleigh}}

	newResolver(db, client, &fakeClock{now: time.Now()}).Activate(ctx())

	assert.Equal(t, []string{"8.8.8.8"}, client.calls, "two sessions on one IP cost one lookup")
	for _, id := range []string{first.ID, second.ID} {
		row := sessionRow(t, db, id)
		assert.Equal(t, "Raleigh", row.IPCity)
		assert.Equal(t, "North Carolina", row.IPRegion)
		assert.Equal(t, "US", row.IPCountry)
		assert.Equal(t, "AS7922 Comcast Cable Communications, LLC", row.IPOrg)
		assert.NotNil(t, row.IPGeoLookedUpAt)
	}

	items, _, err := svc.ListSessions(ctx())
	require.NoError(t, err)
	for _, it := range items {
		assert.False(t, it.IPGeoPending)
		assert.Equal(t, "Raleigh", it.IPCity)
	}
}

func TestGeoResolver_ReusesARecentLookupForTheSameIP(t *testing.T) {
	svc, _, db := newServices(t)
	sessionWithIP(t, svc, "8.8.8.8")
	clock := &fakeClock{now: time.Now()}
	client := &fakeGeoClient{locations: map[string]geoip.Location{"8.8.8.8": comcastRaleigh}}
	resolver := newResolver(db, client, clock)
	resolver.Activate(ctx())
	require.Len(t, client.calls, 1)

	// The same guest solves again a day later.
	clock.now = clock.now.Add(24 * time.Hour)
	later := sessionWithIP(t, svc, "8.8.8.8")
	resolver.Activate(ctx())

	assert.Len(t, client.calls, 1, "the earlier lookup is copied instead of calling ipinfo")
	assert.Equal(t, "Raleigh", sessionRow(t, db, later.ID).IPCity)
}

func TestGeoResolver_SkipsNonPublicIPsWithoutCallingIPInfo(t *testing.T) {
	svc, _, db := newServices(t)
	local := sessionWithIP(t, svc, "127.0.0.1")
	noIP := sessionWithIP(t, svc, "")
	client := &fakeGeoClient{}

	newResolver(db, client, &fakeClock{now: time.Now()}).Activate(ctx())

	assert.Empty(t, client.calls)
	assert.NotNil(t, sessionRow(t, db, local.ID).IPGeoLookedUpAt, "a private IP is marked done with no location")
	assert.Nil(t, sessionRow(t, db, noIP.ID).IPGeoLookedUpAt, "a session with no IP is never considered")

	items, _, err := svc.ListSessions(ctx())
	require.NoError(t, err)
	for _, it := range items {
		assert.False(t, it.IPGeoPending, "neither row is shown as pending")
	}
}

func TestGeoResolver_RateLimitPausesAndLeavesSessionsPending(t *testing.T) {
	svc, _, db := newServices(t)
	session := sessionWithIP(t, svc, "8.8.8.8")
	clock := &fakeClock{now: time.Now()}
	client := &fakeGeoClient{errs: map[string]error{
		"8.8.8.8": &geoip.RateLimitedError{RetryAfter: time.Hour},
	}}
	resolver := newResolver(db, client, clock)

	resolver.Activate(ctx())
	require.Len(t, client.calls, 1)
	assert.Nil(t, sessionRow(t, db, session.ID).IPGeoLookedUpAt, "a rate-limited lookup stays pending")

	items, _, err := svc.ListSessions(ctx())
	require.NoError(t, err)
	require.Len(t, items, 1)
	assert.True(t, items[0].IPGeoPending)

	// Wakes during the pause make no calls.
	clock.now = clock.now.Add(59 * time.Minute)
	resolver.Activate(ctx())
	assert.Len(t, client.calls, 1, "no lookups while paused")

	// Once Retry-After has passed, the pending session is retried.
	clock.now = clock.now.Add(2 * time.Minute)
	delete(client.errs, "8.8.8.8")
	client.locations = map[string]geoip.Location{"8.8.8.8": comcastRaleigh}
	resolver.Activate(ctx())
	assert.Len(t, client.calls, 2)
	assert.Equal(t, "Raleigh", sessionRow(t, db, session.ID).IPCity)
}

func TestGeoResolver_TransientFailureSkipsThatIPAndRetriesLater(t *testing.T) {
	svc, _, db := newServices(t)
	failing := sessionWithIP(t, svc, "1.1.1.1")
	ok := sessionWithIP(t, svc, "8.8.8.8")
	client := &fakeGeoClient{
		locations: map[string]geoip.Location{"8.8.8.8": comcastRaleigh},
		errs:      map[string]error{"1.1.1.1": errors.New("connection reset")},
	}
	resolver := newResolver(db, client, &fakeClock{now: time.Now()})

	resolver.Activate(ctx())
	assert.Nil(t, sessionRow(t, db, failing.ID).IPGeoLookedUpAt, "the failed IP stays pending")
	assert.Equal(t, "Raleigh", sessionRow(t, db, ok.ID).IPCity, "other IPs still resolve")

	delete(client.errs, "1.1.1.1")
	resolver.Activate(ctx())
	assert.NotNil(t, sessionRow(t, db, failing.ID).IPGeoLookedUpAt, "the next wake retries it")
}

func TestGeoResolver_RepeatedFailuresPauseTheActivation(t *testing.T) {
	svc, _, db := newServices(t)
	for _, ip := range []string{"1.1.1.1", "1.0.0.1", "8.8.8.8", "8.8.4.4"} {
		sessionWithIP(t, svc, ip)
	}
	outage := errors.New("ipinfo is down")
	client := &fakeGeoClient{errs: map[string]error{
		"1.1.1.1": outage, "1.0.0.1": outage, "8.8.8.8": outage, "8.8.4.4": outage,
	}}
	clock := &fakeClock{now: time.Now()}
	resolver := newResolver(db, client, clock)

	resolver.Activate(ctx())
	assert.Len(t, client.calls, 3, "stops after three consecutive failures instead of trying every IP")

	resolver.Activate(ctx())
	assert.Len(t, client.calls, 3, "and cools down before trying again")
}

func TestGeoResolver_UnresolvableIPIsNotRetried(t *testing.T) {
	svc, _, db := newServices(t)
	session := sessionWithIP(t, svc, "8.8.8.8")
	client := &fakeGeoClient{errs: map[string]error{"8.8.8.8": &geoip.UnresolvableError{Status: 404}}}
	resolver := newResolver(db, client, &fakeClock{now: time.Now()})

	resolver.Activate(ctx())
	resolver.Activate(ctx())

	assert.Len(t, client.calls, 1)
	row := sessionRow(t, db, session.ID)
	assert.NotNil(t, row.IPGeoLookedUpAt)
	assert.Empty(t, row.IPCity)
}

// recordingGeoWaker counts wakes.
type recordingGeoWaker struct{ calls int }

func (w *recordingGeoWaker) Wake() { w.calls++ }

func TestService_WakesGeoOnCreateAndAdminList(t *testing.T) {
	svc, _, _ := newServices(t)
	waker := &recordingGeoWaker{}
	svc = svc.WithGeoWaker(waker)

	sessionWithIP(t, svc, "8.8.8.8")
	assert.Equal(t, 1, waker.calls, "a new session wakes the resolver")

	_, _, err := svc.ListSessions(ctx())
	require.NoError(t, err)
	assert.Equal(t, 2, waker.calls, "an admin list read wakes it to retry and backfill")
}

func TestGeoResolver_RunActivatesOnWakeAndStopsOnCancel(t *testing.T) {
	svc, _, db := newServices(t)
	session := sessionWithIP(t, svc, "8.8.8.8")
	client := &fakeGeoClient{locations: map[string]geoip.Location{"8.8.8.8": comcastRaleigh}}
	resolver := newResolver(db, client, &fakeClock{now: time.Now()})

	runCtx, cancel := context.WithCancel(ctx())
	go resolver.Run(runCtx)
	resolver.Wake()

	require.Eventually(t, func() bool {
		return sessionRow(t, db, session.ID).IPGeoLookedUpAt != nil
	}, 5*time.Second, 10*time.Millisecond, "a wake runs an activation")

	cancel()
	select {
	case <-resolver.Done():
	case <-time.After(5 * time.Second):
		t.Fatal("Run did not return after cancel")
	}
}
