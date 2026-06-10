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

// LoginResponse is returned with a freshly minted JWT on successful login.
type LoginResponse struct {
	Token string `json:"token"`
}
