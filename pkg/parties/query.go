package parties

import (
	"strconv"

	"github.com/labstack/echo/v4"
)

// queryStrPtr returns a pointer to the named query parameter's value, or nil
// when the parameter is absent. An explicitly empty value (e.g. "?side=") is
// treated as absent, since a blank filter has no meaning.
func queryStrPtr(c echo.Context, name string) *string {
	v := c.QueryParam(name)
	if v == "" {
		return nil
	}
	return &v
}

// queryBoolPtr returns a pointer to the named query parameter parsed as a bool,
// or nil when absent or unparseable. Accepting only valid bools (via
// strconv.ParseBool, which handles true/false/1/0) means a malformed value
// safely degrades to "no filter" rather than erroring the whole list request.
func queryBoolPtr(c echo.Context, name string) *bool {
	v := c.QueryParam(name)
	if v == "" {
		return nil
	}
	b, err := strconv.ParseBool(v)
	if err != nil {
		return nil
	}
	return &b
}
