package emails_test

import (
	"context"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/robinjoseph08/robinandmadeline.com/pkg/emails"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

// These tests exercise the production Mailgun client against a local httptest
// server; nothing here touches the real Mailgun API.

func TestHTTPMailgunClient_SendFormatsRequestAndParsesID(t *testing.T) {
	var gotPath, gotUser, gotPass string
	var gotForm map[string]string
	var parseErr error
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		gotPath = r.URL.Path
		gotUser, gotPass, _ = r.BasicAuth()
		parseErr = r.ParseForm()
		gotForm = map[string]string{}
		for k := range r.PostForm {
			gotForm[k] = r.PostForm.Get(k)
		}
		w.Header().Set("Content-Type", "application/json")
		// Mailgun wraps the id in angle brackets; the client must strip them.
		_, _ = w.Write([]byte(`{"id":"<abc123@mg.example.test>","message":"Queued. Thank you."}`))
	}))
	defer srv.Close()

	client := emails.NewMailgunClient(srv.URL, "mg.example.test", "key-secret")
	id, err := client.Send(context.Background(), emails.Message{
		From:        "Robin & Madeline <hello@example.test>",
		To:          "alice@example.com",
		Subject:     "Hi Alice",
		Text:        "Body",
		HTML:        "<p>Body</p>",
		RecipientID: "rec-1",
	})
	require.NoError(t, err)
	require.NoError(t, parseErr)

	assert.Equal(t, "abc123@mg.example.test", id)
	assert.Equal(t, "/v3/mg.example.test/messages", gotPath)
	assert.Equal(t, "api", gotUser)
	assert.Equal(t, "key-secret", gotPass)
	// Both the plaintext fallback and the HTML body are submitted.
	assert.Equal(t, map[string]string{
		"from":           "Robin & Madeline <hello@example.test>",
		"to":             "alice@example.com",
		"subject":        "Hi Alice",
		"text":           "Body",
		"html":           "<p>Body</p>",
		"v:recipient_id": "rec-1",
	}, gotForm)
}

func TestHTTPMailgunClient_SendAddsUnsubscribeHeaders(t *testing.T) {
	var gotForm map[string]string
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		_ = r.ParseForm()
		gotForm = map[string]string{}
		for k := range r.PostForm {
			gotForm[k] = r.PostForm.Get(k)
		}
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{"id":"<abc@mg.example.test>"}`))
	}))
	defer srv.Close()

	client := emails.NewMailgunClient(srv.URL, "mg.example.test", "key-secret")
	_, err := client.Send(context.Background(), emails.Message{
		From:           "Robin & Madeline <hello@example.test>",
		To:             "alice@example.com",
		Subject:        "Hi Alice",
		Text:           "Body",
		HTML:           "<p>Body</p>",
		RecipientID:    "rec-1",
		UnsubscribeURL: "https://robinandmadeline.com/u/guest-9",
	})
	require.NoError(t, err)

	// RFC 2369 List-Unsubscribe (angle-bracketed) plus RFC 8058 one-click.
	assert.Equal(t, "<https://robinandmadeline.com/u/guest-9>", gotForm["h:List-Unsubscribe"])
	assert.Equal(t, "List-Unsubscribe=One-Click", gotForm["h:List-Unsubscribe-Post"])
}

func TestHTTPMailgunClient_SendNon2xxIsError(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.WriteHeader(http.StatusUnauthorized)
		_, _ = w.Write([]byte(`{"message":"Invalid private key"}`))
	}))
	defer srv.Close()

	client := emails.NewMailgunClient(srv.URL, "mg.example.test", "bad-key")
	_, err := client.Send(context.Background(), emails.Message{To: "a@b.c"})
	require.Error(t, err)
	assert.Contains(t, err.Error(), "status 401")
}

func TestHTTPMailgunClient_SendMissingIDIsError(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		_, _ = w.Write([]byte(`{"message":"Queued. Thank you."}`))
	}))
	defer srv.Close()

	client := emails.NewMailgunClient(srv.URL, "mg.example.test", "key")
	_, err := client.Send(context.Background(), emails.Message{To: "a@b.c"})
	require.Error(t, err)
	assert.Contains(t, err.Error(), "no message id")
}

func TestHTTPMailgunClient_FindAcceptedMessageIDMatchesRecipientVariable(t *testing.T) {
	var gotQuery map[string]string
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		gotQuery = map[string]string{}
		for k := range r.URL.Query() {
			gotQuery[k] = r.URL.Query().Get(k)
		}
		w.Header().Set("Content-Type", "application/json")
		// Two accepted events for the address; only the second carries our
		// recipient id.
		_, _ = w.Write([]byte(`{"items":[
			{"message":{"headers":{"message-id":"other@mg.example.test"}},"user-variables":{"recipient_id":"rec-other"}},
			{"message":{"headers":{"message-id":"mine@mg.example.test"}},"user-variables":{"recipient_id":"rec-1"}}
		]}`))
	}))
	defer srv.Close()

	client := emails.NewMailgunClient(srv.URL, "mg.example.test", "key")
	id, found, err := client.FindAcceptedMessageID(context.Background(), "rec-1", "alice@example.com")
	require.NoError(t, err)
	assert.True(t, found)
	assert.Equal(t, "mine@mg.example.test", id)
	assert.Equal(t, "accepted", gotQuery["event"])
	assert.Equal(t, "alice@example.com", gotQuery["recipient"])
}

func TestHTTPMailgunClient_FindAcceptedMessageIDNotFound(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{"items":[]}`))
	}))
	defer srv.Close()

	client := emails.NewMailgunClient(srv.URL, "mg.example.test", "key")
	_, found, err := client.FindAcceptedMessageID(context.Background(), "rec-1", "alice@example.com")
	require.NoError(t, err)
	assert.False(t, found)
}

func TestHTTPMailgunClient_FindAcceptedMessageIDNon2xxIsError(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.WriteHeader(http.StatusInternalServerError)
	}))
	defer srv.Close()

	client := emails.NewMailgunClient(srv.URL, "mg.example.test", "key")
	_, _, err := client.FindAcceptedMessageID(context.Background(), "rec-1", "alice@example.com")
	require.Error(t, err)
	assert.Contains(t, err.Error(), "status 500")
}

func TestRejectionError_IsQuotaLimited(t *testing.T) {
	tests := []struct {
		name      string
		rejection emails.RejectionError
		want      bool
	}{
		{
			name:      "429 is always quota regardless of body",
			rejection: emails.RejectionError{StatusCode: 429, Body: "anything"},
			want:      true,
		},
		{
			name:      "4xx body mentioning quota",
			rejection: emails.RejectionError{StatusCode: 403, Body: "Monthly Quota exceeded"},
			want:      true,
		},
		{
			name:      "4xx body naming the sending limit phrase",
			rejection: emails.RejectionError{StatusCode: 400, Body: "Domain has reached its daily Sending Limit"},
			want:      true,
		},
		{
			name:      "4xx body naming the daily limit phrase",
			rejection: emails.RejectionError{StatusCode: 403, Body: "daily limit reached"},
			want:      true,
		},
		{
			name:      "ordinary message rejection is not quota",
			rejection: emails.RejectionError{StatusCode: 400, Body: "'to' parameter is invalid"},
			want:      false,
		},
		{
			// The bare word "limit" is not enough: a parameter rejection like
			// this would otherwise be requeued to the head of the queue and
			// re-arm the day-long pause every day, starving the queue.
			name:      "4xx body with a bare limit word is not quota",
			rejection: emails.RejectionError{StatusCode: 400, Body: "'subject' length limit is 500"},
			want:      false,
		},
		{
			// Body matching is restricted to 4xx: a 5xx is a server-side
			// failure, not a definitive quota answer.
			name:      "5xx body mentioning quota is not quota",
			rejection: emails.RejectionError{StatusCode: 500, Body: "quota service unavailable"},
			want:      false,
		},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			assert.Equal(t, tt.want, tt.rejection.IsQuotaLimited())
		})
	}
}
