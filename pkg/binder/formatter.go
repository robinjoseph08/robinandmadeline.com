package binder

import (
	"encoding/json"
	"fmt"
	"log/slog"
	"reflect"
	"strings"
	timepkg "time"

	"github.com/go-playground/validator/v10"
	"github.com/gorilla/schema"
)

// Validation tag names the formatter renders friendly messages for. They mirror
// the tags used across the request payloads.
const (
	date     = "date"
	email    = "email"
	gt       = "gt"
	gte      = "gte"
	gtfield  = "gtfield"
	ltfield  = "ltfield"
	mx       = "max"
	mn       = "min"
	ne       = "ne"
	oneof    = "oneof"
	required = "required"
	urlTag   = "url"
)

var timeType = reflect.TypeOf(timepkg.Time{})

// formatUnmarshalTypeError renders a JSON type mismatch (e.g. a string where a
// number was expected) into a client-facing message naming the field.
func formatUnmarshalTypeError(err *json.UnmarshalTypeError) string {
	// FIXME: this doesn't work well for incorrect map values, e.g. it will say
	// `"metadata" should be a string instead of a object` if you pass in
	// `{"metadata":{"foo":{"bar":"baz"}}}`.
	return fmt.Sprintf("%q should be of type %s", strings.Trim(err.Field, "."), err.Type)
}

// formatSchemaConversionError renders a query-string conversion failure (e.g. a
// non-numeric value for an int filter) into a client-facing message.
func formatSchemaConversionError(err schema.ConversionError) string {
	return fmt.Sprintf("%q should be of type %s", err.Key, err.Type)
}

// formatValidationError maps a single validator.FieldError to a friendly,
// client-facing message keyed on the failing tag.
func formatValidationError(err validator.FieldError) string {
	field := err.Field()

	switch err.Tag() {
	case date:
		return fmt.Sprintf("%q should be in the format of YYYY-MM-DD", field)
	case email:
		return fmt.Sprintf("%q is not a valid email", field)
	case gt:
		v := err.Param()
		if v == "" && err.Type() == timeType {
			v = "now"
		}
		return fmt.Sprintf("%q must be greater than %s", field, v)
	case gte:
		v := err.Param()
		if v == "" && err.Type() == timeType {
			v = "now"
		}
		return fmt.Sprintf("%q must be greater than or equal to %s", field, v)
	case gtfield:
		// FIXME: err.Param() will return the struct field, not the JSON version
		// e.g. EndTime, not end_time
		return fmt.Sprintf("%q must be greater than %s", field, err.Param())
	case ltfield:
		// FIXME: err.Param() will return the struct field, not the JSON version
		// e.g. EndTime, not end_time
		return fmt.Sprintf("%q must be less than %s", field, err.Param())
	case mx:
		//exhaustive:ignore
		switch err.Kind() {
		case reflect.Int, reflect.Int8, reflect.Int16, reflect.Int32, reflect.Int64,
			reflect.Uint, reflect.Uint8, reflect.Uint16, reflect.Uint32, reflect.Uint64,
			reflect.Float32, reflect.Float64:
			return fmt.Sprintf("%q must be less than or equal to %s", field, err.Param())
		case reflect.Slice:
			resource := "element"
			if err.Param() != "1" {
				resource += "s"
			}
			return fmt.Sprintf("%q length must be less than or equal to %s %s", field, err.Param(), resource)
		default:
			resource := "character"
			if err.Param() != "1" {
				resource += "s"
			}
			return fmt.Sprintf("%q length must be less than or equal to %s %s", field, err.Param(), resource)
		}
	case mn:
		//exhaustive:ignore
		switch err.Kind() {
		case reflect.Int, reflect.Int8, reflect.Int16, reflect.Int32, reflect.Int64,
			reflect.Uint, reflect.Uint8, reflect.Uint16, reflect.Uint32, reflect.Uint64,
			reflect.Float32, reflect.Float64:
			return fmt.Sprintf("%q must be greater than or equal to %s", field, err.Param())
		case reflect.Slice:
			resource := "element"
			if err.Param() != "1" {
				resource += "s"
			}
			return fmt.Sprintf("%q length must be greater than or equal to %s %s", field, err.Param(), resource)
		default:
			resource := "character"
			if err.Param() != "1" {
				resource += "s"
			}
			return fmt.Sprintf("%q length must be greater than or equal to %s %s", field, err.Param(), resource)
		}
	case ne:
		return fmt.Sprintf("%q can't be %q", field, err.Param())
	case oneof:
		valids := []string{}
		for _, p := range strings.Fields(err.Param()) {
			valids = append(valids, fmt.Sprintf("%q", p))
		}
		return fmt.Sprintf("%q must be one of the following: %s", field, strings.Join(valids, ", "))
	case required:
		return fmt.Sprintf("%q is required", field)
	case urlTag:
		return fmt.Sprintf("%q is not a valid URL", field)
	default:
		// A tag without a dedicated message above falls back to a generic message.
		// The debug log surfaces the unhandled tag so a friendlier message can be
		// added when a new validator is introduced.
		slog.Debug("unformatted validation tag",
			"tag", err.Tag(),
			"actual_tag", err.ActualTag(),
			"field", field,
			"param", err.Param(),
			"kind", err.Kind().String(),
		)
		return fmt.Sprintf("%q is invalid", field)
	}
}
