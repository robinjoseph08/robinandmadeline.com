package parties

import (
	"github.com/google/uuid"
	"github.com/labstack/echo/v4"
	"github.com/robinjoseph08/robinandmadeline.com/pkg/errcodes"
)

// handler holds the dependencies for the parties/guests HTTP handlers. It is
// unexported; routes are wired via RegisterRoutes. Handlers return errcodes
// errors directly (and the *Error the service produces flows through), which the
// shared error handler renders. There is no per-package error translation.
type handler struct {
	service *Service
}

// pathID returns the :id route param when it parses as a UUID, or a 404 naming
// the given resource otherwise. Ids are UUIDs, so a malformed one can never
// name an existing row; without this check it would reach Postgres as a failing
// text-to-uuid cast and render a 500 instead of the 404 a missing row gets. The
// id is returned in canonical form so the query sees exactly what was parsed.
func pathID(c echo.Context, resource string) (string, error) {
	id, err := uuid.Parse(c.Param("id"))
	if err != nil {
		return "", errcodes.NotFound(resource)
	}
	return id.String(), nil
}
