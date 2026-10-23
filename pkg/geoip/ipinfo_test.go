package geoip

import (
	"context"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestLookup_ParsesLocation(t *testing.T) {
	var gotPath, gotToken string
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		gotPath = r.URL.Path
		gotToken = r.URL.Query().Get("token")
		_, _ = w.Write([]byte(`{"ip":"8.8.8.8","city":"Mountain View","region":"California","country":"US","org":"AS15169 Google LLC"}`))
	}))
	defer srv.Close()

	loc, err := NewIPInfoClient(srv.URL, "").Lookup(context.Background(), "8.8.8.8")
	require.NoError(t, err)
	assert.Equal(t, Location{City: "Mountain View", Region: "California", Country: "US", Org: "AS15169 Google LLC"}, loc)
	assert.Equal(t, "/8.8.8.8/json", gotPath)
	assert.Empty(t, gotToken, "anonymous by default")
}

func TestLookup_SendsTokenWhenSet(t *testing.T) {
	var gotToken string
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		gotToken = r.URL.Query().Get("token")
		_, _ = w.Write([]byte(`{}`))
	}))
	defer srv.Close()

	_, err := NewIPInfoClient(srv.URL, "secret").Lookup(context.Background(), "8.8.8.8")
	require.NoError(t, err)
	assert.Equal(t, "secret", gotToken)
}

func TestLookup_ClassifiesFailures(t *testing.T) {
	tests := []struct {
		name       string
		status     int
		retryAfter string
		check      func(t *testing.T, err error)
	}{
		{
			name:       "429 with Retry-After seconds",
			status:     http.StatusTooManyRequests,
			retryAfter: "120",
			check: func(t *testing.T, err error) {
				var rl *RateLimitedError
				require.ErrorAs(t, err, &rl)
				assert.Equal(t, 2*time.Minute, rl.RetryAfter)
			},
		},
		{
			name:   "429 without Retry-After backs off the default",
			status: http.StatusTooManyRequests,
			check: func(t *testing.T, err error) {
				var rl *RateLimitedError
				require.ErrorAs(t, err, &rl)
				assert.Equal(t, defaultRetryAfter, rl.RetryAfter)
			},
		},
		{
			name:   "404 is unresolvable",
			status: http.StatusNotFound,
			check: func(t *testing.T, err error) {
				var ue *UnresolvableError
				require.ErrorAs(t, err, &ue)
			},
		},
		{
			name:   "500 is transient",
			status: http.StatusInternalServerError,
			check: func(t *testing.T, err error) {
				require.Error(t, err)
				var rl *RateLimitedError
				var ue *UnresolvableError
				assert.NotErrorAs(t, err, &rl)
				assert.NotErrorAs(t, err, &ue)
			},
		},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
				if tt.retryAfter != "" {
					w.Header().Set("Retry-After", tt.retryAfter)
				}
				w.WriteHeader(tt.status)
			}))
			defer srv.Close()

			_, err := NewIPInfoClient(srv.URL, "").Lookup(context.Background(), "8.8.8.8")
			tt.check(t, err)
		})
	}
}

func TestLookup_NetworkErrorOmitsTheToken(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(http.ResponseWriter, *http.Request) {}))
	srv.Close() // nothing is listening, so the request fails to connect

	_, err := NewIPInfoClient(srv.URL, "secret-token").Lookup(context.Background(), "8.8.8.8")
	require.Error(t, err)
	assert.Contains(t, err.Error(), "ipinfo request failed")
	assert.NotContains(t, err.Error(), "secret-token")
}

func TestParseRetryAfter(t *testing.T) {
	now := time.Date(2026, 10, 23, 12, 0, 0, 0, time.UTC)
	assert.Equal(t, 30*time.Second, parseRetryAfter("30", now))
	assert.Equal(t, 10*time.Minute, parseRetryAfter(now.Add(10*time.Minute).Format(http.TimeFormat), now))
	assert.Equal(t, defaultRetryAfter, parseRetryAfter("", now))
	assert.Equal(t, defaultRetryAfter, parseRetryAfter("soon", now))
	assert.Equal(t, maxRetryAfter, parseRetryAfter("9999999", now), "a huge value is capped")
}

func TestIsPublic(t *testing.T) {
	assert.True(t, IsPublic("8.8.8.8"))
	assert.True(t, IsPublic("2001:4860:4860::8888"))
	assert.True(t, IsPublic("::ffff:8.8.8.8"))
	assert.False(t, IsPublic("127.0.0.1"))
	assert.False(t, IsPublic("::1"))
	assert.False(t, IsPublic("10.1.2.3"))
	assert.False(t, IsPublic("192.168.1.10"))
	assert.False(t, IsPublic("fd00::1"))
	assert.False(t, IsPublic(""))
	assert.False(t, IsPublic("not-an-ip"))
}
