// Package errcodes defines the application's typed HTTP errors and the Echo
// error handler that renders them. Constructors return an *Error carrying the
// HTTP status, a stable machine code, and a client-safe message; the handler
// resolves any error to the standard envelope. No custom As/Is is defined:
// stdlib errors.As / errors.Is traverse the chain (including pkg/errors wraps)
// to find an *Error.
package errcodes

import "net/http"

// Code is a stable, machine-readable error code. The //tygo:emit line generates
// a matching TypeScript union so clients can switch on codes type-safely.
type Code string

const (
	//tygo:emit export type ErrorCode = typeof CodeNotFound | typeof CodeBadRequest | typeof CodeValidationError | typeof CodeConflict | typeof CodeUnauthorized | typeof CodeForbidden | typeof CodeInternal;
	CodeNotFound        Code = "not_found"
	CodeBadRequest      Code = "bad_request"
	CodeValidationError Code = "validation_error"
	CodeConflict        Code = "conflict"
	CodeUnauthorized    Code = "unauthorized"
	CodeForbidden       Code = "forbidden"
	CodeInternal        Code = "internal_server_error"
)

// Error is an HTTP-aware application error.
type Error struct {
	HTTPCode int
	Message  string
	Code     string
}

func (e *Error) Error() string { return e.Message }

// NotFound returns a 404 naming the missing resource.
func NotFound(resource string) error {
	return &Error{http.StatusNotFound, resource + " not found", string(CodeNotFound)}
}

// BadRequest returns a 400 with the given message.
func BadRequest(msg string) error {
	return &Error{http.StatusBadRequest, msg, string(CodeBadRequest)}
}

// ValidationError returns a 422 with the given message.
func ValidationError(msg string) error {
	return &Error{http.StatusUnprocessableEntity, msg, string(CodeValidationError)}
}

// Conflict returns a 409 with the given message.
func Conflict(msg string) error {
	return &Error{http.StatusConflict, msg, string(CodeConflict)}
}

// Unauthorized returns a 401 with the given message.
func Unauthorized(msg string) error {
	return &Error{http.StatusUnauthorized, msg, string(CodeUnauthorized)}
}

// Forbidden returns a 403 with the given message.
func Forbidden(msg string) error {
	return &Error{http.StatusForbidden, msg, string(CodeForbidden)}
}

// Internal returns a 500 with the given message. The message is for logs only;
// the handler never sends it to the client (see handler.go).
func Internal(msg string) error {
	return &Error{http.StatusInternalServerError, msg, string(CodeInternal)}
}
