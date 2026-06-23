package subscriptions_test

import (
	"context"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/google/uuid"
	"github.com/labstack/echo/v4"
	"github.com/robinjoseph08/robinandmadeline.com/pkg/subscriptions"
	"github.com/stretchr/testify/assert"
)

// The one-click endpoint is what the RFC 8058 List-Unsubscribe header points at.
// A mail client POSTs to it (body List-Unsubscribe=One-Click) when the reader
// uses the client's native Unsubscribe control.
func TestOneClickUnsubscribe_UnsubscribesAndReturns200(t *testing.T) {
	svc, partySvc, db := newService(t)
	g := newGuest(t, partySvc)

	e := echo.New()
	subscriptions.RegisterOneClickRoute(e, svc)

	req := httptest.NewRequestWithContext(
		context.Background(), http.MethodPost, "/u/"+g.ID,
		strings.NewReader("List-Unsubscribe=One-Click"),
	)
	req.Header.Set(echo.HeaderContentType, echo.MIMEApplicationForm)
	rec := httptest.NewRecorder()
	e.ServeHTTP(rec, req)

	assert.Equal(t, http.StatusOK, rec.Code)
	assert.False(t, guestRow(t, db, g.ID).Subscribed)
}

func TestOneClickUnsubscribe_StaleGuestStillReturns200(t *testing.T) {
	svc, _, _ := newService(t)

	e := echo.New()
	subscriptions.RegisterOneClickRoute(e, svc)

	// A well-formed but unknown id (a since-deleted guest): still 200, so the
	// provider's one-click flow does not record a failure.
	req := httptest.NewRequestWithContext(context.Background(), http.MethodPost, "/u/"+uuid.Must(uuid.NewV7()).String(), nil)
	rec := httptest.NewRecorder()
	e.ServeHTTP(rec, req)

	assert.Equal(t, http.StatusOK, rec.Code)
}
