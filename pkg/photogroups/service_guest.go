package photogroups

import (
	"context"

	"github.com/pkg/errors"
	"github.com/robinjoseph08/robinandmadeline.com/pkg/models"
	"github.com/uptrace/bun"
)

// PartyPhotoGroups returns the photo groups any of the party's guests is
// assigned to, in shooting order. The guest token authenticates a whole
// party, so the view is the union of the party's guests' assignments, and
// each group names exactly which of the party's guests are in it (GuestNames,
// in party order; another party's members in the same group never appear).
//
// Each group carries its 1-based position in the shooting order and the
// overall group count, both ranked across ALL groups (not just the party's):
// "group 3 of 12" must mean the same thing to every party. The rank is
// computed (ROW_NUMBER over sort_order, with id as the stable tiebreak)
// rather than read from sort_order, whose raw values may have gaps after
// deletes. A party with no assignments gets an empty list.
func (s *Service) PartyPhotoGroups(ctx context.Context, partyID string) ([]PartyPhotoGroup, error) {
	var rows []struct {
		ID       string `bun:"id"`
		Name     string `bun:"name"`
		Position int    `bun:"position"`
		Total    int    `bun:"total"`
	}
	// The window functions run in a subquery over every group so the party
	// filter cannot shrink the positions or the total.
	err := s.db.NewRaw(`
		SELECT ranked.id, ranked.name, ranked.position, ranked.total
		FROM (
			SELECT pg.id, pg.name,
				ROW_NUMBER() OVER (ORDER BY pg.sort_order ASC, pg.id ASC) AS position,
				COUNT(*) OVER () AS total
			FROM photo_groups pg
		) ranked
		WHERE EXISTS (
			SELECT 1 FROM photo_group_assignments pga
			JOIN guests g ON g.id = pga.guest_id
			WHERE pga.photo_group_id = ranked.id AND g.party_id = ?
		)
		ORDER BY ranked.position ASC
	`, partyID).Scan(ctx, &rows)
	if err != nil {
		return nil, errors.Wrap(err, "list party photo groups")
	}

	groups := make([]PartyPhotoGroup, 0, len(rows))
	if len(rows) == 0 {
		return groups, nil
	}

	groupIDs := make([]string, 0, len(rows))
	for _, r := range rows {
		groupIDs = append(groupIDs, r.ID)
	}

	// The party's own guests per group, in party order (created_at, then id,
	// the same order the rest of the guest-facing UI lists a party's members).
	var nameRows []struct {
		PhotoGroupID string `bun:"photo_group_id"`
		FullName     string `bun:"full_name"`
	}
	err = s.db.NewSelect().Model((*models.PhotoGroupAssignment)(nil)).
		Column("pga.photo_group_id").
		ColumnExpr("g.full_name").
		Join("JOIN guests AS g ON g.id = pga.guest_id").
		Where("pga.photo_group_id IN (?)", bun.List(groupIDs)).
		Where("g.party_id = ?", partyID).
		Order("g.created_at ASC", "g.id ASC").
		Scan(ctx, &nameRows)
	if err != nil {
		return nil, errors.Wrap(err, "list party photo group guest names")
	}
	namesByGroup := make(map[string][]string, len(groupIDs))
	for _, r := range nameRows {
		namesByGroup[r.PhotoGroupID] = append(namesByGroup[r.PhotoGroupID], r.FullName)
	}

	for _, r := range rows {
		groups = append(groups, PartyPhotoGroup{
			ID:         r.ID,
			Name:       r.Name,
			Position:   r.Position,
			Total:      r.Total,
			GuestNames: namesByGroup[r.ID],
		})
	}
	return groups, nil
}
