package binder

import (
	"encoding/json"
	"fmt"
	"reflect"
	"strings"
	timepkg "time"

	"github.com/go-playground/validator/v10"
	"github.com/gorilla/schema"
	"github.com/robinjoseph08/golib/logger"
)

// Validation tag names the formatter renders friendly messages for. They mirror
// the tags used across the request payloads.
const (
	date       = "date"
	email      = "email"
	emailblank = "emailblank"
	gt         = "gt"
	gte        = "gte"
	gtfield    = "gtfield"
	ltfield    = "ltfield"
	mx         = "max"
	mn         = "min"
	ne         = "ne"
	oneof      = "oneof"
	phone      = "phone"
	required   = "required"
	urlTag     = "url"
)

var timeType = reflect.TypeOf(timepkg.Time{})

// humanizeField turns a snake_case JSON field name into a sentence-leading,
// human-readable label: the underscores become spaces and the first letter is
// capitalized (e.g. `full_name` -> "Full name"). The binder registers the JSON
// tag as the validator field name, so this receives names like `rsvp_code`.
func humanizeField(field string) string {
	label := strings.ReplaceAll(field, "_", " ")
	if label == "" {
		return label
	}
	return strings.ToUpper(label[:1]) + label[1:]
}

// pluralizeUnit returns the singular unit when the bound is exactly "1" and the
// plural otherwise, so messages read "at least 1 character" / "at most 200
// characters".
func pluralizeUnit(singular, param string) string {
	if param == "1" {
		return singular
	}
	return singular + "s"
}

// formatUnmarshalTypeError renders a JSON type mismatch (e.g. a string where a
// number was expected) into a client-facing sentence naming the field.
func formatUnmarshalTypeError(err *json.UnmarshalTypeError) string {
	// FIXME: this doesn't work well for incorrect map values, e.g. it will say
	// `Metadata must be of type string.` if you pass in
	// `{"metadata":{"foo":{"bar":"baz"}}}`.
	field := humanizeField(strings.Trim(err.Field, "."))
	return fmt.Sprintf("%s must be of type %s.", field, err.Type)
}

// formatSchemaConversionError renders a query-string conversion failure (e.g. a
// non-numeric value for an int filter) into a client-facing sentence.
func formatSchemaConversionError(err schema.ConversionError) string {
	return fmt.Sprintf("%s must be of type %s.", humanizeField(err.Key), err.Type)
}

// formatValidationError maps a single validator.FieldError to a friendly,
// client-facing sentence keyed on the failing tag. Every message is sentence
// case (humanized field name first) and ends in a period.
func formatValidationError(err validator.FieldError) string {
	field := humanizeField(err.Field())

	switch err.Tag() {
	case date:
		return field + " must be in the format YYYY-MM-DD."
	case email, emailblank:
		return field + " must be a valid email address."
	case gt:
		v := err.Param()
		if v == "" && err.Type() == timeType {
			v = "now"
		}
		return fmt.Sprintf("%s must be greater than %s.", field, v)
	case gte:
		v := err.Param()
		if v == "" && err.Type() == timeType {
			v = "now"
		}
		return fmt.Sprintf("%s must be greater than or equal to %s.", field, v)
	case gtfield:
		// FIXME: err.Param() will return the struct field, not the JSON version
		// e.g. EndTime, not end_time
		return fmt.Sprintf("%s must be greater than %s.", field, humanizeField(err.Param()))
	case ltfield:
		// FIXME: err.Param() will return the struct field, not the JSON version
		// e.g. EndTime, not end_time
		return fmt.Sprintf("%s must be less than %s.", field, humanizeField(err.Param()))
	case mx:
		//exhaustive:ignore
		switch err.Kind() {
		case reflect.Int, reflect.Int8, reflect.Int16, reflect.Int32, reflect.Int64,
			reflect.Uint, reflect.Uint8, reflect.Uint16, reflect.Uint32, reflect.Uint64,
			reflect.Float32, reflect.Float64:
			return fmt.Sprintf("%s must be at most %s.", field, err.Param())
		case reflect.Slice:
			return fmt.Sprintf("%s must have at most %s %s.", field, err.Param(), pluralizeUnit("element", err.Param()))
		default:
			return fmt.Sprintf("%s must be at most %s %s.", field, err.Param(), pluralizeUnit("character", err.Param()))
		}
	case mn:
		//exhaustive:ignore
		switch err.Kind() {
		case reflect.Int, reflect.Int8, reflect.Int16, reflect.Int32, reflect.Int64,
			reflect.Uint, reflect.Uint8, reflect.Uint16, reflect.Uint32, reflect.Uint64,
			reflect.Float32, reflect.Float64:
			return fmt.Sprintf("%s must be at least %s.", field, err.Param())
		case reflect.Slice:
			return fmt.Sprintf("%s must have at least %s %s.", field, err.Param(), pluralizeUnit("element", err.Param()))
		default:
			return fmt.Sprintf("%s must be at least %s %s.", field, err.Param(), pluralizeUnit("character", err.Param()))
		}
	case ne:
		return fmt.Sprintf("%s must not be %s.", field, err.Param())
	case oneof:
		valids := strings.Fields(err.Param())
		return fmt.Sprintf("%s must be one of: %s.", field, strings.Join(valids, ", "))
	case phone:
		return field + " must be a valid phone number."
	case required:
		return field + " is required."
	case urlTag:
		return field + " must be a valid URL."
	default:
		// A tag without a dedicated message above falls back to a generic message.
		// The debug log surfaces the unhandled tag so a friendlier message can be
		// added when a new validator is introduced. This formatter runs without an
		// echo.Context, so it uses a base golib logger rather than the
		// request-scoped one.
		logger.New().Data(logger.Data{
			"tag":        err.Tag(),
			"actual_tag": err.ActualTag(),
			"field":      field,
			"param":      err.Param(),
			"kind":       err.Kind().String(),
		}).Debug("unformatted validation tag")
		return field + " is invalid."
	}
}
