package emails

import (
	"context"
	"time"

	"github.com/pkg/errors"
	"github.com/robinjoseph08/robinandmadeline.com/pkg/models"
	"github.com/uptrace/bun"
)

// The daily send budget (Mailgun's free plan: a hard cap per day, resetting at
// midnight UTC, with no API to query usage). The durable record is
// email_recipients.attempted_at, set when the worker claims a row for
// dispatch; counting rows attempted since UTC midnight is today's spend. The
// count deliberately includes attempts Mailgun rejected (overcounting just
// pushes work to tomorrow; undercounting causes rejected sends) and only
// covers this app's sends. Manual sends from the Mailgun dashboard are
// invisible to it, which is what the worker's quota-rejection pause defends
// against.

// startOfUTCDay is the UTC midnight beginning the day t falls in, the budget
// window's lower bound (Mailgun's quota resets at midnight UTC).
func startOfUTCDay(t time.Time) time.Time {
	return t.UTC().Truncate(24 * time.Hour)
}

// nextUTCMidnight is the UTC midnight ending the day t falls in: when the
// budget (and Mailgun's quota) next resets.
func nextUTCMidnight(t time.Time) time.Time {
	return startOfUTCDay(t).Add(24 * time.Hour)
}

// countAttemptsSince counts dispatch attempts recorded at or after the given
// boundary, regardless of the row's current status: a row attempted today and
// already requeued for tomorrow still spent one of today's slots.
func countAttemptsSince(ctx context.Context, db bun.IDB, since time.Time) (int, error) {
	count, err := db.NewSelect().Model((*models.EmailRecipient)(nil)).
		Where("erc.attempted_at >= ?", since).
		Count(ctx)
	if err != nil {
		return 0, errors.Wrap(err, "count attempted email recipients")
	}
	return count, nil
}
