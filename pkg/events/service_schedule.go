package events

import (
	"context"

	"github.com/pkg/errors"
	"github.com/robinjoseph08/robinandmadeline.com/pkg/models"
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
