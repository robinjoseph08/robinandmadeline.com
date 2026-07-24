package server

import (
	"context"
	stderrors "errors"
	"strings"

	"github.com/labstack/echo/v4"
	"github.com/pkg/errors"
	"github.com/robinjoseph08/robinandmadeline.com/pkg/database"
	"github.com/robinjoseph08/robinandmadeline.com/pkg/errcodes"
)

// databaseBudgetMiddleware gives every matched API request one aggregate
// database-work deadline. It is installed before route authentication and the
// request context flows through every Bun query and transaction, so the whole
// request shares one five-second budget rather than receiving a fresh timeout
// per operation.
func databaseBudgetMiddleware(next echo.HandlerFunc) echo.HandlerFunc {
	return func(c echo.Context) error {
		if !isMatchedAPIRequest(c) {
			return next(c)
		}

		ctx, cancel := database.WithHTTPWorkBudget(c.Request().Context())
		defer cancel()
		c.SetRequest(c.Request().WithContext(ctx))

		err := next(c)
		if err == nil || stderrors.Is(err, context.Canceled) {
			return err
		}

		// A parent deadline is not this database budget. Preserve its existing
		// behavior instead of calling it a database outage, even if cancellation
		// reached the handler through an in-progress connection attempt.
		requestBudgetExpired := database.HTTPWorkBudgetExceeded(ctx)
		if stderrors.Is(err, context.DeadlineExceeded) && !requestBudgetExpired {
			return err
		}
		budgetExpired := requestBudgetExpired && stderrors.Is(err, context.DeadlineExceeded)
		if !budgetExpired && !database.IsConnectionFailure(err) {
			return err
		}

		// Keep the infrastructure detail in the logged wrapper while exposing
		// only the fixed ServiceUnavailable message. Do not retain err in the
		// unwrap chain: network timeout errors are otherwise classified as
		// ignorable client disconnects by the shared handler before it can render
		// the 503.
		return errors.Wrap(errcodes.ServiceUnavailable(), "database unavailable: "+err.Error())
	}
}

// isMatchedAPIRequest distinguishes registered APIs from Echo's unmatched
// route and the static middleware. Nearly all APIs live under /api; the RFC
// 8058 one-click unsubscribe POST intentionally lives at /u/:id.
func isMatchedAPIRequest(c echo.Context) bool {
	path := c.Path()
	return strings.HasPrefix(path, "/api/") || path == "/u/:id"
}
