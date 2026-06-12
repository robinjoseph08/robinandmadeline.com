package emails

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"strings"
	"time"

	"github.com/pkg/errors"
)

// Message is one rendered outbound email, ready for the Mailgun send API.
type Message struct {
	From    string
	To      string
	Subject string
	Text    string
	// RecipientID is the email_recipients row id, attached to the Mailgun
	// message as a custom variable so a restart can reconcile a stuck
	// `sending` row against Mailgun's event log without sending a duplicate
	// (ADR 0004).
	RecipientID string
}

// RejectionError marks a send Mailgun definitively rejected: a response came
// back and it was not a 2xx, so the message was provably never accepted and
// the row can be marked failed without risking a lost delivery. Every other
// send error (timeout, connection reset, an unreadable or unparseable
// response to what may have been a 2xx) is ambiguous: Mailgun may have
// accepted the message anyway, so the worker leaves the row `sending` for the
// reconciler to settle against Mailgun's event log instead.
type RejectionError struct {
	StatusCode int
	Body       string
}

func (e *RejectionError) Error() string {
	return fmt.Sprintf("mailgun send failed: status %d: %s", e.StatusCode, e.Body)
}

// MailgunClient is the seam between the queue and Mailgun. The Worker depends
// on this interface; production wires the HTTP implementation below and tests
// substitute a fake, so no test ever calls the real Mailgun API.
type MailgunClient interface {
	// Send submits one message and returns the Mailgun message id (normalized,
	// without angle brackets) on acceptance. A definitive rejection is returned
	// as a *RejectionError; any other error means the outcome is unknown.
	Send(ctx context.Context, msg Message) (string, error)
	// FindAcceptedMessageID reports whether Mailgun already accepted a message
	// for the given email_recipients row id (matched via the recipient_id
	// custom variable on recent events for that address), returning its
	// message id when found. The restart reconciliation uses it to decide
	// between marking a stuck row sent and retrying it.
	FindAcceptedMessageID(ctx context.Context, recipientID, recipientEmail string) (string, bool, error)
}

// HTTPMailgunClient is the production MailgunClient over Mailgun's REST API.
type HTTPMailgunClient struct {
	baseURL string
	domain  string
	apiKey  string
	client  *http.Client
}

// NewMailgunClient builds an HTTPMailgunClient. baseURL is Mailgun's API
// origin (https://api.mailgun.net, overridable for tests and an EU domain),
// domain the sending domain, apiKey the private API key.
func NewMailgunClient(baseURL, domain, apiKey string) *HTTPMailgunClient {
	return &HTTPMailgunClient{
		baseURL: strings.TrimSuffix(baseURL, "/"),
		domain:  domain,
		apiKey:  apiKey,
		// A bounded timeout so one hung call can never stall the queue, and in
		// particular never extends the finish-current-batch shutdown window
		// indefinitely.
		client: &http.Client{Timeout: 15 * time.Second},
	}
}

// Send submits the message via POST /v3/{domain}/messages.
func (c *HTTPMailgunClient) Send(ctx context.Context, msg Message) (string, error) {
	form := url.Values{}
	form.Set("from", msg.From)
	form.Set("to", msg.To)
	form.Set("subject", msg.Subject)
	form.Set("text", msg.Text)
	form.Set("v:recipient_id", msg.RecipientID)

	endpoint := fmt.Sprintf("%s/v3/%s/messages", c.baseURL, c.domain)
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, endpoint, strings.NewReader(form.Encode()))
	if err != nil {
		return "", errors.Wrap(err, "build mailgun send request")
	}
	req.Header.Set("Content-Type", "application/x-www-form-urlencoded")
	req.SetBasicAuth("api", c.apiKey)

	resp, err := c.client.Do(req)
	if err != nil {
		return "", errors.Wrap(err, "call mailgun send")
	}
	defer func() { _ = resp.Body.Close() }()

	body, err := io.ReadAll(io.LimitReader(resp.Body, 1<<20))
	if err != nil {
		return "", errors.Wrap(err, "read mailgun send response")
	}
	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		return "", errors.WithStack(&RejectionError{StatusCode: resp.StatusCode, Body: strings.TrimSpace(string(body))})
	}

	var parsed struct {
		ID string `json:"id"`
	}
	if err := json.Unmarshal(body, &parsed); err != nil {
		return "", errors.Wrap(err, "parse mailgun send response")
	}
	if parsed.ID == "" {
		return "", errors.New("mailgun send response carried no message id")
	}
	return normalizeMessageID(parsed.ID), nil
}

// FindAcceptedMessageID scans recent `accepted` events for the address via
// GET /v3/{domain}/events and matches our recipient_id custom variable.
// Mailgun's events API cannot filter by user variable directly, so the
// recipient filter narrows the scan and the variable is matched client-side.
func (c *HTTPMailgunClient) FindAcceptedMessageID(ctx context.Context, recipientID, recipientEmail string) (string, bool, error) {
	query := url.Values{}
	query.Set("event", "accepted")
	query.Set("recipient", recipientEmail)
	query.Set("limit", "300")

	endpoint := fmt.Sprintf("%s/v3/%s/events?%s", c.baseURL, c.domain, query.Encode())
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, endpoint, nil)
	if err != nil {
		return "", false, errors.Wrap(err, "build mailgun events request")
	}
	req.SetBasicAuth("api", c.apiKey)

	resp, err := c.client.Do(req)
	if err != nil {
		return "", false, errors.Wrap(err, "call mailgun events")
	}
	defer func() { _ = resp.Body.Close() }()

	body, err := io.ReadAll(io.LimitReader(resp.Body, 4<<20))
	if err != nil {
		return "", false, errors.Wrap(err, "read mailgun events response")
	}
	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		return "", false, errors.Errorf("mailgun events failed: status %d: %s", resp.StatusCode, strings.TrimSpace(string(body)))
	}

	var parsed struct {
		Items []struct {
			Message struct {
				Headers struct {
					MessageID string `json:"message-id"`
				} `json:"headers"`
			} `json:"message"`
			UserVariables map[string]any `json:"user-variables"`
		} `json:"items"`
	}
	if err := json.Unmarshal(body, &parsed); err != nil {
		return "", false, errors.Wrap(err, "parse mailgun events response")
	}
	for _, item := range parsed.Items {
		if id, ok := item.UserVariables["recipient_id"].(string); ok && id == recipientID {
			return normalizeMessageID(item.Message.Headers.MessageID), true, nil
		}
	}
	return "", false, nil
}

// normalizeMessageID strips the angle brackets the send API wraps around
// message ids; webhook and event payloads carry the bare form, and storing one
// canonical shape keeps the webhook's lookup a plain equality match.
func normalizeMessageID(id string) string {
	return strings.TrimSuffix(strings.TrimPrefix(id, "<"), ">")
}
