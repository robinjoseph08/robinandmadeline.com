package guestimport_test

import (
	"slices"
	"strings"
	"testing"

	"github.com/robinjoseph08/golib/pointerutil"
	"github.com/robinjoseph08/robinandmadeline.com/internal/guestimport"
	"github.com/robinjoseph08/robinandmadeline.com/pkg/models"
	"github.com/stretchr/testify/require"
)

// csvHeader mirrors the real Google Sheets export header. The parser indexes
// columns by name and ignores anything it does not recognize, so extra export
// columns need no representation here.
const csvHeader = "First,Last,Full,Kingdom,Phylum,Class,Order,Family (Party),Size,Phone,Email,Address 1,Address 2,City,State,ZIP,Country,Child?,Drinking?,Code"

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
	// The Adams party carries every party-level detail on its first (primary)
	// row; Bob's row leaves them all blank except an identical repeat of the
	// code, which is tolerated silently (the sheet does repeat codes).
	plan := parseT(t,
		`Alice,Adams,Alice Adams,Robin,Family,Immediate,"Sibling, Bridal Party",Adams,1,555-0100,alice@example.com,123 Main St,Apt 4,Springfield,IL,62704,United States,No,Yes,KALEL`,
		`Bob,Adams,Bob Adams,Robin,Family,Immediate,In-Law,Adams,1,,,,,,,,,No,No,KALEL`,
		`Cara,Brown,Cara Brown,Madeline,Friend,"Childhood, College",UIUC,Brown,1,,,,,,,,,No,Yes,RANDOM`,
	)

	require.Len(t, plan.Parties, 2)
	require.Empty(t, plan.Warnings)
	require.Zero(t, plan.SkippedBlankRows)
	require.Zero(t, plan.SkippedNoPartyRows)

	adams := plan.Parties[0]
	require.Equal(t, "Adams", adams.Party.Name)
	require.Equal(t, models.SideRobin, adams.Party.Side)
	require.Equal(t, models.RelationFamily, adams.Party.Relation)
	require.Equal(t, []string{models.CircleImmediate}, adams.Party.Circle)
	require.Equal(t, models.InvitationPhysical, adams.Party.InvitationType)
	require.Equal(t, pointerutil.String("KALEL"), adams.Party.RSVPCode)
	require.Equal(t, pointerutil.String("123 Main St"), adams.Party.AddressLine1)
	require.Equal(t, pointerutil.String("Apt 4"), adams.Party.AddressLine2)
	require.Equal(t, pointerutil.String("Springfield"), adams.Party.City)
	require.Equal(t, pointerutil.String("IL"), adams.Party.StateOrProvince)
	require.Equal(t, pointerutil.String("62704"), adams.Party.PostalCode)
	require.Equal(t, pointerutil.String("United States"), adams.Party.Country)
	require.False(t, adams.Party.InfoCollectionRequested)
	require.False(t, adams.Party.InfoCollectionConfirmed)

	require.Len(t, adams.Guests, 2)
	alice, bob := adams.Guests[0], adams.Guests[1]
	require.Equal(t, "Alice Adams", alice.FullName)
	require.True(t, alice.IsPrimary, "the first guest of a party is its primary")
	require.Equal(t, []string{"Sibling", "Bridal Party"}, alice.Tags)
	require.Equal(t, pointerutil.String("alice@example.com"), alice.Email)
	require.Equal(t, pointerutil.String("555-0100"), alice.Phone)
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
	require.Nil(t, brown.Party.AddressLine2)
	require.Nil(t, brown.Party.City)
	require.Nil(t, brown.Party.StateOrProvince)
	require.Nil(t, brown.Party.PostalCode)
	require.Nil(t, brown.Party.Country)
	require.Len(t, brown.Guests, 1)
	require.True(t, brown.Guests[0].IsPrimary)
}

func TestParse_CircleIsTheUnionAcrossAPartysRows(t *testing.T) {
	plan := parseT(t,
		`Dana,Cole,Dana Cole,Robin,Friend,"Childhood, College",JHHS,Cole,1,,,,,,,,,No,Yes,`,
		`Eli,Cole,Eli Cole,Robin,Friend,"College, Work",UTD,Cole,1,,,,,,,,,No,Yes,`,
	)
	require.Len(t, plan.Parties, 1)
	require.Equal(t, []string{models.CircleChildhood, models.CircleCollege, models.CircleWork}, plan.Parties[0].Party.Circle)
}

func TestParse_SkipsFullyBlankRows(t *testing.T) {
	plan := parseT(t,
		`,,,,,,,,,,,,,,,,,,,`,
		`Dana,Cole,Dana Cole,Robin,Friend,College,UTD,Cole,1,,,,,,,,,No,Yes,`,
		`,,,,,,,,,,,,,,,,,,,`,
	)
	require.Len(t, plan.Parties, 1)
	require.Len(t, plan.Parties[0].Guests, 1)
	require.Equal(t, 2, plan.SkippedBlankRows)
}

func TestParse_NamedRowsWithoutAPartyAreFilteredOut(t *testing.T) {
	// Drafts of the sheet leave "Family (Party)" blank on rows not yet grouped.
	// Those rows are filtered out before any validation (Eli's bogus taxonomy
	// values and blank Child?/Drinking? cells must produce no problem or
	// warning) and counted separately from the blank spacer rows. The one
	// thing a skipped row does surface is an explicit code, which would
	// otherwise vanish silently: Fay's earns the single aggregate warning.
	plan := parseT(t,
		`Dana,Cole,Dana Cole,Robin,Friend,College,UTD,Cole,1,,,,,,,,,No,Yes,`,
		`Eli,Stone,Eli Stone,Narnia,Acquaintance,Pottery,UTD,,1,,,,,,,,,,,`,
		`Fay,Reed,Fay Reed,Robin,Friend,College,UTD,,1,,,,,,,,,No,Yes,MUMMY`,
		`,,,,,,,,,,,,,,,,,,,`,
	)
	require.Len(t, plan.Parties, 1)
	require.Equal(t, "Cole", plan.Parties[0].Party.Name)
	require.Len(t, plan.Parties[0].Guests, 1)
	require.Equal(t, 2, plan.SkippedNoPartyRows)
	require.Equal(t, 1, plan.SkippedBlankRows)
	require.Len(t, plan.Warnings, 1)
	require.Contains(t, plan.Warnings[0], "1 skipped no-party row(s) carry a Code value that was not imported: Fay Reed")
}

func TestParse_BlankChildAndDrinkingDefaultFalseWithAggregateWarnings(t *testing.T) {
	plan := parseT(t,
		`Dana,Cole,Dana Cole,Robin,Friend,College,UTD,Cole,1,,,,,,,,,,,`,
		`Eli,Cole,Eli Cole,Robin,Friend,College,UTD,Cole,1,,,,,,,,,,Yes,`,
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
		`Dana,Cole,Dana Cole,Robin,Friend,College,UTD,Cole,2,555-0100,dana@example.com,,,,,,,No,Yes,`,
		`Eli,Cole,Eli Cole,Robin,Friend,College,UTD,Cole,1,,,,,,,,,No,Yes,`,
	)
	require.Len(t, plan.Parties, 1)
	require.Empty(t, plan.Warnings)

	guests := plan.Parties[0].Guests
	require.Len(t, guests, 3)
	require.Equal(t, "Dana Cole", guests[0].FullName)
	require.Equal(t, "Guest of Dana Cole", guests[1].FullName, "a placeholder follows its host guest, before the next named row")
	require.Equal(t, "Eli Cole", guests[2].FullName)

	require.True(t, guests[0].IsPrimary, "the named host guest keeps primary")
	require.Nil(t, guests[0].PlaceholderText)

	placeholder := guests[1]
	require.NotNil(t, placeholder.PlaceholderText)
	require.Equal(t, "Guest of Dana Cole", *placeholder.PlaceholderText,
		"the descriptor is stored permanently alongside the initial full_name")
	require.False(t, placeholder.IsPrimary)
	require.False(t, placeholder.IsChild)
	require.False(t, placeholder.IsDrinking)
	require.Equal(t, []string{}, placeholder.Tags)
	require.Nil(t, placeholder.Email)
	require.Nil(t, placeholder.Phone)
}

func TestParse_SizeAboveTwoNumbersItsPlaceholders(t *testing.T) {
	plan := parseT(t,
		`Dana,Cole,Dana Cole,Robin,Friend,College,UTD,Cole,3,,,,,,,,,No,Yes,`,
	)
	guests := plan.Parties[0].Guests
	require.Len(t, guests, 3)
	require.Equal(t, "Dana Cole", guests[0].FullName)
	require.Equal(t, "Guest 1 of Dana Cole", guests[1].FullName)
	require.Equal(t, "Guest 2 of Dana Cole", guests[2].FullName)
	require.Equal(t, pointerutil.String("Guest 1 of Dana Cole"), guests[1].PlaceholderText)
	require.Equal(t, pointerutil.String("Guest 2 of Dana Cole"), guests[2].PlaceholderText)
}

func TestParse_BlankSizeMeansOneWithoutWarning(t *testing.T) {
	plan := parseT(t,
		`Dana,Cole,Dana Cole,Robin,Friend,College,UTD,Cole,,,,,,,,,,No,Yes,`,
	)
	require.Len(t, plan.Parties[0].Guests, 1)
	require.Empty(t, plan.Warnings)
}

func TestParse_InvalidSizeValuesAreErrors(t *testing.T) {
	_, err := guestimport.Parse(strings.NewReader(buildCSV(
		`Dana,Cole,Dana Cole,Robin,Friend,College,UTD,Cole,zero,,,,,,,,,No,Yes,`,
		`Eli,Stone,Eli Stone,Robin,Friend,College,UTD,Stone,0,,,,,,,,,No,Yes,`,
		`Fay,Reed,Fay Reed,Robin,Friend,College,UTD,Reed,-1,,,,,,,,,No,Yes,`,
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
		`Dana,Cole,Dana Cole,Robin,Friend,College,UTD,Cole,3,,,,,,,,,,,`,
	)
	require.Len(t, plan.Parties[0].Guests, 3)
	require.Len(t, plan.Warnings, 2)
	require.Contains(t, plan.Warnings[0], "1 guest(s) have a blank Child? value")
	require.Contains(t, plan.Warnings[1], "1 guest(s) have a blank Drinking? value")
}

func TestParse_FullNameFallsBackToFirstAndLast(t *testing.T) {
	plan := parseT(t,
		`Dana,Cole,,Robin,Friend,College,UTD,Cole,1,,,,,,,,,No,Yes,`,
	)
	require.Equal(t, "Dana Cole", plan.Parties[0].Guests[0].FullName)
}

func TestParse_UnknownEnumValuesAreErrors(t *testing.T) {
	_, err := guestimport.Parse(strings.NewReader(buildCSV(
		`Dana,Cole,Dana Cole,Narnia,Acquaintance,Pottery,UTD,Cole,1,,,,,,,,,Maybe,Sometimes,`,
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
		`Dana,Cole,Dana Cole,Robin,Friend,College,UTD,Cole,1,,,,,,,,,No,Yes,`,
		`Eli,Cole,Eli Cole,Madeline,Family,College,UTD,Cole,1,,,,,,,,,No,Yes,`,
		`Fay,Cole,Fay Cole,Madeline,Family,College,UTD,Cole,1,,,,,,,,,No,Yes,`,
	)))
	require.Error(t, err)
	require.Contains(t, err.Error(), `party "Cole": conflicting Kingdom values`)
	require.Contains(t, err.Error(), `party "Cole": conflicting Phylum values`)
	require.Equal(t, 1, strings.Count(err.Error(), "conflicting Kingdom values"), "a conflict is reported once per party, not once per row")
	require.Equal(t, 1, strings.Count(err.Error(), "conflicting Phylum values"))
}

func TestParse_ConflictingCodesWithinPartyIsError(t *testing.T) {
	_, err := guestimport.Parse(strings.NewReader(buildCSV(
		`Dana,Cole,Dana Cole,Robin,Friend,College,UTD,Cole,1,,,,,,,,,No,Yes,PEPPER`,
		`Eli,Cole,Eli Cole,Robin,Friend,College,UTD,Cole,1,,,,,,,,,No,Yes,SLOTH`,
	)))
	require.Error(t, err)
	require.Contains(t, err.Error(), `party "Cole": conflicting Code values across its rows: PEPPER, SLOTH`)
}

func TestParse_CodeSharedAcrossPartiesIsError(t *testing.T) {
	// Stone's lowercase spelling still collides: codes are uppercased on
	// parse, matching the API's rsvp_code normalization.
	_, err := guestimport.Parse(strings.NewReader(buildCSV(
		`Dana,Cole,Dana Cole,Robin,Friend,College,UTD,Cole,1,,,,,,,,,No,Yes,PEPPER`,
		`Eli,Stone,Eli Stone,Robin,Friend,College,UTD,Stone,1,,,,,,,,,No,Yes,pepper`,
	)))
	require.Error(t, err)
	require.Contains(t, err.Error(), `party "Stone": Code value "PEPPER" is already used by party "Cole"`)
}

func TestParse_CodesAreUppercased(t *testing.T) {
	// The API normalizes rsvp_code to uppercase (mod:"ucase"); the import does
	// the same, so a lowercase sheet entry cannot import an unreachable code
	// and a case-only repeat is not a conflict.
	plan := parseT(t,
		`Dana,Cole,Dana Cole,Robin,Friend,College,UTD,Cole,1,,,,,,,,,No,Yes,pepper`,
		`Eli,Cole,Eli Cole,Robin,Friend,College,UTD,Cole,1,,,,,,,,,No,Yes,Pepper`,
	)
	require.Empty(t, plan.Warnings)
	require.Equal(t, pointerutil.String("PEPPER"), plan.Parties[0].Party.RSVPCode)
}

func TestParse_CodeOnThePrimaryRowCoversTheParty(t *testing.T) {
	// The primary row carries the code; a later blank row and a later identical
	// repeat are both fine, with no warning.
	plan := parseT(t,
		`Dana,Cole,Dana Cole,Robin,Friend,College,UTD,Cole,1,,,,,,,,,No,Yes,PEPPER`,
		`Eli,Cole,Eli Cole,Robin,Friend,College,UTD,Cole,1,,,,,,,,,No,Yes,`,
		`Fay,Cole,Fay Cole,Robin,Friend,College,UTD,Cole,1,,,,,,,,,No,Yes,PEPPER`,
	)
	require.Empty(t, plan.Warnings)
	require.Equal(t, pointerutil.String("PEPPER"), plan.Parties[0].Party.RSVPCode)
}

func TestParse_CodeOnlyOnANonPrimaryRowIsError(t *testing.T) {
	// Party codes are read from the primary row; a personalized code stranded
	// on a later row would otherwise be dropped (and replaced by a generated
	// one) silently, so it fails the parse.
	_, err := guestimport.Parse(strings.NewReader(buildCSV(
		`Dana,Cole,Dana Cole,Robin,Friend,College,UTD,Cole,1,,,,,,,,,No,Yes,`,
		`Eli,Cole,Eli Cole,Robin,Friend,College,UTD,Cole,1,,,,,,,,,No,Yes,PEPPER`,
	)))
	require.Error(t, err)
	require.Contains(t, err.Error(), `party "Cole": Code value "PEPPER" must be on the party's first row (the primary guest)`)
}

func TestParse_ConflictingAddressFieldsWarnAndKeepThePrimaryRows(t *testing.T) {
	// Eli's row disagrees on every address field (one warning each, with the
	// column named, so a mislabeled or dropped cells() entry fails here);
	// Fay's repeats the primary's address identically and warns about
	// nothing. The primary row's values win throughout.
	plan := parseT(t,
		`Dana,Cole,Dana Cole,Robin,Friend,College,UTD,Cole,1,,,12 Oak Ave,Unit 1,Austin,TX,78701,United States,No,Yes,`,
		`Eli,Cole,Eli Cole,Robin,Friend,College,UTD,Cole,1,,,99 Elm St,Unit 9,Dallas,CA,90210,Canada,No,Yes,`,
		`Fay,Cole,Fay Cole,Robin,Friend,College,UTD,Cole,1,,,12 Oak Ave,Unit 1,Austin,TX,78701,United States,No,Yes,`,
	)
	party := plan.Parties[0].Party
	require.Equal(t, pointerutil.String("12 Oak Ave"), party.AddressLine1)
	require.Equal(t, pointerutil.String("Unit 1"), party.AddressLine2)
	require.Equal(t, pointerutil.String("Austin"), party.City)
	require.Equal(t, pointerutil.String("TX"), party.StateOrProvince)
	require.Equal(t, pointerutil.String("78701"), party.PostalCode)
	require.Equal(t, pointerutil.String("United States"), party.Country)

	require.Len(t, plan.Warnings, 6)
	for i, want := range []string{
		`conflicting Address 1 values; keeping the primary row's "12 Oak Ave"`,
		`conflicting Address 2 values; keeping the primary row's "Unit 1"`,
		`conflicting City values; keeping the primary row's "Austin"`,
		`conflicting State values; keeping the primary row's "TX"`,
		`conflicting ZIP values; keeping the primary row's "78701"`,
		`conflicting Country values; keeping the primary row's "United States"`,
	} {
		require.Contains(t, plan.Warnings[i], `party "Cole": `+want)
	}
}

func TestParse_AddressOnlyOnANonPrimaryRowIsIgnoredWithAWarning(t *testing.T) {
	// Party address fields come from the primary row alone; a value that
	// appears only on a later row is not imported, but the warning keeps it
	// from disappearing without a trace.
	plan := parseT(t,
		`Dana,Cole,Dana Cole,Robin,Friend,College,UTD,Cole,1,,,,,,,,,No,Yes,`,
		`Eli,Cole,Eli Cole,Robin,Friend,College,UTD,Cole,1,,,99 Elm St,,,,,,No,Yes,`,
	)
	require.Nil(t, plan.Parties[0].Party.AddressLine1)
	require.Len(t, plan.Warnings, 1)
	require.Contains(t, plan.Warnings[0], `party "Cole": Address 1 value "99 Elm St" on a non-primary row was ignored; party address fields are read from the first row`)
}

func TestParse_LineNumbersStayAccurateAcrossMultilineQuotedCells(t *testing.T) {
	// The first data row's Address 1 cell contains a newline, so the record
	// spans file lines 2-3 and the bad row below it starts on file line 4.
	// Problem messages must report the real file line, not the record index.
	_, err := guestimport.Parse(strings.NewReader(buildCSV(
		"Dana,Cole,Dana Cole,Robin,Friend,College,UTD,Cole,1,,,\"12 Oak Ave\nApt 3\",,Austin,TX,78701,United States,No,Yes,",
		`Eli,Stone,Eli Stone,Narnia,Friend,College,UTD,Stone,1,,,,,,,,,No,Yes,`,
	)))
	require.Error(t, err)
	require.Contains(t, err.Error(), `line 4 (Eli Stone): Kingdom must be one of Robin or Madeline, got "Narnia"`)
}

func TestParse_MissingRequiredColumnIsError(t *testing.T) {
	_, err := guestimport.Parse(strings.NewReader("First,Last,Full\nDana,Cole,Dana Cole\n"))
	require.Error(t, err)
	require.Contains(t, err.Error(), "csv is missing expected column(s)")
	require.Contains(t, err.Error(), "Kingdom")
	require.Contains(t, err.Error(), "ZIP")

	// Every header in the export is load-bearing: renaming any single one must
	// fail the parse and report that column by name, so no column can quietly
	// fall out of the required set and import wrong data.
	columns := strings.Split(csvHeader, ",")
	for i, col := range columns {
		mutated := slices.Clone(columns)
		mutated[i] = "Bogus"
		_, err := guestimport.Parse(strings.NewReader(strings.Join(mutated, ",") + "\n"))
		require.Error(t, err, "renaming %q must fail the parse", col)
		require.Contains(t, err.Error(), col, "renaming %q must be reported as missing", col)
	}
}

func TestParse_DuplicateRequiredColumnIsError(t *testing.T) {
	// A stale copy of a known column would make the mapping silently bind to
	// whichever copy comes last, so it fails instead.
	_, err := guestimport.Parse(strings.NewReader(csvHeader + ",City\nDana,Cole,Dana Cole,Robin,Friend,College,UTD,Cole,1,,,,,,,,,No,Yes,,Austin\n"))
	require.Error(t, err)
	require.Contains(t, err.Error(), "csv has duplicate column(s): City")
}

func TestParse_UnknownExtraColumnsAreIgnored(t *testing.T) {
	// The sheet grows scratch columns from time to time; anything the parser
	// does not recognize must pass through harmlessly.
	plan, err := guestimport.Parse(strings.NewReader(
		csvHeader + ",Notes\n" +
			`Dana,Cole,Dana Cole,Robin,Friend,College,UTD,Cole,1,,,,,,,,,No,Yes,PEPPER,remind dana` + "\n"))
	require.NoError(t, err)
	require.Len(t, plan.Parties, 1)
	require.Equal(t, pointerutil.String("PEPPER"), plan.Parties[0].Party.RSVPCode)
	require.Equal(t, "Dana Cole", plan.Parties[0].Guests[0].FullName)
}
