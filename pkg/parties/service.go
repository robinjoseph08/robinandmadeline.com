// Package parties is the admin API and data layer for parties and their guests:
// the wedding guest list. The persistent models live in pkg/models (which also
// owns the info-collection status logic, ADR 0005); this package owns the
// service writes, request/response types (types.go), and HTTP handlers.
package parties

import (
	"context"
	"crypto/rand"
	"database/sql"
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

// infoTokenLength is the length of a generated info token. 30 characters from
// the 36-character alphabet is ~155 bits of entropy: the token is the sole
// authentication for the info-collection link (ADR 0003), so it stays
// unguessable while reading cleanly in a URL.
const infoTokenLength = 30

// infoTokenAlphabet is the character set for generated info tokens: lowercase
// letters and digits only, so a token never mixes cases or carries symbols
// (the old base64url tokens did both, which read poorly in a shared link).
const infoTokenAlphabet = "abcdefghijklmnopqrstuvwxyz0123456789"

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

// GenerateInfoToken returns a random, opaque token for a party's
// info-collection link: infoTokenLength characters drawn uniformly
// (crypto/rand) from infoTokenAlphabet, so it is URL-safe lowercase
// alphanumerics only. The service retries on the astronomically unlikely
// unique-index collision. Exported so operational tooling (the CSV guest
// import) mints tokens with the same shape and entropy as the create paths.
func GenerateInfoToken() (string, error) {
	token := make([]byte, infoTokenLength)
	for i := range token {
		n, err := rand.Int(rand.Reader, big.NewInt(int64(len(infoTokenAlphabet))))
		if err != nil {
			return "", errors.Wrap(err, "generate info token")
		}
		token[i] = infoTokenAlphabet[n.Int64()]
	}
	return string(token), nil
}

// GenerateRSVPCode returns a random RSVP code: rsvpCodeLength characters drawn
// uniformly (crypto/rand, the same randomness source as GenerateInfoToken)
// from rsvpCodeAlphabet. Unlike info tokens the code space is small enough
// that collisions are plausible, so the caller checks uniqueness and retries.
// Exported for the same operational tooling as GenerateInfoToken.
func GenerateRSVPCode() (string, error) {
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
// invariant; they come back in the canonical within-party order
// (models.OrderGuestsWithinParty: primary, then the other adults, then the
// children) so responses never reshuffle.
func loadPartyWithGuests(ctx context.Context, db bun.IDB, id string) (*models.Party, error) {
	party := new(models.Party)
	err := db.NewSelect().Model(party).Relation("Guests", models.OrderGuestsWithinParty).Where("p.id = ?", id).Scan(ctx)
	if err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return nil, errcodes.NotFound("party")
		}
		return nil, errors.Wrap(err, "load party")
	}
	return party, nil
}
