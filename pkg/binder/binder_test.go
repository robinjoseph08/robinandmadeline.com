package binder

import (
	"context"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/labstack/echo/v4"
	"github.com/robinjoseph08/robinandmadeline.com/pkg/errcodes"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

// params exercises the full pipeline: mod:"trim" runs before validate:"max=9",
// and a json:"-" field is ignored by the validator tag-name func.
type params struct {
	Hello string `json:"hello" mod:"trim" validate:"max=9"`
	Omit  string `json:"-"`
}

const (
	goodJSON             = `{"hello":" world "}`
	unknownFieldsErrJSON = `{"hello":"world","foo":"bar"}`
	typeErrJSON          = `{"hello":123}`
	validationErrJSON    = `{"hello":"0123456789"}`
)

// codeOf extracts the errcodes.Code from an error returned by the binder, so
// tests assert on the stable machine code rather than message text.
func codeOf(t *testing.T, err error) string {
	t.Helper()
	require.Error(t, err)
	var e *errcodes.Error
	require.ErrorAs(t, err, &e)
	return e.Code
}

func TestNew(t *testing.T) {
	t.Parallel()
	b, err := New()
	require.NoError(t, err)
	assert.NotNil(t, b)

	t.Run("rejects unsupported content types", func(t *testing.T) {
		t.Parallel()
		c := newContext(http.MethodPost, "/", goodJSON, echo.MIMEApplicationXML)
		p := params{}
		assert.Equal(t, string(errcodes.CodeUnsupportedMediaType), codeOf(t, b.Bind(&p, c)))
	})

	t.Run("disallows unknown fields", func(t *testing.T) {
		t.Parallel()
		c := newContext(http.MethodPost, "/", unknownFieldsErrJSON, echo.MIMEApplicationJSON)
		p := params{}
		assert.Equal(t, string(errcodes.CodeUnknownParameter), codeOf(t, b.Bind(&p, c)))
	})

	t.Run("maps JSON type errors to a 422 type error", func(t *testing.T) {
		t.Parallel()
		c := newContext(http.MethodPost, "/", typeErrJSON, echo.MIMEApplicationJSON)
		p := params{}
		err := b.Bind(&p, c)
		assert.Equal(t, string(errcodes.CodeValidationTypeError), codeOf(t, err))
		assert.Contains(t, err.Error(), "Hello must be of type string.")
	})

	t.Run("applies mod tags before validation", func(t *testing.T) {
		t.Parallel()
		c := newContext(http.MethodPost, "/", goodJSON, echo.MIMEApplicationJSON)
		p := params{}
		require.NoError(t, b.Bind(&p, c))
		assert.Equal(t, "world", p.Hello)
	})

	t.Run("maps validation failures to a 422 validation error", func(t *testing.T) {
		t.Parallel()
		c := newContext(http.MethodPost, "/", validationErrJSON, echo.MIMEApplicationJSON)
		p := params{}
		err := b.Bind(&p, c)
		assert.Equal(t, string(errcodes.CodeValidationError), codeOf(t, err))
		assert.Contains(t, err.Error(), "Hello must be at most 9 characters.")
	})

	t.Run("rejects an empty body on a non-GET/DELETE request", func(t *testing.T) {
		t.Parallel()
		c := newContext(http.MethodPost, "/", "", echo.MIMEApplicationJSON)
		p := params{}
		assert.Equal(t, string(errcodes.CodeEmptyRequestBody), codeOf(t, b.Bind(&p, c)))
	})
}

// TestBind_AppliesDefaults proves creasty/defaults runs in the pipeline: a nil
// slice with default:"[]" becomes a non-nil empty slice, and a missing scalar
// with a default is filled.
func TestBind_AppliesDefaults(t *testing.T) {
	t.Parallel()
	b, err := New()
	require.NoError(t, err)

	type payload struct {
		Tags  []string `json:"tags" default:"[]"`
		Limit int      `json:"limit" default:"24" validate:"min=1,max=50"`
	}
	c := newContext(http.MethodPost, "/", `{}`, echo.MIMEApplicationJSON)
	p := payload{}
	require.NoError(t, b.Bind(&p, c))
	assert.NotNil(t, p.Tags, "default:\"[]\" should initialize a nil slice")
	assert.Empty(t, p.Tags)
	assert.Equal(t, 24, p.Limit, "default scalar should be filled")
}

// TestBind_QueryString proves the GET path binds via gorilla/schema (query
// aliases) and then validates.
func TestBind_QueryString(t *testing.T) {
	t.Parallel()
	b, err := New()
	require.NoError(t, err)

	type query struct {
		Side  *string `query:"side" json:"side" validate:"omitempty,oneof=robin madeline"`
		Limit int     `query:"limit" json:"limit" validate:"omitempty,min=1,max=50"`
	}

	t.Run("binds present filters", func(t *testing.T) {
		t.Parallel()
		c := newContext(http.MethodGet, "/?side=robin&limit=10", "", "")
		q := query{}
		require.NoError(t, b.Bind(&q, c))
		require.NotNil(t, q.Side)
		assert.Equal(t, "robin", *q.Side)
		assert.Equal(t, 10, q.Limit)
	})

	t.Run("validates query enums", func(t *testing.T) {
		t.Parallel()
		c := newContext(http.MethodGet, "/?side=nobody", "", "")
		q := query{}
		assert.Equal(t, string(errcodes.CodeValidationError), codeOf(t, b.Bind(&q, c)))
	})

	t.Run("maps query conversion errors to a 422 type error", func(t *testing.T) {
		t.Parallel()
		c := newContext(http.MethodGet, "/?limit=abc", "", "")
		q := query{}
		assert.Equal(t, string(errcodes.CodeValidationTypeError), codeOf(t, b.Bind(&q, c)))
	})

	t.Run("rejects unknown query keys", func(t *testing.T) {
		t.Parallel()
		c := newContext(http.MethodGet, "/?bogus=1", "", "")
		q := query{}
		assert.Equal(t, string(errcodes.CodeUnknownParameter), codeOf(t, b.Bind(&q, c)))
	})
}

// TestBind_SliceElementModAndValidate proves mod:"dive,trim" trims each element
// before validate:"dive,oneof=..." checks it, the exact shape used by
// Party.Circle. Without dive on the slice, the inner trim would be a no-op.
func TestBind_SliceElementModAndValidate(t *testing.T) {
	t.Parallel()
	b, err := New()
	require.NoError(t, err)

	type payload struct {
		Circle []string `json:"circle" mod:"dive,trim" validate:"omitempty,dive,oneof=College Work" default:"[]"`
	}

	t.Run("trims each element then accepts valid values", func(t *testing.T) {
		t.Parallel()
		c := newContext(http.MethodPost, "/", `{"circle":["  College  "," Work "]}`, echo.MIMEApplicationJSON)
		p := payload{}
		require.NoError(t, b.Bind(&p, c))
		assert.Equal(t, []string{"College", "Work"}, p.Circle)
	})

	t.Run("rejects an out-of-set element", func(t *testing.T) {
		t.Parallel()
		c := newContext(http.MethodPost, "/", `{"circle":["Nope"]}`, echo.MIMEApplicationJSON)
		p := payload{}
		assert.Equal(t, string(errcodes.CodeValidationError), codeOf(t, b.Bind(&p, c)))
	})
}

// TestBind_DiveRequiredForSliceModTraversal documents that mold/v4 only applies
// inner-field modifiers (e.g. mod:"trim") to slice elements when the parent
// slice field carries mod:"dive". Without dive, the modifiers on the inner
// struct are silently no-ops. Ported from the shisho reference repo to pin the
// behavior at the binder level.
func TestBind_DiveRequiredForSliceModTraversal(t *testing.T) {
	t.Parallel()
	b, err := New()
	require.NoError(t, err)

	type inner struct {
		Value string `json:"value" mod:"trim"`
	}
	type withoutDive struct {
		Items []inner `json:"items"`
	}
	type withDive struct {
		Items []inner `json:"items" mod:"dive"`
	}

	body := `{"items":[{"value":"  hi  "}]}`

	t.Run("without dive, inner mod:trim is a no-op", func(t *testing.T) {
		t.Parallel()
		c := newContext(http.MethodPost, "/", body, echo.MIMEApplicationJSON)
		p := withoutDive{}
		require.NoError(t, b.Bind(&p, c))
		require.Len(t, p.Items, 1)
		assert.Equal(t, "  hi  ", p.Items[0].Value, "without mod:\"dive\", inner modifiers must not fire")
	})

	t.Run("with dive, inner mod:trim is applied", func(t *testing.T) {
		t.Parallel()
		c := newContext(http.MethodPost, "/", body, echo.MIMEApplicationJSON)
		p := withDive{}
		require.NoError(t, b.Bind(&p, c))
		require.Len(t, p.Items, 1)
		assert.Equal(t, "hi", p.Items[0].Value, "with mod:\"dive\", inner modifiers must fire on each element")
	})
}

// TestValidators covers the date, url, and emailblank custom validators
// directly.
func TestValidators(t *testing.T) {
	t.Parallel()
	b, err := New()
	require.NoError(t, err)

	type payload struct {
		When string `json:"when" validate:"omitempty,date"`
		Site string `json:"site" validate:"omitempty,url"`
		Mail string `json:"mail" validate:"omitempty,emailblank"`
	}

	cases := []struct {
		name string
		body string
		ok   bool
	}{
		{"valid date", `{"when":"2026-06-07"}`, true},
		{"empty date allowed", `{"when":""}`, true},
		{"bad date", `{"when":"06/07/2026"}`, false},
		{"valid url", `{"site":"https://example.com"}`, true},
		{"bad url", `{"site":"not a url"}`, false},
		{"valid email", `{"mail":"pat@example.com"}`, true},
		{"empty email allowed", `{"mail":""}`, true},
		{"bad email", `{"mail":"not-an-email"}`, false},
		{"email with display name rejected", `{"mail":"Pat <pat@example.com>"}`, false},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			t.Parallel()
			c := newContext(http.MethodPost, "/", tc.body, echo.MIMEApplicationJSON)
			p := payload{}
			bindErr := b.Bind(&p, c)
			if tc.ok {
				assert.NoError(t, bindErr)
			} else {
				assert.Equal(t, string(errcodes.CodeValidationError), codeOf(t, bindErr))
			}
		})
	}
}

// TestPhone covers the phone validator and the phone mold modifier together: a
// valid number is normalized to E.164 (mod) and accepted (validate), a blank is
// allowed so a cleared cell persists, and anything that is not a real number is
// rejected. The default region is US, so a domestic number needs no country
// code while an international one must carry its leading "+".
func TestPhone(t *testing.T) {
	t.Parallel()
	b, err := New()
	require.NoError(t, err)

	type payload struct {
		Phone string `json:"phone" mod:"trim,phone" validate:"omitempty,phone,max=32"`
	}

	cases := []struct {
		name string
		in   string
		want string // expected normalized value when ok
		ok   bool
	}{
		{"US national formatting", "(415) 555-2671", "+14155552671", true},
		{"US bare digits", "4155552671", "+14155552671", true},
		{"US with country code", "+1 415 555 2671", "+14155552671", true},
		{"surrounding space trimmed", "  415-555-2671  ", "+14155552671", true},
		{"international with plus", "+44 20 7946 0958", "+442079460958", true},
		{"blank allowed", "", "", true},
		{"garbage rejected", "asds", "", false},
		{"too short rejected", "12345", "", false},
		{"international without plus rejected", "020 7946 0958", "", false},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			t.Parallel()
			c := newContext(http.MethodPost, "/", `{"phone":"`+tc.in+`"}`, echo.MIMEApplicationJSON)
			p := payload{}
			bindErr := b.Bind(&p, c)
			if tc.ok {
				require.NoError(t, bindErr)
				assert.Equal(t, tc.want, p.Phone, "phone should normalize to E.164")
			} else {
				assert.Equal(t, string(errcodes.CodeValidationError), codeOf(t, bindErr))
			}
		})
	}
}

// TestValidationMessages pins the client-facing wording the formatter produces:
// every message is sentence case (with the snake_case JSON field humanized to a
// spaced, capitalized label) and ends in a period.
func TestValidationMessages(t *testing.T) {
	t.Parallel()
	b, err := New()
	require.NoError(t, err)

	type payload struct {
		FullName string   `json:"full_name" validate:"required,min=1,max=200"`
		Side     string   `json:"side" validate:"omitempty,oneof=robin madeline"`
		Email    string   `json:"email" validate:"omitempty,email"`
		Phone    string   `json:"phone" validate:"omitempty,phone"`
		Circle   []string `json:"circle" validate:"omitempty,max=2"`
	}

	cases := []struct {
		name string
		body string
		want string
	}{
		{"required humanizes the field", `{"full_name":""}`, "Full name is required."},
		{"oneof lists the valid values", `{"full_name":"A","side":"nobody"}`, "Side must be one of: robin, madeline."},
		{"email reads as a sentence", `{"full_name":"A","email":"nope"}`, "Email must be a valid email address."},
		{"phone reads as a sentence", `{"full_name":"A","phone":"asds"}`, "Phone must be a valid phone number."},
		{"max on a string counts characters", `{"full_name":"` + strings.Repeat("x", 201) + `"}`, "Full name must be at most 200 characters."},
		{"max on a slice counts elements", `{"full_name":"A","circle":["a","b","c"]}`, "Circle must have at most 2 elements."},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			t.Parallel()
			c := newContext(http.MethodPost, "/", tc.body, echo.MIMEApplicationJSON)
			p := payload{}
			bindErr := b.Bind(&p, c)
			require.Error(t, bindErr)
			assert.Equal(t, string(errcodes.CodeValidationError), codeOf(t, bindErr))
			assert.Equal(t, tc.want, bindErr.Error())
		})
	}
}

// newContext builds an echo.Context for a request. An empty payload yields a
// bodyless request (ContentLength 0), which the binder routes to the query path
// for GET/DELETE and rejects as an empty body otherwise.
func newContext(method, target, payload, mime string) echo.Context {
	e := echo.New()
	var req *http.Request
	if payload == "" {
		req = httptest.NewRequestWithContext(context.Background(), method, target, http.NoBody)
	} else {
		req = httptest.NewRequestWithContext(context.Background(), method, target, strings.NewReader(payload))
	}
	if mime != "" {
		req.Header.Set(echo.HeaderContentType, mime)
	}
	rr := httptest.NewRecorder()
	return e.NewContext(req, rr)
}
