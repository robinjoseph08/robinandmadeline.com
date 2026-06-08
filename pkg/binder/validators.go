package binder

import (
	"net/mail"
	"net/url"
	"regexp"

	"github.com/go-playground/validator/v10"
)

var dateRE = regexp.MustCompile(`^\d{4}-(0[0-9]|1[0-2])-(0[0-9]|1[0-9]|2[0-9]|3[0-1])$`)

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
