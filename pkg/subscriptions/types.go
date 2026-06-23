package subscriptions

import "github.com/robinjoseph08/robinandmadeline.com/pkg/models"

// This file is the package's single home for request and response types
// (pkg/CLAUDE.md): handlers never use anonymous structs. Like the info and RSVP
// flows, the guest-facing view does not embed models.Guest; it names only the
// fields the unsubscribe page needs (the name to greet by, the address the mail
// went to, and the current state) and never the admin-only guest fields.

// SubscriptionResponse is the body of GET /api/subscriptions/:id and of a
// successful POST: the guest's full name (the page greets by first name), their
// email (shown so the person knows which address is affected, nil when none is
// on file), and whether they currently receive broadcast email updates.
type SubscriptionResponse struct {
	FullName   string  `json:"full_name"`
	Email      *string `json:"email"`
	Subscribed bool    `json:"subscribed"`
}

// UpdateSubscriptionPayload is the body of POST /api/subscriptions/:id: the
// desired subscription state. It is a pointer with `required` so an empty or
// malformed body is a 422 rather than a silent unsubscribe: false is a
// meaningful choice (unsubscribe), not the absence of one.
type UpdateSubscriptionPayload struct {
	Subscribed *bool `json:"subscribed" validate:"required"`
}

// newSubscriptionResponse projects a loaded guest onto the guest-facing view.
func newSubscriptionResponse(g *models.Guest) *SubscriptionResponse {
	return &SubscriptionResponse{
		FullName:   g.FullName,
		Email:      g.Email,
		Subscribed: g.Subscribed,
	}
}
