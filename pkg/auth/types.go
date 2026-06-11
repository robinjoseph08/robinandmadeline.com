package auth

// API request and response types for the auth endpoints. Every type here is a
// named, exported struct so tygo can generate the TypeScript the frontend
// imports (ADR 0008).

// AdminLoginPayload is the body of POST /api/auth/admin/login. The custom
// binder validates both fields as required from these tags.
type AdminLoginPayload struct {
	Username string `json:"username" validate:"required"`
	Password string `json:"password" validate:"required"`
}

// GuestLoginPayload is the body of POST /api/auth/guest/login: the party's
// RSVP code from the printed invitation. Codes are stored uppercase, so the
// binder trims and uppercases the input (guests type freely) before the
// lookup; required rejects a blank code.
type GuestLoginPayload struct {
	Code string `json:"code" mod:"trim,ucase" validate:"required,max=64"`
}

// LoginResponse is returned with a freshly minted JWT on successful login.
type LoginResponse struct {
	Token string `json:"token"`
}
