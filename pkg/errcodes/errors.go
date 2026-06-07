// Package errcodes defines the application's typed HTTP errors and the Echo
// error handler that renders them. Constructors return an *Error carrying the
// HTTP status, a stable machine code, and a client-safe message; the handler
// resolves any error to the standard envelope. No custom As/Is is defined:
// stdlib errors.As / errors.Is traverse the chain (including pkg/errors wraps)
// to find an *Error.
package errcodes

import (
	"fmt"
	"net/http"
	"strings"
)

// capitalize returns s with its first letter upper-cased, leaving the rest
// untouched. It lets NotFound callers keep passing a lowercase resource name
// (e.g. "party") while the rendered message reads as a sentence ("Party not
// found.").
func capitalize(s string) string {
	if s == "" {
		return s
	}
	return strings.ToUpper(s[:1]) + s[1:]
}

// Code is a stable, machine-readable error code. The //tygo:emit line generates
// a matching TypeScript union so clients can switch on codes type-safely.
type Code string

const (
	//tygo:emit export type ErrorCode = typeof CodeNotFound | typeof CodeBadRequest | typeof CodeValidationError | typeof CodeUnknownParameter | typeof CodeValidationTypeError | typeof CodeMalformedPayload | typeof CodeEmptyRequestBody | typeof CodeUnsupportedMediaType | typeof CodeConflict | typeof CodeUnauthorized | typeof CodeForbidden | typeof CodeInternal;
	CodeNotFound             Code = "not_found"
	CodeBadRequest           Code = "bad_request"
	CodeValidationError      Code = "validation_error"
	CodeUnknownParameter     Code = "unknown_parameter"
	CodeValidationTypeError  Code = "validation_type_error"
	CodeMalformedPayload     Code = "malformed_payload"
	CodeEmptyRequestBody     Code = "empty_request_body"
	CodeUnsupportedMediaType Code = "unsupported_media_type"
	CodeConflict             Code = "conflict"
	CodeUnauthorized         Code = "unauthorized"
	CodeForbidden            Code = "forbidden"
	CodeInternal             Code = "internal_server_error"
)

// Error is an HTTP-aware application error.
type Error struct {
	HTTPCode int
	Message  string
	Code     string
}

func (e *Error) Error() string { return e.Message }

// NotFound returns a 404 naming the missing resource. The resource is
// capitalized so callers can pass a lowercase name (e.g. "party") and still get
// a sentence-case message ("Party not found.").
func NotFound(resource string) error {
	return &Error{http.StatusNotFound, capitalize(resource) + " not found.", string(CodeNotFound)}
}

// BadRequest returns a 400 with the given message.
func BadRequest(msg string) error {
	return &Error{http.StatusBadRequest, msg, string(CodeBadRequest)}
}

// ValidationError returns a 422 with the given message.
func ValidationError(msg string) error {
	return &Error{http.StatusUnprocessableEntity, msg, string(CodeValidationError)}
}

// UnknownParameter returns a 422 naming a request field the payload does not
// recognize. The binder returns it when a JSON body or query string carries an
// unknown key.
func UnknownParameter(field string) error {
	return &Error{http.StatusUnprocessableEntity, fmt.Sprintf("%q is not a recognized parameter.", field), string(CodeUnknownParameter)}
}

// ValidationTypeError returns a 422 for a request field whose value is of the
// wrong type (e.g. a string where a number is expected). The binder returns it
// for JSON unmarshal and query conversion type mismatches.
func ValidationTypeError(msg string) error {
	return &Error{http.StatusUnprocessableEntity, msg, string(CodeValidationTypeError)}
}

// MalformedPayload returns a 400 for a request body that could not be parsed
// (e.g. invalid JSON) and does not fall under a more specific binder error.
func MalformedPayload() error {
	return &Error{http.StatusBadRequest, "The request body is malformed.", string(CodeMalformedPayload)}
}

// EmptyRequestBody returns a 400 for a body-expecting request that arrived with
// no body.
func EmptyRequestBody() error {
	return &Error{http.StatusBadRequest, "The request body is empty.", string(CodeEmptyRequestBody)}
}

// UnsupportedMediaType returns a 415 for a request whose Content-Type the binder
// does not support (only application/json bodies are accepted).
func UnsupportedMediaType() error {
	return &Error{http.StatusUnsupportedMediaType, "The request content type is not supported.", string(CodeUnsupportedMediaType)}
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
