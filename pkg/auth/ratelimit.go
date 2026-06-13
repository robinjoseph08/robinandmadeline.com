package auth

import (
	"time"

	"github.com/labstack/echo/v4"
	"github.com/labstack/echo/v4/middleware"
	"github.com/robinjoseph08/robinandmadeline.com/pkg/errcodes"
	"golang.org/x/time/rate"
)

// RateLimit configures the shared per-IP login rate limiter: a sustained
// attempts-per-minute rate plus a small burst that absorbs a guest fumbling
// their code. It is the compensating control for the deliberately low-entropy,
// memorable RSVP codes (ADR 0006 / ADR 0003): no CAPTCHA, no account lockout,
// just a throttle at the door.
type RateLimit struct {
	PerMinute float64
	Burst     int
}

// loginRateLimiter builds the Echo middleware enforcing rl per client IP,
// returning 429 (as the standard error envelope) once the budget is spent.
//
// The store is in process memory, which is sufficient despite scale-to-zero:
// during an attack the container stays warm under the attacker's own traffic,
// and with no traffic there is nothing to limit (ADR 0006). One store backs
// both login endpoints, so guest and admin attempts draw from the same per-IP
// budget. The identifier is Echo's RealIP, fed by the server's IPExtractor:
// Fly's forwarded client-IP header when TRUST_PROXY_HEADERS is set, the
// socket peer address otherwise.
func loginRateLimiter(rl RateLimit) echo.MiddlewareFunc {
	store := middleware.NewRateLimiterMemoryStoreWithConfig(middleware.RateLimiterMemoryStoreConfig{
		Rate:  rate.Limit(rl.PerMinute / 60.0),
		Burst: rl.Burst,
		// Idle visitor buckets are evicted after a few minutes; rate-limit state
		// is ephemeral by nature, so this only bounds memory, not enforcement.
		ExpiresIn: 3 * time.Minute,
	})
	return middleware.RateLimiterWithConfig(middleware.RateLimiterConfig{
		Store: store,
		DenyHandler: func(_ echo.Context, _ string, _ error) error {
			return errcodes.TooManyRequests("Too many login attempts. Please wait a minute and try again.")
		},
		ErrorHandler: func(_ echo.Context, err error) error {
			// Identifier extraction failing is a server-side wiring problem, not a
			// client fault; the handler masks 500 detail from the response.
			return errcodes.Internal("rate limiter identifier extraction failed: " + err.Error())
		},
	})
}
