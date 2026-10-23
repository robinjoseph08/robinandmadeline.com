package games

import (
	"context"
	"database/sql"
	"sync"
	"time"

	"github.com/pkg/errors"
	"github.com/robinjoseph08/golib/logger"
	"github.com/robinjoseph08/robinandmadeline.com/pkg/database"
	"github.com/robinjoseph08/robinandmadeline.com/pkg/geoip"
	"github.com/robinjoseph08/robinandmadeline.com/pkg/models"
	"github.com/uptrace/bun"
)

// GeoWaker asks the geo resolver to look up any sessions still missing a
// location. Wake must be cheap and nonblocking; it is called on request paths.
type GeoWaker interface {
	Wake()
}

// GeoResolverConfig tunes the resolver. Zero values take the defaults.
type GeoResolverConfig struct {
	// Pace is the pause between consecutive ipinfo calls, so a large backfill
	// trickles out instead of bursting into the anonymous rate limit. Negative
	// disables pacing (tests).
	Pace time.Duration
	// ReuseWithin is how recent another session's lookup of the same IP must be
	// to copy it instead of calling ipinfo again.
	ReuseWithin time.Duration
	// MaxConsecutiveFailures stops an activation after this many transient
	// failures in a row, so an ipinfo outage is not hammered once per IP.
	MaxConsecutiveFailures int
	// FailureCooldown is how long to skip activations after stopping for
	// consecutive failures.
	FailureCooldown time.Duration
	// RetryFailedAfter is how long a single IP whose lookup failed is skipped,
	// so a few persistently failing IPs at the front of the newest-first order
	// cannot stall every IP behind them.
	RetryFailedAfter time.Duration
	// RefusedPause is how long to stop all lookups after ipinfo refuses the
	// caller (a 401 or 403).
	RefusedPause time.Duration
	// Now returns the current time; nil means time.Now.
	Now func() time.Time
}

const (
	defaultGeoPace                   = time.Second
	defaultGeoReuseWithin            = 30 * 24 * time.Hour
	defaultGeoMaxConsecutiveFailures = 3
	defaultGeoFailureCooldown        = 5 * time.Minute
	defaultGeoRetryFailedAfter       = time.Hour
	defaultGeoRefusedPause           = time.Hour
	// geoPendingLimit bounds one activation's work. At wedding scale the whole
	// backlog fits; anything beyond it is picked up by the next wake.
	geoPendingLimit = 500
)

// GeoResolver fills in the IP location columns on game_sessions in the
// background. It never polls: only Wake starts an activation (a new session,
// or an admin viewing the sessions list), so an idle machine never touches the
// database on its own. Each activation looks up every distinct pending IP once,
// newest first, then exits. A session whose lookup did not finish stays pending
// (ip_geo_looked_up_at NULL), so the next wake retries it; that is also how
// rows created before this feature existed get backfilled.
//
// A 429 from ipinfo pauses the resolver until the Retry-After elapses, and a
// 401 or 403 pauses it for RefusedPause; wakes during a pause return without
// touching the database or ipinfo. The pause lives in memory, so a cold boot
// forgets it and spends at most one request to rediscover it.
type GeoResolver struct {
	db     *bun.DB
	client geoip.Client
	log    logger.Logger
	cfg    GeoResolverConfig

	wake    chan struct{}
	done    chan struct{}
	runOnce sync.Once

	// pausedUntil and failedAt are only touched by the Run goroutine.
	pausedUntil time.Time
	failedAt    map[string]time.Time
}

// NewGeoResolver builds a resolver. Call Run in a goroutine to start it.
func NewGeoResolver(db *bun.DB, client geoip.Client, cfg GeoResolverConfig, log logger.Logger) *GeoResolver {
	if cfg.Pace < 0 {
		cfg.Pace = 0
	} else if cfg.Pace == 0 {
		cfg.Pace = defaultGeoPace
	}
	if cfg.ReuseWithin <= 0 {
		cfg.ReuseWithin = defaultGeoReuseWithin
	}
	if cfg.MaxConsecutiveFailures <= 0 {
		cfg.MaxConsecutiveFailures = defaultGeoMaxConsecutiveFailures
	}
	if cfg.FailureCooldown <= 0 {
		cfg.FailureCooldown = defaultGeoFailureCooldown
	}
	if cfg.RetryFailedAfter <= 0 {
		cfg.RetryFailedAfter = defaultGeoRetryFailedAfter
	}
	if cfg.RefusedPause <= 0 {
		cfg.RefusedPause = defaultGeoRefusedPause
	}
	if cfg.Now == nil {
		cfg.Now = time.Now
	}
	return &GeoResolver{
		db:       db,
		client:   client,
		log:      log,
		cfg:      cfg,
		wake:     make(chan struct{}, 1),
		done:     make(chan struct{}),
		failedAt: make(map[string]time.Time),
	}
}

// Wake schedules an activation. Concurrent wakes collapse into one.
func (r *GeoResolver) Wake() {
	select {
	case r.wake <- struct{}{}:
	default:
	}
}

// Done is closed once Run returns.
func (r *GeoResolver) Done() <-chan struct{} { return r.done }

// Run serves wakes until ctx is canceled.
func (r *GeoResolver) Run(ctx context.Context) {
	r.runOnce.Do(func() {
		defer close(r.done)
		ctx = database.WithOperation(ctx, database.GeoResolverOperation())
		r.log.Info("geo resolver started")
		defer r.log.Info("geo resolver stopped")
		for {
			select {
			case <-ctx.Done():
				return
			case <-r.wake:
			}
			if ctx.Err() != nil {
				return
			}
			r.Activate(ctx)
		}
	})
}

// Activate runs one pass over the pending sessions. Run calls it per wake;
// tests call it directly.
func (r *GeoResolver) Activate(ctx context.Context) {
	if r.cfg.Now().Before(r.pausedUntil) {
		return
	}

	ips, err := r.pendingIPs(ctx)
	if err != nil {
		if ctx.Err() == nil {
			r.log.Err(err).Error("geo resolver could not list pending sessions")
		}
		return
	}

	failures := 0
	calledAPI := false
	for _, ip := range ips {
		if ctx.Err() != nil {
			return
		}
		if at, ok := r.failedAt[ip]; ok && r.cfg.Now().Sub(at) < r.cfg.RetryFailedAfter {
			continue
		}

		loc, reused, err := r.reusableLocation(ctx, ip)
		if err != nil {
			r.log.Err(err).Error("geo resolver could not check for a reusable lookup")
			return
		}
		if !reused && geoip.IsPublic(ip) {
			if calledAPI && !r.sleep(ctx, r.cfg.Pace) {
				return
			}
			calledAPI = true
			loc, err = r.client.Lookup(ctx, ip)

			var rateLimited *geoip.RateLimitedError
			var refused *geoip.RefusedError
			var unresolvable *geoip.UnresolvableError
			switch {
			case errors.As(err, &rateLimited):
				r.pausedUntil = r.cfg.Now().Add(rateLimited.RetryAfter)
				r.log.Data(logger.Data{"retry_after": rateLimited.RetryAfter.String()}).
					Warn("geo resolver rate limited by ipinfo; pausing lookups")
				return
			case errors.As(err, &refused):
				// Every IP would be refused the same way, so pause rather than
				// recording the backlog as unresolvable.
				r.pausedUntil = r.cfg.Now().Add(r.cfg.RefusedPause)
				r.log.Err(err).Data(logger.Data{"retry_after": r.cfg.RefusedPause.String()}).
					Error("geo resolver refused by ipinfo; pausing lookups")
				return
			case errors.As(err, &unresolvable):
				// Record it as looked up with no location so it is not retried.
				loc = geoip.Location{}
			case err != nil:
				if ctx.Err() != nil {
					return
				}
				failures++
				r.failedAt[ip] = r.cfg.Now()
				r.log.Err(err).Warn("geo resolver lookup failed; will retry on a later wake")
				if failures >= r.cfg.MaxConsecutiveFailures {
					r.pausedUntil = r.cfg.Now().Add(r.cfg.FailureCooldown)
					r.log.Warn("geo resolver pausing after repeated lookup failures")
					return
				}
				continue
			}
			failures = 0
			delete(r.failedAt, ip)
		}

		if err := r.store(ctx, ip, loc); err != nil {
			r.log.Err(err).Error("geo resolver could not store a lookup")
			return
		}
	}
}

// pendingIPs returns the distinct IPs of sessions not yet looked up, those
// with the newest session first so a live solver resolves ahead of the
// backfill.
func (r *GeoResolver) pendingIPs(ctx context.Context) ([]string, error) {
	var ips []string
	err := r.db.NewSelect().
		Model((*models.GameSession)(nil)).
		Column("ip_address").
		Where("ip_geo_looked_up_at IS NULL").
		Where("ip_address <> ''").
		Group("ip_address").
		OrderExpr("MAX(created_at) DESC").
		Limit(geoPendingLimit).
		Scan(ctx, &ips)
	if err != nil {
		return nil, errors.Wrap(err, "select pending geo ips")
	}
	return ips, nil
}

// reusableLocation returns another session's recent lookup of the same IP, so
// a guest who solves several times costs one ipinfo call.
func (r *GeoResolver) reusableLocation(ctx context.Context, ip string) (geoip.Location, bool, error) {
	var prior models.GameSession
	err := r.db.NewSelect().
		Model(&prior).
		Column("ip_city", "ip_region", "ip_country", "ip_org").
		Where("ip_address = ?", ip).
		Where("ip_geo_looked_up_at >= ?", r.cfg.Now().Add(-r.cfg.ReuseWithin)).
		OrderExpr("ip_geo_looked_up_at DESC").
		Limit(1).
		Scan(ctx)
	if errors.Is(err, sql.ErrNoRows) {
		return geoip.Location{}, false, nil
	}
	if err != nil {
		return geoip.Location{}, false, errors.Wrap(err, "select reusable geo lookup")
	}
	return geoip.Location{
		City:    prior.IPCity,
		Region:  prior.IPRegion,
		Country: prior.IPCountry,
		Org:     prior.IPOrg,
	}, true, nil
}

// store writes one IP's location onto every still-pending session with it.
func (r *GeoResolver) store(ctx context.Context, ip string, loc geoip.Location) error {
	_, err := r.db.NewUpdate().
		Model((*models.GameSession)(nil)).
		Set("ip_city = ?", loc.City).
		Set("ip_region = ?", loc.Region).
		Set("ip_country = ?", loc.Country).
		Set("ip_org = ?", loc.Org).
		Set("ip_geo_looked_up_at = ?", r.cfg.Now()).
		Where("ip_address = ?", ip).
		Where("ip_geo_looked_up_at IS NULL").
		Exec(ctx)
	return errors.Wrap(err, "update game session geo")
}

// sleep waits d, returning false if ctx ends first.
func (r *GeoResolver) sleep(ctx context.Context, d time.Duration) bool {
	if d <= 0 {
		return true
	}
	t := time.NewTimer(d)
	defer t.Stop()
	select {
	case <-ctx.Done():
		return false
	case <-t.C:
		return true
	}
}
