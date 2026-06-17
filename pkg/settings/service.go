// Package settings is the admin read/write side of the site-wide app_settings
// table: the API the dashboard uses to read and update the RSVP deadline and
// contact email. The persistent model (and its well-known keys) live in
// pkg/models; the guest-facing readers (pkg/rsvps) only read these keys, while
// this package owns the admin writes. There is one row per key; an absent row
// is a valid "unset" state (no deadline, no contact email).
package settings

import (
	"context"

	"github.com/pkg/errors"
	"github.com/robinjoseph08/golib/pointerutil"
	"github.com/robinjoseph08/robinandmadeline.com/pkg/models"
	"github.com/uptrace/bun"
)

// Service is the app_settings data layer over a Bun DB. Construct it with
// NewService. Methods return errcodes errors directly; handlers pass them
// through to the shared error handler.
type Service struct {
	db *bun.DB
}

// NewService builds a Service backed by the given Bun DB.
func NewService(db *bun.DB) *Service {
	return &Service{db: db}
}

// settingKeys is the set of well-known keys the admin settings surface reads
// and writes. Keeping it in one place keeps Get's IN-query and the response
// projection in sync.
var settingKeys = []string{models.AppSettingRSVPDeadline, models.AppSettingContactEmail}

// Get reads the current app settings as the response shape. A missing row maps
// to a nil field (the unset state), so an empty table returns a response with
// every field nil rather than an error.
func (s *Service) Get(ctx context.Context) (*Response, error) {
	return load(ctx, s.db)
}

// load reads the well-known settings rows over any query context and projects
// them onto the response shape. It mirrors the read in pkg/rsvps.loadSettings
// (an IN-query over the keys, an absent row is valid) and is the single place
// both Get and Update read from, so a PUT can return the refreshed state from
// inside its own transaction.
func load(ctx context.Context, db bun.IDB) (*Response, error) {
	var rows []*models.AppSetting
	err := db.NewSelect().Model(&rows).
		Where("key IN (?)", bun.List(settingKeys)).
		Scan(ctx)
	if err != nil {
		return nil, errors.Wrap(err, "load app settings")
	}

	resp := new(Response)
	for _, row := range rows {
		switch row.Key {
		case models.AppSettingRSVPDeadline:
			resp.RSVPDeadline = pointerutil.String(row.Value)
		case models.AppSettingContactEmail:
			resp.ContactEmail = pointerutil.String(row.Value)
		}
	}
	return resp, nil
}

// Update applies a partial settings change and returns the refreshed state. For
// each field: nil leaves the setting untouched, a non-blank value upserts the
// row, and a blank value (the binder has already trimmed it) deletes the row,
// returning the setting to its unset state. The writes run in one transaction
// so a multi-field save is all-or-nothing, and the refreshed read happens
// inside it so the response reflects exactly what was written.
//
// The payload is already validated by the binder (a malformed rsvp_deadline or
// contact_email is a 422 before reaching here), so this method only persists.
func (s *Service) Update(ctx context.Context, in UpdateSettingsPayload) (*Response, error) {
	resp := new(Response)
	err := s.db.RunInTx(ctx, nil, func(ctx context.Context, tx bun.Tx) error {
		if err := applySetting(ctx, tx, models.AppSettingRSVPDeadline, in.RSVPDeadline); err != nil {
			return err
		}
		if err := applySetting(ctx, tx, models.AppSettingContactEmail, in.ContactEmail); err != nil {
			return err
		}

		refreshed, err := load(ctx, tx)
		if err != nil {
			return err
		}
		*resp = *refreshed
		return nil
	})
	if err != nil {
		return nil, err
	}
	return resp, nil
}

// applySetting writes one setting inside the caller's transaction: nil leaves
// the row untouched, a blank value deletes it (clearing the setting), and a
// non-blank value upserts it (insert, or update value on key conflict).
func applySetting(ctx context.Context, tx bun.Tx, key string, value *string) error {
	if value == nil {
		return nil
	}
	if *value == "" {
		_, err := tx.NewDelete().Model((*models.AppSetting)(nil)).
			Where("key = ?", key).Exec(ctx)
		if err != nil {
			return errors.Wrapf(err, "clear setting %q", key)
		}
		return nil
	}

	row := &models.AppSetting{Key: key, Value: *value}
	_, err := tx.NewInsert().Model(row).
		On("CONFLICT (key) DO UPDATE").
		Set("value = EXCLUDED.value").
		Exec(ctx)
	if err != nil {
		return errors.Wrapf(err, "upsert setting %q", key)
	}
	return nil
}
