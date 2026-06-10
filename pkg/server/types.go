package server

// API response types for the endpoints the server registers directly. Named,
// exported structs per the API type conventions (ADR 0008) so tygo can
// generate them for the frontend.

// HealthResponse is the JSON body returned by GET /api/health.
type HealthResponse struct {
	Status   string `json:"status"`
	Database string `json:"database"`
}

// MeResponse is the JSON body returned by GET /api/admin/me, confirming the
// caller's role.
type MeResponse struct {
	Role string `json:"role"`
}
