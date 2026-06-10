// Package parties is the admin API and data layer for parties and their guests:
// the wedding guest list. The persistent models live in pkg/models (which also
// owns the info-collection status logic, ADR 0005); this package owns the
// service writes, request/response types (types.go), and HTTP handlers.
package parties

import (
	"context"
	"crypto/rand"
	"database/sql"
	"encoding/base64"
	"math/big"

	"github.com/google/uuid"
	"github.com/pkg/errors"
	"github.com/robinjoseph08/robinandmadeline.com/pkg/errcodes"
	"github.com/robinjoseph08/robinandmadeline.com/pkg/models"
	"github.com/uptrace/bun"
)

// maxTokenAttempts bounds info-token generation retries on the (vanishingly
// unlikely) event a freshly generated token collides with an existing one.
const maxTokenAttempts = 5

// infoTokenBytes is the entropy (in bytes) behind a generated info token. 24
// bytes is 192 bits and base64url-encodes to a compact, URL-safe string.
const infoTokenBytes = 24

// rsvpCodeLength is the length of a generated RSVP code. Five letters from the
// 20-letter alphabet is 3.2 million combinations: short enough to copy from a
// printed card, roomy enough that collisions stay rare at wedding scale.
const rsvpCodeLength = 5

// maxRSVPCodeAttempts bounds generated-RSVP-code retries when a fresh code is
// already taken, which (unlike an info-token collision) is genuinely possible
// in a code space this small.
const maxRSVPCodeAttempts = 5

// rsvpCodeAlphabet is the character set for generated RSVP codes: uppercase
// consonants only. I and O are dropped as confusable (in print they read as 1
// and 0), and excluding every vowel (plus Y) means a random code can never
// spell an English word, so nothing rude or odd lands on an invitation.
const rsvpCodeAlphabet = "BCDFGHJKLMNPQRSTVWXZ"

// Service is the parties/guests data layer over a Bun DB. Construct it with
// NewService. It owns all writes, so the single-primary and status invariants
// have exactly one enforcement point. Methods return errcodes errors directly;
// handlers pass them through to the shared error handler.
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

// generateInfoToken returns a random, opaque, URL-safe token for a party's
// info-collection link. Tokens use crypto/rand; the service retries on the
// astronomically unlikely unique-index collision.
func generateInfoToken() (string, error) {
	b := make([]byte, infoTokenBytes)
	if _, err := rand.Read(b); err != nil {
		return "", errors.Wrap(err, "generate info token")
	}
	return base64.RawURLEncoding.EncodeToString(b), nil
}

// generateRSVPCode returns a random RSVP code: rsvpCodeLength characters drawn
// uniformly (crypto/rand, the same randomness source as generateInfoToken)
// from rsvpCodeAlphabet. Unlike info tokens the code space is small enough
// that collisions are plausible, so the caller checks uniqueness and retries.
func generateRSVPCode() (string, error) {
	code := make([]byte, rsvpCodeLength)
	for i := range code {
		n, err := rand.Int(rand.Reader, big.NewInt(int64(len(rsvpCodeAlphabet))))
		if err != nil {
			return "", errors.Wrap(err, "generate rsvp code")
		}
		code[i] = rsvpCodeAlphabet[n.Int64()]
	}
	return string(code), nil
}

// loadPartyWithGuests fetches a party and its guests within a query context (the
// receiver may be the DB or a transaction). Returns a 404 when the party does
// not exist. Guests are needed to derive status and enforce the single-primary
// invariant; they come back in creation order so responses never reshuffle.
func loadPartyWithGuests(ctx context.Context, db bun.IDB, id string) (*models.Party, error) {
	party := new(models.Party)
	err := db.NewSelect().Model(party).Relation("Guests", orderGuestsByCreation).Where("p.id = ?", id).Scan(ctx)
	if err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return nil, errcodes.NotFound("party")
		}
		return nil, errors.Wrap(err, "load party")
	}
	return party, nil
}

// orderGuestsByCreation is the relation-query hook every Guests eager load
// applies: without an ORDER BY the guests come back in heap order, which can
// visibly reshuffle the admin grid after updates. created_at with the id
// tiebreak is the same ordering promoteOldestGuest uses.
func orderGuestsByCreation(q *bun.SelectQuery) *bun.SelectQuery {
	return q.Order("g.created_at ASC", "g.id ASC")
}
