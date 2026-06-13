package emails

import (
	"context"

	"github.com/pkg/errors"
	"github.com/robinjoseph08/golib/pointerutil"
	"github.com/robinjoseph08/robinandmadeline.com/pkg/errcodes"
	"github.com/robinjoseph08/robinandmadeline.com/pkg/models"
)

// SendTest renders the draft through the SAME HTML shell pipeline as a real
// send and dispatches it synchronously to every configured test recipient (the
// couple's own inboxes, EMAIL_TEST_RECIPIENTS), so the couple can eyeball the
// email. It is a design aid, deliberately different from a real send in three
// ways:
//
//   - It renders against a fully-populated SAMPLE merge context (sample guest,
//     party, RSVP code, and links), so every merge field always resolves and the
//     email renders complete. The item-2 emptiness validation does NOT gate it:
//     the data is sample by design, not the real audience.
//   - It creates NO email_sends or email_recipients rows and never touches the
//     daily-budget counter (attempted_at); it is ephemeral.
//   - It sends through the injected test-send MailgunClient, synchronously,
//     rather than enqueueing for the worker.
//
// When a real event is selected in the filter, that event drives the event
// merge fields (so the admin can preview real copy); otherwise a sample event
// is used. A 422 results when no test recipients are configured or when Mailgun
// is off (no client).
func (s *Service) SendTest(ctx context.Context, in TestEmailPayload) (*TestEmailResponse, error) {
	if s.mailgunClient == nil {
		return nil, errcodes.ValidationError("Email sending is not configured.")
	}
	if len(s.testRecipients) == 0 {
		return nil, errcodes.ValidationError("No test recipients are configured.")
	}

	// Use the filter's real event when one is selected, so the test shows the
	// real event copy; otherwise fall back to a sample event.
	event, err := s.filterEvent(ctx, in.Filter)
	if err != nil {
		return nil, err
	}
	if event == nil {
		event = sampleEvent()
	}

	mctx := MergeContext{
		Guest:         sampleGuest(),
		Party:         sampleParty(),
		Event:         event,
		PublicBaseURL: s.publicBaseURL,
	}
	subject := Render(in.Subject, mctx)
	text := Render(in.Body, mctx)
	html := RenderEmail(in.Subject, in.Body, mctx)

	for _, to := range s.testRecipients {
		if _, err := s.mailgunClient.Send(ctx, Message{
			From:    s.emailFrom,
			To:      to,
			Subject: subject,
			Text:    text,
			HTML:    html,
			// No recipient_id: a test send creates no email_recipients row, so
			// there is nothing for the reconciler to match against.
		}); err != nil {
			return nil, errors.Wrap(err, "send test email")
		}
	}
	return &TestEmailResponse{SentTo: len(s.testRecipients)}, nil
}

// The sample merge entities the test send renders against, so every field
// resolves to a realistic value and the preview email is never blank.

func sampleGuest() *models.Guest {
	return &models.Guest{FullName: "Alex Sample"}
}

func sampleParty() *models.Party {
	return &models.Party{
		Name:      "The Sample Party",
		InfoToken: "sampletoken",
		RSVPCode:  pointerutil.String("SAMPL"),
	}
}

func sampleEvent() *models.Event {
	return &models.Event{Name: "Sample Reception", Date: "2026-10-17"}
}
