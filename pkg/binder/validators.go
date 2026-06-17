package binder

import (
	"context"
	"net/mail"
	"net/url"
	"reflect"
	"regexp"
	"time"

	"github.com/go-playground/mold/v4"
	"github.com/go-playground/validator/v10"
	"github.com/nyaruka/phonenumbers"
)

// dateRE constrains the month to 01-12 and the day to 01-31. It is a format
// check only; it does not validate the calendar (February 31 passes).
var dateRE = regexp.MustCompile(`^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12][0-9]|3[01])$`)

// dateValidator ensures the value matches the format YYYY-MM-DD or the empty
// string. The reason the empty string is allowed is that this validator can be
// used to clear out values. However, this is only useful in that case, so if
// you're using this validator but want the value to be required, add a `ne=` to
// the validate tag so that the empty string is disallowed.
func dateValidator(fl validator.FieldLevel) bool {
	value := fl.Field().String()
	if value == "" {
		return true
	}
	return dateRE.MatchString(value)
}

// timeRE constrains an "HH:MM" wall-clock value to zero-padded 24-hour form
// (00:00 through 23:59). The padding is load-bearing, not cosmetic: stored
// times sort lexically in chronological order (the schedule's ORDER BY relies
// on it) and feed fixed-width calendar formats ("5:00" would render as the
// invalid iCalendar time 50000). Go's `datetime=15:04` check is too lenient
// here because time.Parse accepts a single-digit hour.
var timeRE = regexp.MustCompile(`^([01][0-9]|2[0-3]):[0-5][0-9]$`)

// timeValidator ensures the value matches zero-padded 24-hour "HH:MM" or the
// empty string. Like the date validator it permits blank so a value can be
// cleared; pair with `omitempty`, and add `required` or `ne=` to forbid blank.
func timeValidator(fl validator.FieldLevel) bool {
	value := fl.Field().String()
	if value == "" {
		return true
	}
	return timeRE.MatchString(value)
}

// datetimeBlankValidator accepts a valid RFC3339 timestamp or the empty string.
// Like the date/url/emailblank validators it permits blank so a value can be
// cleared: a partial update sends a present-but-blank field to erase the
// setting, which the service then removes. A present, non-blank value must
// parse as RFC3339 (the format the app_settings rsvp_deadline is stored in and
// the RSVP reader parses back). Use `omitempty,datetimeblank` so an absent (nil
// pointer) field is skipped while a present blank one clears; add `required` to
// forbid blank.
//
// It exists instead of validator's built-in `datetime=...` because that tag
// rejects the empty string, so it cannot express the clear gesture; this
// mirrors how emailblank/phone permit blank for the same reason.
func datetimeBlankValidator(fl validator.FieldLevel) bool {
	value := fl.Field().String()
	if value == "" {
		return true
	}
	_, err := time.Parse(time.RFC3339, value)
	return err == nil
}

// urlValidator ensures the value is a valid URL or the empty string. The empty
// string is allowed so that this validator can be used to clear out values. If
// you want to enforce a non-empty URL, add a `required` tag.
func urlValidator(fl validator.FieldLevel) bool {
	value := fl.Field().String()
	if value == "" {
		return true
	}
	u, err := url.Parse(value)
	return err == nil && u.Scheme != "" && u.Host != ""
}

// emailBlankValidator accepts a valid email address or the empty string. Like
// the date/url validators it permits blank so a value can be cleared: a partial
// update (PATCH) sends a present-but-blank field to erase an optional email,
// which the service then stores as SQL NULL. A present, non-blank value is still
// format-checked. Use `omitempty,emailblank` so an absent (nil pointer) field is
// skipped while a present blank one clears; add `required` to forbid blank.
//
// The check is net/mail.ParseAddress with the parsed address required to equal
// the input and carry no display name, so "a@b.com" passes while "Name <a@b>"
// and "garbage" do not.
func emailBlankValidator(fl validator.FieldLevel) bool {
	value := fl.Field().String()
	if value == "" {
		return true
	}
	addr, err := mail.ParseAddress(value)
	return err == nil && addr.Name == "" && addr.Address == value
}

// defaultPhoneRegion is the region a phone number is parsed against when it does
// not already carry an international "+" country code. The couple and the bulk
// of the guest list are US-based; an international guest's number is still
// accepted as long as it is entered in full international form (leading "+").
const defaultPhoneRegion = "US"

// parsePhone parses a user-entered phone number against defaultPhoneRegion and
// reports whether it is a real, dialable number. A value written with a leading
// "+" is read in full international form regardless of the default region. The
// parsed number is returned so callers can render it to canonical E.164.
func parsePhone(value string) (*phonenumbers.PhoneNumber, bool) {
	num, err := phonenumbers.Parse(value, defaultPhoneRegion)
	if err != nil {
		return nil, false
	}
	return num, phonenumbers.IsValidNumber(num)
}

// phoneValidator accepts a valid phone number or the empty string. Like the
// date/url/emailblank validators it permits blank so a value can be cleared: a
// partial update (PATCH) sends a present-but-blank field to erase an optional
// phone, which the service then stores as SQL NULL. A present, non-blank value
// must be a real number. Use `omitempty,phone` so an absent (nil pointer) field
// is skipped while a present blank one clears; add `required` to forbid blank.
func phoneValidator(fl validator.FieldLevel) bool {
	value := fl.Field().String()
	if value == "" {
		return true
	}
	_, ok := parsePhone(value)
	return ok
}

// phoneModifier is the mold counterpart to phoneValidator: it normalizes a valid
// phone number to canonical E.164 (e.g. "(415) 555-2671" -> "+14155552671") so
// the database holds one unambiguous, dialable representation and the frontend
// owns all display formatting. It runs in the `mod` stage, before validation, so
// the value the validator (and the store) sees is already canonical. A blank or
// unparseable value is left untouched for phoneValidator to pass or reject; pair
// them as `mod:"trim,phone"` + `validate:"omitempty,phone"`.
func phoneModifier(_ context.Context, fl mold.FieldLevel) error {
	if fl.Field().Kind() != reflect.String {
		return nil
	}
	value := fl.Field().String()
	if value == "" {
		return nil
	}
	if num, ok := parsePhone(value); ok {
		fl.Field().SetString(phonenumbers.Format(num, phonenumbers.E164))
	}
	return nil
}
