package parties

import (
	"errors"
	"net/http"

	"github.com/labstack/echo/v4"
)

// handler holds the dependencies for the parties/guests HTTP handlers. It is
// unexported; routes are wired via RegisterRoutes.
type handler struct {
	service *Service
}

// partyResponse is the API representation of a party. It embeds the stored
// model and adds the derived info_collection_status, computed via the same pure
// rules used everywhere else so the API and the status filter agree.
//
// The embedded *Party already carries snake_case JSON tags; InfoCollectionStatus
// is appended as an extra computed field.
type partyResponse struct {
	*Party
	InfoCollectionStatus string `json:"info_collection_status"`
}

// newPartyResponse wraps a loaded party (with guests) for the API, computing its
// status. Guests must be loaded for the status to be accurate.
func newPartyResponse(p *Party) partyResponse {
	return partyResponse{Party: p, InfoCollectionStatus: StatusOf(p)}
}

// newPartyResponses maps a slice of parties to their API representation.
func newPartyResponses(parties []*Party) []partyResponse {
	out := make([]partyResponse, 0, len(parties))
	for _, p := range parties {
		out = append(out, newPartyResponse(p))
	}
	return out
}

// httpError maps a service sentinel error to the matching echo.HTTPError. This
// is the single translation point from domain errors to HTTP statuses:
//
//	ErrValidation     -> 400
//	ErrNotFound       -> 404
//	ErrConflict       -> 409
//	ErrRequiredFields -> 422
//
// Anything else is returned as-is (Echo renders it as a 500), preserving the
// original error for logging.
func httpError(err error) error {
	switch {
	case errors.Is(err, ErrValidation):
		return echo.NewHTTPError(http.StatusBadRequest, err.Error())
	case errors.Is(err, ErrNotFound):
		return echo.NewHTTPError(http.StatusNotFound, "not found")
	case errors.Is(err, ErrConflict):
		return echo.NewHTTPError(http.StatusConflict, "a party with that info token or RSVP code already exists")
	case errors.Is(err, ErrRequiredFields):
		return echo.NewHTTPError(http.StatusUnprocessableEntity, "required fields are missing; cannot mark complete")
	default:
		return err
	}
}
