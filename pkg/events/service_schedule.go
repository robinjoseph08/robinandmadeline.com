package events

import (
	"context"

	"github.com/pkg/errors"
	"github.com/robinjoseph08/robinandmadeline.com/pkg/models"
	"github.com/uptrace/bun"
)

// ScheduleEvents returns the events the guest-facing schedule shows, in
// schedule order (date, then start_time, then id, mirroring ListEvents; see
// its comment for why the string columns sort chronologically).
//
// partyID == "" is the unauthenticated request: public events only. A
// non-empty partyID (an authenticated guest's party) also includes every
// event any of that party's guests holds an Event RSVP row for; the row is
// the invitation (ADR 0002). Under that ADR's invariant every guest already
// holds a row for every public event, so keeping the public arm in the
// authenticated query broadens nothing; it guarantees the authenticated
// schedule can never show fewer events than the anonymous one. A partyID that
// matches no rows (a party deleted while a guest token for it was still live)
// therefore degrades to the public view rather than erroring.
func (s *Service) ScheduleEvents(ctx context.Context, partyID string) ([]*models.Event, int, error) {
	var list []*models.Event
	q := s.db.NewSelect().Model(&list)
	if partyID == "" {
		q = q.Where("e.is_public = TRUE")
	} else {
		q = q.Where(
			`e.is_public = TRUE OR EXISTS (
				SELECT 1 FROM event_rsvps er
				JOIN guests g ON g.id = er.guest_id
				WHERE er.event_id = e.id AND g.party_id = ?
			)`, partyID)
	}
	total, err := q.Order("e.date ASC", "e.start_time ASC", "e.id ASC").ScanAndCount(ctx)
	if err != nil {
		return nil, 0, errors.Wrap(err, "list schedule events")
	}
	return list, total, nil
}

// SchedulePhotoGroups returns, for each given event, the photo groups any of
// the party's guests is assigned to, keyed by event id and in shooting order.
// The guest token authenticates a whole party, so the schedule's view is the
// union of the party's guests' assignments.
//
// Each group carries its 1-based position in the event's shooting order and
// the event's total group count, both ranked across ALL of the event's groups
// (not just the party's): "group 3 of 12" must mean the same thing to every
// party. The rank is computed (ROW_NUMBER over sort_order, with id as the
// stable tiebreak) rather than read from sort_order, whose raw values may have
// gaps after deletes. An event with no assignments for the party maps to no
// entry; with no event ids it returns an empty map.
func (s *Service) SchedulePhotoGroups(ctx context.Context, partyID string, eventIDs []string) (map[string][]SchedulePhotoGroup, error) {
	byEvent := make(map[string][]SchedulePhotoGroup, len(eventIDs))
	if partyID == "" || len(eventIDs) == 0 {
		return byEvent, nil
	}

	var rows []struct {
		EventID  string `bun:"event_id"`
		ID       string `bun:"id"`
		Name     string `bun:"name"`
		Position int    `bun:"position"`
		Total    int    `bun:"total"`
	}
	// The window functions run in a subquery over every group of the event so
	// the party filter cannot shrink the positions or the total.
	err := s.db.NewRaw(`
		SELECT ranked.event_id, ranked.id, ranked.name, ranked.position, ranked.total
		FROM (
			SELECT pg.id, pg.event_id, pg.name,
				ROW_NUMBER() OVER (PARTITION BY pg.event_id ORDER BY pg.sort_order ASC, pg.id ASC) AS position,
				COUNT(*) OVER (PARTITION BY pg.event_id) AS total
			FROM photo_groups pg
			WHERE pg.event_id IN (?)
		) ranked
		WHERE EXISTS (
			SELECT 1 FROM photo_group_assignments pga
			JOIN guests g ON g.id = pga.guest_id
			WHERE pga.photo_group_id = ranked.id AND g.party_id = ?
		)
		ORDER BY ranked.event_id ASC, ranked.position ASC
	`, bun.List(eventIDs), partyID).Scan(ctx, &rows)
	if err != nil {
		return nil, errors.Wrap(err, "list schedule photo groups")
	}

	for _, r := range rows {
		byEvent[r.EventID] = append(byEvent[r.EventID], SchedulePhotoGroup{
			ID:       r.ID,
			Name:     r.Name,
			Position: r.Position,
			Total:    r.Total,
		})
	}
	return byEvent, nil
}
