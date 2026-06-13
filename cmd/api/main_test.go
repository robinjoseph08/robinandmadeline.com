package main

import (
	"context"
	"net"
	"os"
	"path/filepath"
	"strconv"
	"testing"

	"github.com/robinjoseph08/robinandmadeline.com/pkg/config"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

// occupy binds an ephemeral TCP port, keeps it held until the test ends, and
// returns it, so a test can assert how listen reacts to a busy port.
func occupy(t *testing.T) int {
	t.Helper()
	l, err := (&net.ListenConfig{}).Listen(context.Background(), "tcp", ":0")
	require.NoError(t, err)
	t.Cleanup(func() { _ = l.Close() })
	return l.Addr().(*net.TCPAddr).Port
}

// freePort returns a port free at call time (a later bind may still race, which
// is fine for these tests).
func freePort(t *testing.T) int {
	t.Helper()
	l, err := (&net.ListenConfig{}).Listen(context.Background(), "tcp", ":0")
	require.NoError(t, err)
	port := l.Addr().(*net.TCPAddr).Port
	require.NoError(t, l.Close())
	return port
}

func portOf(t *testing.T, l net.Listener) int {
	t.Helper()
	return l.Addr().(*net.TCPAddr).Port
}

func TestListen(t *testing.T) {
	ctx := context.Background()

	t.Run("PORT set: binds it strictly and errors when taken", func(t *testing.T) {
		port := occupy(t)
		t.Setenv("PORT", strconv.Itoa(port))
		_, err := listen(ctx, &config.Config{ServerPort: port})
		assert.Error(t, err)
	})

	t.Run("PORT unset: binds the preferred port when free", func(t *testing.T) {
		t.Setenv("PORT", "")
		// API_PORT_FILE points at a missing file so there is no cached port and
		// the preferred port is cfg.ServerPort.
		t.Setenv("API_PORT_FILE", filepath.Join(t.TempDir(), "api.port"))
		port := freePort(t)
		l, err := listen(ctx, &config.Config{ServerPort: port})
		require.NoError(t, err)
		defer func() { _ = l.Close() }()
		assert.Equal(t, port, portOf(t, l))
	})

	t.Run("PORT unset: falls back to a free port when the preferred is taken", func(t *testing.T) {
		t.Setenv("PORT", "")
		t.Setenv("API_PORT_FILE", filepath.Join(t.TempDir(), "api.port"))
		port := occupy(t)
		l, err := listen(ctx, &config.Config{ServerPort: port})
		require.NoError(t, err)
		defer func() { _ = l.Close() }()
		assert.NotEqual(t, port, portOf(t, l))
		assert.Positive(t, portOf(t, l))
	})
}

func TestCachedPort(t *testing.T) {
	t.Run("missing file is not a cached port", func(t *testing.T) {
		t.Setenv("API_PORT_FILE", filepath.Join(t.TempDir(), "absent.port"))
		_, ok := cachedPort()
		assert.False(t, ok)
	})

	cases := []struct {
		name    string
		content string
		want    int
		wantOK  bool
	}{
		{"valid port", "8400", 8400, true},
		{"trailing whitespace is trimmed", "8400\n", 8400, true},
		{"zero is rejected", "0", 0, false},
		{"negative is rejected", "-1", 0, false},
		{"non-numeric is rejected", "abc", 0, false},
		{"empty is rejected", "", 0, false},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			path := filepath.Join(t.TempDir(), "api.port")
			require.NoError(t, os.WriteFile(path, []byte(tc.content), 0o600))
			t.Setenv("API_PORT_FILE", path)
			got, ok := cachedPort()
			assert.Equal(t, tc.wantOK, ok)
			if tc.wantOK {
				assert.Equal(t, tc.want, got)
			}
		})
	}
}
