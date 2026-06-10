package parties

import (
	"testing"

	"github.com/stretchr/testify/require"
)

// TestGenerateRSVPCode_FormatAndAlphabet drives the generator directly: every
// draw is exactly five characters from the unambiguous uppercase alphabet (no
// vowels, no confusable I or O). The uniqueness retry around it is not
// simulated here: it is the same check-then-insert mechanism the info token
// uses, and the create paths exercise it through insertPartyWithUniqueToken.
func TestGenerateRSVPCode_FormatAndAlphabet(t *testing.T) {
	for i := 0; i < 256; i++ {
		code, err := generateRSVPCode()
		require.NoError(t, err)
		require.Regexp(t, `^[BCDFGHJKLMNPQRSTVWXZ]{5}$`, code)
	}
}
