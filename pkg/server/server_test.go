package server_test

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/robinjoseph08/robinandmadeline.com/pkg/config"
	"github.com/robinjoseph08/robinandmadeline.com/pkg/server"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestHealthEndpoint(t *testing.T) {
	tests := []struct {
		name          string
		wantStatus    int
		wantStatusVal string
		wantDatabase  string
	}{
		{
			name:          "returns 200 with ok status when db is nil",
			wantStatus:    http.StatusOK,
			wantStatusVal: "ok",
			wantDatabase:  "unknown",
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			// db is nil: the health endpoint must still be reachable and 200.
			srv := server.New(&config.Config{ServerPort: 0}, nil)

			req := httptest.NewRequestWithContext(context.Background(), http.MethodGet, "/api/health", http.NoBody)
			rec := httptest.NewRecorder()
			srv.Handler.ServeHTTP(rec, req)

			assert.Equal(t, tt.wantStatus, rec.Code)
			assert.Equal(t, "application/json", rec.Header().Get("Content-Type"))

			var body struct {
				Status   string `json:"status"`
				Database string `json:"database"`
			}
			require.NoError(t, json.Unmarshal(rec.Body.Bytes(), &body))
			assert.Equal(t, tt.wantStatusVal, body.Status)
			assert.Equal(t, tt.wantDatabase, body.Database)
		})
	}
}
