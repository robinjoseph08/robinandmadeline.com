package main

import (
	"bytes"
	"context"
	"fmt"
	"io"
	"mime/multipart"
	"net/http"
	"net/textproto"
	"os"
	"path/filepath"
	"strings"
	"time"

	"github.com/robinjoseph08/robinandmadeline.com/pkg/config"
	"github.com/robinjoseph08/robinandmadeline.com/pkg/emails"
)

// sender mails the editor's draft through Mailgun, so the design can be checked
// in real clients (Gmail's dark mode, Apple Mail) before anything deploys. The
// hosted images ride along as inline attachments referenced by cid:, because
// the live site does not serve them until this checkout deploys. The shell,
// From, Reply-To, and both bodies match a real send; the subject gains a
// "[Preview] " prefix, and there are no List-Unsubscribe headers or recipient
// id (there is no real guest), so Gmail's native unsubscribe control will not
// show. These sends count against Mailgun's daily quota but not the app's own
// budget count, like a send from the Mailgun dashboard.
type sender struct {
	cfg      *config.Config
	endpoint string
	to       []string
	client   *http.Client
}

// newSender returns a sender for the given recipients, or the reason sending is
// unavailable.
func newSender(cfg *config.Config, to []string) (*sender, string) {
	switch {
	case cfg.MailgunAPIKey == "" || cfg.MailgunDomain == "":
		return nil, "Set MAILGUN_API_KEY and MAILGUN_DOMAIN in .env to send previews."
	case len(to) == 0:
		return nil, "Set EMAIL_TEST_RECIPIENTS in .env (or pass --send-to) to send previews."
	}
	return &sender{
		cfg:      cfg,
		endpoint: strings.TrimSuffix(cfg.MailgunBaseURL, "/") + "/v3/" + cfg.MailgunDomain + "/messages",
		to:       to,
		client:   &http.Client{Timeout: 30 * time.Second},
	}, ""
}

// send mails the draft, rendered for the sample recipient, to every recipient.
func (s *sender) send(ctx context.Context, subject, body string) error {
	mctx := emails.SampleMergeContext(previewBaseURL)
	html := emails.RenderEmail(subject, body, mctx)

	// Swap each hosted image for an inline attachment.
	var inline []string
	entries, err := os.ReadDir("public" + emails.EmailAssetPath)
	if err != nil {
		return fmt.Errorf("read email assets: %w", err)
	}
	for _, entry := range entries {
		name := entry.Name()
		url := previewBaseURL + emails.EmailAssetPath + "/" + name
		if !strings.HasSuffix(name, ".png") || !strings.Contains(html, url) {
			continue
		}
		html = strings.ReplaceAll(html, url, "cid:"+name)
		inline = append(inline, name)
	}

	for _, to := range s.to {
		if err := s.post(ctx, to, "[Preview] "+emails.Render(subject, mctx), emails.RenderText(body, mctx), html, inline); err != nil {
			return fmt.Errorf("send to %s: %w", to, err)
		}
	}
	return nil
}

// post submits one message to Mailgun's send API as multipart form data, the
// encoding inline attachments need.
func (s *sender) post(ctx context.Context, to, subject, text, html string, inline []string) error {
	var buf bytes.Buffer
	form := multipart.NewWriter(&buf)
	fields := [][2]string{
		{"from", s.cfg.EmailFrom},
		{"h:Reply-To", s.cfg.EmailReplyTo},
		{"to", to},
		{"subject", subject},
		{"text", text},
		{"html", html},
	}
	for _, f := range fields {
		if err := form.WriteField(f[0], f[1]); err != nil {
			return err
		}
	}
	for _, name := range inline {
		data, err := os.ReadFile(filepath.Join("public"+emails.EmailAssetPath, name))
		if err != nil {
			return err
		}
		header := textproto.MIMEHeader{}
		header.Set("Content-Disposition", fmt.Sprintf(`form-data; name="inline"; filename=%q`, name))
		header.Set("Content-Type", "image/png")
		part, err := form.CreatePart(header)
		if err != nil {
			return err
		}
		if _, err := part.Write(data); err != nil {
			return err
		}
	}
	if err := form.Close(); err != nil {
		return err
	}

	// #nosec G704 -- the endpoint is the developer's own Mailgun config from
	// .env in a local dev tool, not request data.
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, s.endpoint, &buf) //nolint:gosec
	if err != nil {
		return err
	}
	req.Header.Set("Content-Type", form.FormDataContentType())
	req.SetBasicAuth("api", s.cfg.MailgunAPIKey)
	resp, err := s.client.Do(req) //nolint:gosec // see the request above
	if err != nil {
		return err
	}
	defer func() { _ = resp.Body.Close() }()
	if resp.StatusCode/100 != 2 {
		msg, _ := io.ReadAll(io.LimitReader(resp.Body, 1024))
		return fmt.Errorf("mailgun returned status %d: %s", resp.StatusCode, strings.TrimSpace(string(msg)))
	}
	return nil
}
