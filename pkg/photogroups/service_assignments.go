package photogroups

import (
	"context"
	"time"

	"github.com/pkg/errors"
	"github.com/robinjoseph08/robinandmadeline.com/pkg/errcodes"
	"github.com/robinjoseph08/robinandmadeline.com/pkg/models"
)

// AddGuest adds one guest to a photo group. A missing group is a 404 (the
// path names it); an unknown guest_id is a 422 (the payload names it). Adding
// a guest already in the group is an idempotent no-op (ON CONFLICT on the
// composite primary key), so a double-click can never error or duplicate.
// Returns the group so the handler can respond with its refreshed members.
func (s *Service) AddGuest(ctx context.Context, groupID string, in AddPhotoGroupGuestPayload) (*models.PhotoGroup, error) {
	group, err := loadGroup(ctx, s.db, groupID)
	if err != nil {
		return nil, err
	}

	exists, err := s.db.NewSelect().Model((*models.Guest)(nil)).Where("id = ?", in.GuestID).Exists(ctx)
	if err != nil {
		return nil, errors.Wrap(err, "check guest exists")
	}
	if !exists {
		return nil, errcodes.ValidationError("That guest does not exist.")
	}

	row := &models.PhotoGroupAssignment{
		PhotoGroupID: group.ID,
		GuestID:      in.GuestID,
		CreatedAt:    time.Now(),
	}
	_, err = s.db.NewInsert().Model(row).
		On("CONFLICT (photo_group_id, guest_id) DO NOTHING").
		Exec(ctx)
	if err != nil {
		return nil, errors.Wrap(err, "insert photo group assignment")
	}
	return group, nil
}

// RemoveGuest removes one guest from a photo group. A guest with no
// membership in the group is a 404: there is nothing to remove (and a typo'd
// id should surface, not silently succeed).
func (s *Service) RemoveGuest(ctx context.Context, groupID, guestID string) error {
	res, err := s.db.NewDelete().Model((*models.PhotoGroupAssignment)(nil)).
		Where("photo_group_id = ?", groupID).Where("guest_id = ?", guestID).
		Exec(ctx)
	if err != nil {
		return errors.Wrap(err, "delete photo group assignment")
	}
	n, err := res.RowsAffected()
	if err != nil {
		return errors.Wrap(err, "delete photo group assignment rows affected")
	}
	if n == 0 {
		return errcodes.NotFound("photo group assignment")
	}
	return nil
}
