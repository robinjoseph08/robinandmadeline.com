package guestimport_test

import (
	"strings"
	"testing"

	"github.com/robinjoseph08/robinandmadeline.com/internal/guestimport"
	"github.com/robinjoseph08/robinandmadeline.com/pkg/models"
	"github.com/stretchr/testify/require"
)

// csvHeader mirrors the real Google Sheets export header, including the unused
// Prefix column and the trailing junk "Column N" columns the parser ignores.
const csvHeader = "First,Last,Full,Kingdom,Phylum,Class,Order,Family (Party),Size,Phone,Email,Address,City,Child?,Drinking?,Prefix,Code,Column 1,Column 2"

// buildCSV joins the shared header with the given data rows. All test data is
// synthetic; the real export never enters the repo.
func buildCSV(rows ...string) string {
	return csvHeader + "\n" + strings.Join(rows, "\n") + "\n"
}

// parseT parses a CSV built from the given rows and fails the test on error.
func parseT(t *testing.T, rows ...string) *guestimport.Plan {
	t.Helper()
	plan, err := guestimport.Parse(strings.NewReader(buildCSV(rows...)))
	require.NoError(t, err)
	return plan
}

func TestParse_GroupsGuestsIntoPartiesByFamilyColumn(t *testing.T) {
	plan := parseT(t,
		`Alice,Adams,Alice Adams,Robin,Family,Immediate,"Sibling, Bridal Party",Adams,1,555-0100,alice@example.com,123 Main St,Springfield,No,Yes,Ms.,KALEL,,`,
		`Bob,Adams,Bob Adams,Robin,Family,Immediate,In-Law,Adams,1,,,,,No,No,Mr.,KALEL,,`,
		`Cara,Brown,Cara Brown,Madeline,Friend,"Childhood, College",UIUC,Brown,1,,,,,No,Yes,,RANDOM,,`,
	)

	require.Len(t, plan.Parties, 2)
	require.Empty(t, plan.Warnings)
	require.Zero(t, plan.SkippedBlankRows)

	adams := plan.Parties[0]
	require.Equal(t, "Adams", adams.Party.Name)
	require.Equal(t, models.SideRobin, adams.Party.Side)
	require.Equal(t, models.RelationFamily, adams.Party.Relation)
	require.Equal(t, []string{models.CircleImmediate}, adams.Party.Circle)
	require.Equal(t, models.InvitationPhysical, adams.Party.InvitationType)
	require.NotNil(t, adams.Party.RSVPCode)
	require.Equal(t, "KALEL", *adams.Party.RSVPCode)
	require.NotNil(t, adams.Party.AddressLine1)
	require.Equal(t, "123 Main St", *adams.Party.AddressLine1)
	require.NotNil(t, adams.Party.City)
	require.Equal(t, "Springfield", *adams.Party.City)
	require.False(t, adams.Party.InfoCollectionRequested)
	require.False(t, adams.Party.InfoCollectionConfirmed)

	require.Len(t, adams.Guests, 2)
	alice, bob := adams.Guests[0], adams.Guests[1]
	require.Equal(t, "Alice Adams", alice.FullName)
	require.True(t, alice.IsPrimary, "the first guest of a party is its primary")
	require.Equal(t, []string{"Sibling", "Bridal Party"}, alice.Tags)
	require.NotNil(t, alice.Email)
	require.Equal(t, "alice@example.com", *alice.Email)
	require.NotNil(t, alice.Phone)
	require.Equal(t, "555-0100", *alice.Phone)
	require.False(t, alice.IsChild)
	require.True(t, alice.IsDrinking)
	require.Equal(t, "Bob Adams", bob.FullName)
	require.False(t, bob.IsPrimary)
	require.Equal(t, []string{"In-Law"}, bob.Tags)
	require.Nil(t, bob.Email)
	require.Nil(t, bob.Phone)
	require.False(t, bob.IsDrinking)

	brown := plan.Parties[1]
	require.Equal(t, "Brown", brown.Party.Name)
	require.Equal(t, models.SideMadeline, brown.Party.Side)
	require.Equal(t, models.RelationFriend, brown.Party.Relation)
	require.Equal(t, []string{models.CircleChildhood, models.CircleCollege}, brown.Party.Circle)
	require.Nil(t, brown.Party.RSVPCode, `a "RANDOM" code is left nil for generation at import time`)
	require.Nil(t, brown.Party.AddressLine1)
	require.Nil(t, brown.Party.City)
	require.Len(t, brown.Guests, 1)
	require.True(t, brown.Guests[0].IsPrimary)
}

func TestParse_CircleIsTheUnionAcrossAPartysRows(t *testing.T) {
	plan := parseT(t,
		`Dana,Cole,Dana Cole,Robin,Friend,"Childhood, College",JHHS,Cole,1,,,,,No,Yes,,,,`,
		`Eli,Cole,Eli Cole,Robin,Friend,"College, Work",UTD,Cole,1,,,,,No,Yes,,,,`,
	)
	require.Len(t, plan.Parties, 1)
	require.Equal(t, []string{models.CircleChildhood, models.CircleCollege, models.CircleWork}, plan.Parties[0].Party.Circle)
}

func TestParse_SkipsFullyBlankRows(t *testing.T) {
	plan := parseT(t,
		`,,,,,,,,,,,,,,,,,,`,
		`Dana,Cole,Dana Cole,Robin,Friend,College,UTD,Cole,1,,,,,No,Yes,,,,`,
		`,,,,,,,,,,,,,,,,,,`,
	)
	require.Len(t, plan.Parties, 1)
	require.Len(t, plan.Parties[0].Guests, 1)
	require.Equal(t, 2, plan.SkippedBlankRows)
}

func TestParse_BlankChildAndDrinkingDefaultFalseWithAggregateWarnings(t *testing.T) {
	plan := parseT(t,
		`Dana,Cole,Dana Cole,Robin,Friend,College,UTD,Cole,1,,,,,,,,,,`,
		`Eli,Cole,Eli Cole,Robin,Friend,College,UTD,Cole,1,,,,,,Yes,,,,`,
	)
	require.Len(t, plan.Parties, 1)
	for _, g := range plan.Parties[0].Guests {
		require.False(t, g.IsChild)
	}
	require.False(t, plan.Parties[0].Guests[0].IsDrinking)
	require.True(t, plan.Parties[0].Guests[1].IsDrinking)
	require.Len(t, plan.Warnings, 2)
	require.Contains(t, plan.Warnings[0], "2 guest(s) have a blank Child? value")
	require.Contains(t, plan.Warnings[1], "1 guest(s) have a blank Drinking? value")
}

func TestParse_SizeTwoCreatesAPlaceholderPlusOne(t *testing.T) {
	plan := parseT(t,
		`Dana,Cole,Dana Cole,Robin,Friend,College,UTD,Cole,2,555-0100,dana@example.com,,,No,Yes,,,,`,
		`Eli,Cole,Eli Cole,Robin,Friend,College,UTD,Cole,1,,,,,No,Yes,,,,`,
	)
	require.Len(t, plan.Parties, 1)
	require.Empty(t, plan.Warnings)

	guests := plan.Parties[0].Guests
	require.Len(t, guests, 3)
	require.Equal(t, "Dana Cole", guests[0].FullName)
	require.Equal(t, "Guest of Dana Cole", guests[1].FullName, "a placeholder follows its host guest, before the next named row")
	require.Equal(t, "Eli Cole", guests[2].FullName)

	require.True(t, guests[0].IsPrimary, "the named host guest keeps primary")
	require.False(t, guests[0].IsPlaceholder)

	placeholder := guests[1]
	require.True(t, placeholder.IsPlaceholder)
	require.False(t, placeholder.IsPrimary)
	require.False(t, placeholder.IsChild)
	require.False(t, placeholder.IsDrinking)
	require.Equal(t, []string{}, placeholder.Tags)
	require.Nil(t, placeholder.Email)
	require.Nil(t, placeholder.Phone)
}

func TestParse_SizeAboveTwoNumbersItsPlaceholders(t *testing.T) {
	plan := parseT(t,
		`Dana,Cole,Dana Cole,Robin,Friend,College,UTD,Cole,3,,,,,No,Yes,,,,`,
	)
	guests := plan.Parties[0].Guests
	require.Len(t, guests, 3)
	require.Equal(t, "Dana Cole", guests[0].FullName)
	require.Equal(t, "Guest 1 of Dana Cole", guests[1].FullName)
	require.Equal(t, "Guest 2 of Dana Cole", guests[2].FullName)
	require.True(t, guests[1].IsPlaceholder)
	require.True(t, guests[2].IsPlaceholder)
}

func TestParse_BlankSizeMeansOneWithoutWarning(t *testing.T) {
	plan := parseT(t,
		`Dana,Cole,Dana Cole,Robin,Friend,College,UTD,Cole,,,,,,No,Yes,,,,`,
	)
	require.Len(t, plan.Parties[0].Guests, 1)
	require.Empty(t, plan.Warnings)
}

func TestParse_InvalidSizeValuesAreErrors(t *testing.T) {
	_, err := guestimport.Parse(strings.NewReader(buildCSV(
		`Dana,Cole,Dana Cole,Robin,Friend,College,UTD,Cole,zero,,,,,No,Yes,,,,`,
		`Eli,Stone,Eli Stone,Robin,Friend,College,UTD,Stone,0,,,,,No,Yes,,,,`,
		`Fay,Reed,Fay Reed,Robin,Friend,College,UTD,Reed,-1,,,,,No,Yes,,,,`,
	)))
	require.Error(t, err)
	require.Contains(t, err.Error(), "3 problem(s)")
	require.Contains(t, err.Error(), `line 2 (Dana Cole): Size must be a positive whole number or blank, got "zero"`)
	require.Contains(t, err.Error(), `line 3 (Eli Stone): Size must be a positive whole number or blank, got "0"`)
	require.Contains(t, err.Error(), `line 4 (Fay Reed): Size must be a positive whole number or blank, got "-1"`)
}

func TestParse_PlaceholdersAreExcludedFromBlankCellWarnings(t *testing.T) {
	// The host row's blank Child?/Drinking? cells are real blanks worth one
	// warning tally each; its two placeholders default those fields by design
	// and must not inflate the counts.
	plan := parseT(t,
		`Dana,Cole,Dana Cole,Robin,Friend,College,UTD,Cole,3,,,,,,,,,,`,
	)
	require.Len(t, plan.Parties[0].Guests, 3)
	require.Len(t, plan.Warnings, 2)
	require.Contains(t, plan.Warnings[0], "1 guest(s) have a blank Child? value")
	require.Contains(t, plan.Warnings[1], "1 guest(s) have a blank Drinking? value")
}

func TestParse_FullNameFallsBackToFirstAndLast(t *testing.T) {
	plan := parseT(t,
		`Dana,Cole,,Robin,Friend,College,UTD,Cole,1,,,,,No,Yes,,,,`,
	)
	require.Equal(t, "Dana Cole", plan.Parties[0].Guests[0].FullName)
}

func TestParse_MissingPartyNameIsError(t *testing.T) {
	_, err := guestimport.Parse(strings.NewReader(buildCSV(
		`Dana,Cole,Dana Cole,Robin,Friend,College,UTD,,1,,,,,No,Yes,,,,`,
		`Eli,Stone,Eli Stone,Robin,Friend,College,UTD,,1,,,,,No,Yes,,,,`,
	)))
	require.Error(t, err)
	require.Contains(t, err.Error(), "2 problem(s)")
	require.Contains(t, err.Error(), "line 2 (Dana Cole): missing Family (Party) value")
	require.Contains(t, err.Error(), "line 3 (Eli Stone): missing Family (Party) value")
}

func TestParse_UnknownEnumValuesAreErrors(t *testing.T) {
	_, err := guestimport.Parse(strings.NewReader(buildCSV(
		`Dana,Cole,Dana Cole,Narnia,Acquaintance,Pottery,UTD,Cole,1,,,,,Maybe,Sometimes,,,,`,
	)))
	require.Error(t, err)
	require.Contains(t, err.Error(), `Kingdom must be one of Robin or Madeline, got "Narnia"`)
	require.Contains(t, err.Error(), `Phylum must be one of Family or Friend, got "Acquaintance"`)
	require.Contains(t, err.Error(), `unknown Class value "Pottery"`)
	require.Contains(t, err.Error(), `Child? must be Yes, No, or blank, got "Maybe"`)
	require.Contains(t, err.Error(), `Drinking? must be Yes, No, or blank, got "Sometimes"`)
}

func TestParse_ConflictingSideOrRelationWithinPartyIsError(t *testing.T) {
	_, err := guestimport.Parse(strings.NewReader(buildCSV(
		`Dana,Cole,Dana Cole,Robin,Friend,College,UTD,Cole,1,,,,,No,Yes,,,,`,
		`Eli,Cole,Eli Cole,Madeline,Family,College,UTD,Cole,1,,,,,No,Yes,,,,`,
		`Fay,Cole,Fay Cole,Madeline,Family,College,UTD,Cole,1,,,,,No,Yes,,,,`,
	)))
	require.Error(t, err)
	require.Contains(t, err.Error(), `party "Cole": conflicting Kingdom values`)
	require.Contains(t, err.Error(), `party "Cole": conflicting Phylum values`)
	require.Equal(t, 1, strings.Count(err.Error(), "conflicting Kingdom values"), "a conflict is reported once per party, not once per row")
	require.Equal(t, 1, strings.Count(err.Error(), "conflicting Phylum values"))
}

func TestParse_ConflictingCodesWithinPartyIsError(t *testing.T) {
	_, err := guestimport.Parse(strings.NewReader(buildCSV(
		`Dana,Cole,Dana Cole,Robin,Friend,College,UTD,Cole,1,,,,,No,Yes,,PEPPER,,`,
		`Eli,Cole,Eli Cole,Robin,Friend,College,UTD,Cole,1,,,,,No,Yes,,SLOTH,,`,
	)))
	require.Error(t, err)
	require.Contains(t, err.Error(), `party "Cole": conflicting Code values across its rows: PEPPER, SLOTH`)
}

func TestParse_CodeSharedAcrossPartiesIsError(t *testing.T) {
	_, err := guestimport.Parse(strings.NewReader(buildCSV(
		`Dana,Cole,Dana Cole,Robin,Friend,College,UTD,Cole,1,,,,,No,Yes,,PEPPER,,`,
		`Eli,Stone,Eli Stone,Robin,Friend,College,UTD,Stone,1,,,,,No,Yes,,PEPPER,,`,
	)))
	require.Error(t, err)
	require.Contains(t, err.Error(), `party "Stone": Code value "PEPPER" is already used by party "Cole"`)
}

func TestParse_PartialCodeCoverageWithinPartyUsesTheCode(t *testing.T) {
	// One row carries the code, the other is blank: not a conflict; the
	// explicit code wins for the whole party.
	plan := parseT(t,
		`Dana,Cole,Dana Cole,Robin,Friend,College,UTD,Cole,1,,,,,No,Yes,,PEPPER,,`,
		`Eli,Cole,Eli Cole,Robin,Friend,College,UTD,Cole,1,,,,,No,Yes,,,,`,
	)
	require.NotNil(t, plan.Parties[0].Party.RSVPCode)
	require.Equal(t, "PEPPER", *plan.Parties[0].Party.RSVPCode)
}

func TestParse_ConflictingAddressWarnsAndKeepsFirst(t *testing.T) {
	plan := parseT(t,
		`Dana,Cole,Dana Cole,Robin,Friend,College,UTD,Cole,1,,,12 Oak Ave,Austin,No,Yes,,,,`,
		`Eli,Cole,Eli Cole,Robin,Friend,College,UTD,Cole,1,,,99 Elm St,Dallas,No,Yes,,,,`,
	)
	require.Equal(t, "12 Oak Ave", *plan.Parties[0].Party.AddressLine1)
	require.Equal(t, "Austin", *plan.Parties[0].Party.City)
	require.Len(t, plan.Warnings, 2)
	require.Contains(t, plan.Warnings[0], `party "Cole": conflicting Address values; keeping "12 Oak Ave"`)
	require.Contains(t, plan.Warnings[1], `party "Cole": conflicting City values; keeping "Austin"`)
}

func TestParse_LineNumbersStayAccurateAcrossMultilineQuotedCells(t *testing.T) {
	// The first data row's Address cell contains a newline, so the record spans
	// file lines 2-3 and the bad row below it starts on file line 4. Problem
	// messages must report the real file line, not the record index.
	_, err := guestimport.Parse(strings.NewReader(buildCSV(
		"Dana,Cole,Dana Cole,Robin,Friend,College,UTD,Cole,1,,,\"12 Oak Ave\nApt 3\",Austin,No,Yes,,,,",
		`Eli,Stone,Eli Stone,Robin,Friend,College,UTD,,1,,,,,No,Yes,,,,`,
	)))
	require.Error(t, err)
	require.Contains(t, err.Error(), "line 4 (Eli Stone): missing Family (Party) value")
}

func TestParse_MissingRequiredColumnIsError(t *testing.T) {
	_, err := guestimport.Parse(strings.NewReader("First,Last,Full\nDana,Cole,Dana Cole\n"))
	require.Error(t, err)
	require.Contains(t, err.Error(), "csv is missing expected column(s)")
	require.Contains(t, err.Error(), "Kingdom")
}
