// Package photogroups is the API and data layer for photo groups: the
// photographer's shot list (named sets of guests needed together for a photo,
// in one global shooting order, taken in the session between the ceremony and
// the reception) and the assignments of guests into those groups. It owns
// every photo_groups / photo_group_assignments write through the admin
// surface, plus the guest-facing read (GET /api/guest/photo-groups) that
// shows a party which of its guests are in which groups. The persistent
// models live in pkg/models; this package owns the service, request/response
// types (types.go), and HTTP handlers.
package photogroups

import (
	"context"
	"database/sql"
	"time"

	"github.com/google/uuid"
	"github.com/pkg/errors"
	"github.com/robinjoseph08/robinandmadeline.com/pkg/errcodes"
	"github.com/robinjoseph08/robinandmadeline.com/pkg/models"
	"github.com/uptrace/bun"
)

// Service is the photo-groups data layer over a Bun DB. Construct it with
// NewService. Methods return errcodes errors directly; handlers pass them
// through to the shared error handler.
type Service struct {
	db *bun.DB
}

// NewService builds a Service backed by the given Bun DB.
func NewService(db *bun.DB) *Service {
	return &Service{db: db}
}

// newID returns a fresh UUIDv7 string. v7 is time-ordered, which keeps inserts
// index-friendly and makes IDs roughly sortable by creation time.
func newID() string {
	return uuid.Must(uuid.NewV7()).String()
}

// loadGroup fetches a photo group within a query context (the receiver may be
// the DB or a transaction). Returns a 404 when the group does not exist.
func loadGroup(ctx context.Context, db bun.IDB, id string) (*models.PhotoGroup, error) {
	group := new(models.PhotoGroup)
	err := db.NewSelect().Model(group).Where("pg.id = ?", id).Scan(ctx)
	if err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return nil, errcodes.NotFound("photo group")
		}
		return nil, errors.Wrap(err, "load photo group")
	}
	return group, nil
}

// CreatePhotoGroup inserts a photo group at the end of the shooting order
// (sort_order = current max + 1, so the first group is 1). The max read and
// the insert share a transaction, but under READ COMMITTED two concurrent
// creates can still both read the same max and claim the same raw position;
// that is harmless, because every read ranks by (sort_order, id) rather than
// trusting the raw values. The payload is already bound, trimmed, and
// validated by the binder.
func (s *Service) CreatePhotoGroup(ctx context.Context, in CreatePhotoGroupPayload) (*models.PhotoGroup, error) {
	now := time.Now()
	group := &models.PhotoGroup{
		ID:        newID(),
		Name:      in.Name,
		CreatedAt: now,
		UpdatedAt: now,
	}

	err := s.db.RunInTx(ctx, &sql.TxOptions{}, func(ctx context.Context, tx bun.Tx) error {
		var maxSortOrder int
		err := tx.NewSelect().Model((*models.PhotoGroup)(nil)).
			ColumnExpr("COALESCE(MAX(sort_order), 0)").
			Scan(ctx, &maxSortOrder)
		if err != nil {
			return errors.Wrap(err, "read max sort order")
		}
		group.SortOrder = maxSortOrder + 1

		if _, err := tx.NewInsert().Model(group).Exec(ctx); err != nil {
			return errors.Wrap(err, "insert photo group")
		}
		return nil
	})
	if err != nil {
		return nil, err
	}
	return group, nil
}

// UpdatePhotoGroup applies the editable fields (the name) to an existing
// photo group (PUT-style). A missing group is a 404. The sort order never
// changes here: positions change only through ReorderPhotoGroups.
func (s *Service) UpdatePhotoGroup(ctx context.Context, id string, in UpdatePhotoGroupPayload) (*models.PhotoGroup, error) {
	group, err := loadGroup(ctx, s.db, id)
	if err != nil {
		return nil, err
	}

	group.Name = in.Name
	group.UpdatedAt = time.Now()

	res, err := s.db.NewUpdate().Model(group).
		Column("name", "updated_at").
		WherePK().Exec(ctx)
	if err != nil {
		return nil, errors.Wrap(err, "update photo group")
	}
	n, err := res.RowsAffected()
	if err != nil {
		return nil, errors.Wrap(err, "update photo group rows affected")
	}
	if n == 0 {
		// The group vanished between the load and the write; a 200 carrying the
		// "renamed" group would be a lie.
		return nil, errcodes.NotFound("photo group")
	}
	return group, nil
}

// DeletePhotoGroup removes a photo group; its assignments go via the FK
// cascade. Deleting a non-existent group returns a 404. Remaining groups keep
// their sort_order (a gap is harmless: reads rank by sort_order rather than
// trusting the raw value).
func (s *Service) DeletePhotoGroup(ctx context.Context, id string) error {
	res, err := s.db.NewDelete().Model((*models.PhotoGroup)(nil)).Where("id = ?", id).Exec(ctx)
	if err != nil {
		return errors.Wrap(err, "delete photo group")
	}
	n, err := res.RowsAffected()
	if err != nil {
		return errors.Wrap(err, "delete photo group rows affected")
	}
	if n == 0 {
		return errcodes.NotFound("photo group")
	}
	return nil
}

// ReorderPhotoGroups rewrites the shooting order: the payload's id sequence
// becomes sort_order 1..n. The ids must be exactly the existing groups (every
// one, no extras, no duplicates; 422 otherwise), so a reorder can never
// silently drop or duplicate a position; the whole rewrite is one
// transaction.
func (s *Service) ReorderPhotoGroups(ctx context.Context, in ReorderPhotoGroupsPayload) error {
	return s.db.RunInTx(ctx, &sql.TxOptions{}, func(ctx context.Context, tx bun.Tx) error {
		var existingIDs []string
		err := tx.NewSelect().Model((*models.PhotoGroup)(nil)).Column("id").
			Scan(ctx, &existingIDs)
		if err != nil {
			return errors.Wrap(err, "list photo group ids")
		}

		if !sameIDSet(in.PhotoGroupIDs, existingIDs) {
			return errcodes.ValidationError("The new order must list every photo group exactly once.")
		}

		now := time.Now()
		for i, id := range in.PhotoGroupIDs {
			_, err := tx.NewUpdate().Model((*models.PhotoGroup)(nil)).
				Set("sort_order = ?", i+1).
				Set("updated_at = ?", now).
				Where("id = ?", id).
				Exec(ctx)
			if err != nil {
				return errors.Wrap(err, "update photo group sort order")
			}
		}
		return nil
	})
}

// sameIDSet reports whether ids is exactly the set want: the same length, no
// duplicates, and every element present in want.
func sameIDSet(ids, want []string) bool {
	if len(ids) != len(want) {
		return false
	}
	wantSet := make(map[string]struct{}, len(want))
	for _, id := range want {
		wantSet[id] = struct{}{}
	}
	seen := make(map[string]struct{}, len(ids))
	for _, id := range ids {
		if _, ok := wantSet[id]; !ok {
			return false
		}
		if _, dup := seen[id]; dup {
			return false
		}
		seen[id] = struct{}{}
	}
	return true
}

// ListPhotoGroups returns every photo group and the total count, in shooting
// order (sort_order, then id as a stable tiebreak). The list is wedding-sized
// (tens of groups at most), so it takes no filters.
func (s *Service) ListPhotoGroups(ctx context.Context) ([]*models.PhotoGroup, int, error) {
	var list []*models.PhotoGroup
	total, err := s.db.NewSelect().Model(&list).
		Order("pg.sort_order ASC", "pg.id ASC").
		ScanAndCount(ctx)
	if err != nil {
		return nil, 0, errors.Wrap(err, "list photo groups")
	}
	return list, total, nil
}

// AssignmentsForGroups returns every assignment for the given groups in one
// query, keyed by photo group id, each with its Guest and the guest's Party
// loaded for the response's name/party context. Members are ordered by when
// they were added (then guest id as a stable tiebreak) so a group's list never
// reshuffles. A group with no members maps to no entry; with no group ids it
// returns an empty map.
func (s *Service) AssignmentsForGroups(ctx context.Context, groupIDs []string) (map[string][]*models.PhotoGroupAssignment, error) {
	byGroup := make(map[string][]*models.PhotoGroupAssignment, len(groupIDs))
	if len(groupIDs) == 0 {
		return byGroup, nil
	}

	var rows []*models.PhotoGroupAssignment
	err := s.db.NewSelect().Model(&rows).
		Relation("Guest").Relation("Guest.Party").
		Where("pga.photo_group_id IN (?)", bun.List(groupIDs)).
		Order("pga.created_at ASC", "pga.guest_id ASC").
		Scan(ctx)
	if err != nil {
		return nil, errors.Wrap(err, "list photo group assignments")
	}
	for _, r := range rows {
		byGroup[r.PhotoGroupID] = append(byGroup[r.PhotoGroupID], r)
	}
	return byGroup, nil
}
