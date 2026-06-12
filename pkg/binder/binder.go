// Package binder is the custom Echo Binder that turns request payloads into
// validated structs from their tags alone. A single c.Bind(&payload) runs the
// pipeline: bind (JSON body or query string) -> mold modifiers (`mod:` tags) ->
// creasty defaults (`default:` tags) -> validator/v10 (`validate:` tags). Every
// failure is returned as a pkg/errcodes error (422 or 400) so the shared error
// handler renders it. Handlers never hand-roll request validation; the struct
// tags are the spec.
//
// This is ported from the shisho reference repo, adapted to our packages. We
// drop shisho's multipart/FormFiles branch because this service has no uploads
// yet; reintroduce it (and the form decoder usage for files) when one lands.
package binder

import (
	"encoding/json"
	"net/http"
	"net/url"
	"reflect"
	"regexp"
	"strings"

	"github.com/creasty/defaults"
	"github.com/go-playground/mold/v4"
	"github.com/go-playground/mold/v4/modifiers"
	"github.com/go-playground/validator/v10"
	"github.com/gorilla/schema"
	"github.com/labstack/echo/v4"
	"github.com/pkg/errors"
	"github.com/robinjoseph08/golib/echo/v4/middleware/logger"
	"github.com/robinjoseph08/robinandmadeline.com/pkg/errcodes"
)

// unknownFieldsRE extracts the offending field name from the stdlib JSON
// decoder's "unknown field" error so the binder can report it as a named
// unknown_parameter rather than an opaque malformed-payload error.
var unknownFieldsRE = regexp.MustCompile(`^json: unknown field "(.*)"$`)

// Binder is a custom struct that implements the Echo Binder interface. It binds
// to a struct, uses mold to clean up the params, creasty/defaults to fill
// defaults, and validator to validate them.
type Binder struct {
	queryDecoder *schema.Decoder
	conform      *mold.Transformer
	validate     *validator.Validate
}

// New initializes a new Binder instance with the appropriate validation
// functions registered. The query decoder reads `query` aliases, validator
// error fields use the json name, the date/url/emailblank/phone custom
// validators are registered, and mold gains the phone modifier (E.164
// normalization).
func New() (*Binder, error) {
	queryDecoder := schema.NewDecoder()
	queryDecoder.SetAliasTag("query")
	conform := modifiers.New()
	conform.Register("phone", phoneModifier)
	validate := validator.New()
	validate.RegisterTagNameFunc(func(fld reflect.StructField) string {
		name := strings.SplitN(fld.Tag.Get("json"), ",", 2)[0]
		if name == "-" {
			return ""
		}
		return name
	})
	if err := validate.RegisterValidation("date", dateValidator); err != nil {
		return nil, errors.WithStack(err)
	}
	if err := validate.RegisterValidation("time", timeValidator); err != nil {
		return nil, errors.WithStack(err)
	}
	if err := validate.RegisterValidation("url", urlValidator); err != nil {
		return nil, errors.WithStack(err)
	}
	if err := validate.RegisterValidation("emailblank", emailBlankValidator); err != nil {
		return nil, errors.WithStack(err)
	}
	if err := validate.RegisterValidation("phone", phoneValidator); err != nil {
		return nil, errors.WithStack(err)
	}

	return &Binder{queryDecoder, conform, validate}, nil
}

// Bind binds, modifies, defaults, and validates payloads against the given
// struct. A body is bound as JSON (with unknown fields rejected by default);
// a bodyless GET/DELETE is bound from the query string; any other bodyless
// request is rejected as an empty body. The struct then flows through mold,
// creasty/defaults, and validator, with a validation failure surfaced as a 422.
func (b *Binder) Bind(i interface{}, c echo.Context) error {
	req := c.Request()

	disallowEmptyBody := true
	if disallow, ok := c.Get("disallow_empty_body").(bool); ok {
		disallowEmptyBody = disallow
	}

	// ContentLength > 0 is the body-presence check, so a chunked request
	// (ContentLength -1) is treated as bodyless; our clients always send
	// Content-Length.
	if req.ContentLength > 0 {
		// request has a body
		ctype := req.Header.Get(echo.HeaderContentType)
		switch {
		// allow application/json
		case strings.HasPrefix(ctype, echo.MIMEApplicationJSON):
			dec := json.NewDecoder(req.Body)
			disallowUnknownFields := true
			if disallow, ok := c.Get("disallow_unknown_fields").(bool); ok {
				disallowUnknownFields = disallow
			}
			if disallowUnknownFields {
				dec.DisallowUnknownFields()
			}
			defer req.Body.Close()
			if err := dec.Decode(i); err != nil {
				// return better error message when there are unknown fields
				if matches := unknownFieldsRE.FindAllStringSubmatch(err.Error(), -1); len(matches) > 0 && len(matches[0]) > 1 {
					return errcodes.UnknownParameter(matches[0][1])
				}

				// return better error message on type errors
				var typeErr *json.UnmarshalTypeError
				if errors.As(err, &typeErr) {
					return errcodes.ValidationTypeError(formatUnmarshalTypeError(typeErr))
				}

				logger.FromEchoContext(c).Err(err).Debug("unknown json decode error")

				return errcodes.MalformedPayload()
			}
		default:
			return errcodes.UnsupportedMediaType()
		}
	} else {
		// request doesn't have a body
		if req.Method == http.MethodGet || req.Method == http.MethodDelete {
			if err := b.decodeQuery(i, c.QueryParams(), b.queryDecoder); err != nil {
				return errors.WithStack(err)
			}
		} else if disallowEmptyBody {
			return errcodes.EmptyRequestBody()
		}
	}

	if err := b.conform.Struct(req.Context(), i); err != nil {
		return errors.WithStack(err)
	}

	if err := defaults.Set(i); err != nil {
		return errors.WithStack(err)
	}

	if err := b.validate.Struct(i); err != nil {
		var errs validator.ValidationErrors
		if errors.As(err, &errs) {
			return errcodes.ValidationError(formatValidationError(errs[0]))
		}
		return errors.WithStack(err)
	}
	return nil
}

// decodeQuery decodes url.Values into the target struct via gorilla/schema,
// translating schema's conversion and unknown-key errors into the matching
// errcodes (422 type error, 422 unknown parameter).
func (b *Binder) decodeQuery(i interface{}, params url.Values, decoder *schema.Decoder) error {
	if err := decoder.Decode(i, params); err != nil {
		var errs schema.MultiError
		if errors.As(err, &errs) {
			var first error
			for _, first = range errs {
				break
			}

			var convErr schema.ConversionError
			if errors.As(first, &convErr) {
				return errcodes.ValidationTypeError(formatSchemaConversionError(convErr))
			}
			var unknownErr schema.UnknownKeyError
			if errors.As(first, &unknownErr) {
				return errcodes.UnknownParameter(unknownErr.Key)
			}

			return errors.WithStack(first)
		}
		return errors.WithStack(err)
	}
	return nil
}
