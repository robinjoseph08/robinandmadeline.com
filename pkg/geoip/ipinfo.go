// Package geoip looks up the approximate location and network owner of an IP
// address through ipinfo.io.
//
// It calls ipinfo's original /{ip}/json endpoint, which still returns city,
// region, and org without a token (at a low, undocumented rate limit). A free
// ipinfo account token moves requests onto the "Lite" plan, which drops city
// and region, so the token is optional and only worth setting for a paid plan.
package geoip

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"net/netip"
	"net/url"
	"strconv"
	"strings"
	"time"

	"github.com/pkg/errors"
)

// DefaultBaseURL is ipinfo's API origin.
const DefaultBaseURL = "https://ipinfo.io"

// requestTimeout bounds one lookup so a hung ipinfo never stalls the resolver.
const requestTimeout = 10 * time.Second

// defaultRetryAfter is how long to back off after a 429 that carries no usable
// Retry-After header. ipinfo's anonymous limit is undocumented, so an hour is a
// conservative guess that still lets the backlog drain the same day.
const defaultRetryAfter = time.Hour

// maxRetryAfter caps a server-provided Retry-After so a bogus value can never
// park lookups for days.
const maxRetryAfter = 24 * time.Hour

// Location is what a lookup learned about one IP. Every field may be blank.
type Location struct {
	City    string
	Region  string
	Country string
	// Org is the network owner, prefixed with its ASN (e.g. "AS7922 Comcast
	// Cable Communications, LLC").
	Org string
}

// Client looks up IP locations.
type Client interface {
	Lookup(ctx context.Context, ip string) (Location, error)
}

// RateLimitedError reports a 429 from ipinfo. Callers should stop looking up
// IPs until RetryAfter has elapsed.
type RateLimitedError struct {
	RetryAfter time.Duration
}

func (e *RateLimitedError) Error() string {
	return fmt.Sprintf("ipinfo rate limited; retry after %s", e.RetryAfter)
}

// UnresolvableError reports that ipinfo rejected this specific IP (a 4xx other
// than 429). Retrying the same IP will not help, so callers should record it as
// looked up with no location.
type UnresolvableError struct {
	Status int
}

func (e *UnresolvableError) Error() string {
	return fmt.Sprintf("ipinfo cannot resolve this ip (status %d)", e.Status)
}

// IPInfoClient is the ipinfo.io implementation of Client.
type IPInfoClient struct {
	baseURL string
	token   string
	http    *http.Client
}

// NewIPInfoClient builds a client against baseURL (DefaultBaseURL in
// production). token may be blank for anonymous lookups.
func NewIPInfoClient(baseURL, token string) *IPInfoClient {
	return &IPInfoClient{
		baseURL: strings.TrimRight(baseURL, "/"),
		token:   token,
		http:    &http.Client{Timeout: requestTimeout},
	}
}

type ipinfoResponse struct {
	City    string `json:"city"`
	Region  string `json:"region"`
	Country string `json:"country"`
	Org     string `json:"org"`
}

// Lookup resolves one IP. It returns a *RateLimitedError on a 429, an
// *UnresolvableError when ipinfo rejects the IP itself, and a plain error for
// anything transient (network failures, 5xx, a malformed body).
func (c *IPInfoClient) Lookup(ctx context.Context, ip string) (Location, error) {
	u := c.baseURL + "/" + url.PathEscape(ip) + "/json"
	if c.token != "" {
		u += "?token=" + url.QueryEscape(c.token)
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, u, nil)
	if err != nil {
		return Location{}, errors.Wrap(err, "build ipinfo request")
	}
	req.Header.Set("Accept", "application/json")

	resp, err := c.http.Do(req)
	if err != nil {
		// A *url.Error repeats the request URL, which may carry the token, so
		// keep only the underlying cause.
		var urlErr *url.Error
		if errors.As(err, &urlErr) {
			err = urlErr.Err
		}
		return Location{}, errors.Wrap(err, "ipinfo request failed")
	}
	defer func() { _ = resp.Body.Close() }()

	switch {
	case resp.StatusCode == http.StatusTooManyRequests:
		return Location{}, &RateLimitedError{RetryAfter: parseRetryAfter(resp.Header.Get("Retry-After"), time.Now())}
	case resp.StatusCode >= 400 && resp.StatusCode < 500:
		return Location{}, &UnresolvableError{Status: resp.StatusCode}
	case resp.StatusCode != http.StatusOK:
		return Location{}, errors.Errorf("ipinfo returned status %d", resp.StatusCode)
	}

	var body ipinfoResponse
	if err := json.NewDecoder(resp.Body).Decode(&body); err != nil {
		return Location{}, errors.Wrap(err, "decode ipinfo response")
	}
	return Location{
		City:    strings.TrimSpace(body.City),
		Region:  strings.TrimSpace(body.Region),
		Country: strings.TrimSpace(body.Country),
		Org:     strings.TrimSpace(body.Org),
	}, nil
}

// parseRetryAfter reads a Retry-After header in either of its forms (delay
// seconds or an HTTP date), falling back to defaultRetryAfter and capping at
// maxRetryAfter.
func parseRetryAfter(header string, now time.Time) time.Duration {
	header = strings.TrimSpace(header)
	wait := defaultRetryAfter
	if secs, err := strconv.Atoi(header); err == nil && secs > 0 {
		wait = time.Duration(secs) * time.Second
	} else if at, err := http.ParseTime(header); err == nil && at.After(now) {
		wait = at.Sub(now)
	}
	return min(wait, maxRetryAfter)
}

// IsPublic reports whether ip is a routable public address worth looking up.
// Loopback, private, link-local, and other reserved ranges (local dev, tests)
// have no meaningful location.
func IsPublic(ip string) bool {
	addr, err := netip.ParseAddr(ip)
	if err != nil {
		return false
	}
	addr = addr.Unmap()
	return addr.IsGlobalUnicast() && !addr.IsPrivate()
}
