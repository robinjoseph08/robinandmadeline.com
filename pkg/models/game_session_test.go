package models_test

import (
	"testing"

	"github.com/robinjoseph08/robinandmadeline.com/pkg/models"
	"github.com/stretchr/testify/assert"
)

func TestEasierDifficulty(t *testing.T) {
	easy, medium, hard := models.GameDifficultyEasy, models.GameDifficultyMedium, models.GameDifficultyHard

	// Ordered: easy < medium < hard, in both argument orders.
	assert.Equal(t, easy, models.EasierDifficulty(easy, medium))
	assert.Equal(t, easy, models.EasierDifficulty(medium, easy))
	assert.Equal(t, easy, models.EasierDifficulty(hard, easy))
	assert.Equal(t, medium, models.EasierDifficulty(medium, hard))
	assert.Equal(t, medium, models.EasierDifficulty(hard, medium))

	// Equal inputs are returned unchanged.
	assert.Equal(t, hard, models.EasierDifficulty(hard, hard))
}
