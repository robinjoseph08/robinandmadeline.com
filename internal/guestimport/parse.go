// Package guestimport turns the couple's Google Sheets guest-list export (a
// CSV) into party and guest records. It is the engine behind the one-time
// cmd/scripts/import-csv script: Parse reads, groups, and validates the CSV
// into a Plan without touching the database, and Import writes a Plan inside a
// single all-or-nothing transaction.
//
// The sheet's taxonomy maps onto the domain language (CONTEXT.md): Kingdom is
// the party's side, Phylum its relation, Class its circles, Order the guest's
// tags, and "Family (Party)" the party grouping key. Size is per-row: a guest
// with Size N brings N-1 unnamed plus-ones, imported as placeholder guests
// (blank means 1, just the named guest). Party-level details (the mailing
// address columns and Code) are read from each party's first row, its primary
// guest; later rows leave them blank or repeat them identically. Named rows
// whose party cell is still blank (a draft of the sheet) are filtered out and
// counted rather than imported. Any column not named in requiredColumns is
// ignored.
package guestimport

import (
	"encoding/csv"
	"fmt"
	"io"
	"slices"
	"strconv"
	"strings"
	"unicode"

	"github.com/pkg/errors"
	"github.com/robinjoseph08/golib/pointerutil"
	"github.com/robinjoseph08/robinandmadeline.com/pkg/binder"
	"github.com/robinjoseph08/robinandmadeline.com/pkg/models"
)

// Plan is the validated, in-memory result of parsing the guest-list CSV:
// every party with its guests, in sheet order, plus the non-fatal warnings the
// operator should review. A Plan's parties have no IDs, info tokens, or
// timestamps yet; Import fills those. A nil RSVPCode means "generate one"
// (the primary row's blank or literal RANDOM); a non-nil one is the couple's
// personalized code, uppercased to match the API's rsvp_code normalization.
type Plan struct {
	Parties []*PartyPlan

	// SkippedBlankRows counts rows with no name at all (the sheet keeps some
	// fully blank spacer rows), which are skipped rather than imported.
	SkippedBlankRows int

	// SkippedNoPartyRows counts named rows whose "Family (Party)" cell is
	// blank. The final sheet assigns every named row a party, but drafts leave
	// some unassigned; those rows are filtered out before any validation so a
	// draft export can still be test-imported, and counted so the omission
	// stays visible.
	SkippedNoPartyRows int

	// Warnings are non-fatal data observations (blank Child?/Drinking? cells,
	// address values off the primary row, codes on skipped no-party rows) for
	// the operator to fix in the admin or the sheet afterward. Anything that
	// would import wrong data is a Parse error instead, never a warning.
	Warnings []string
}

// PartyPlan is one party to import together with its guests in sheet order.
// The first guest is the party's primary.
type PartyPlan struct {
	Party  *models.Party
	Guests []*models.Guest
}

// Sheet column headers the import reads. Any other column in the export is
// ignored.
const (
	colFirst       = "First"
	colLast        = "Last"
	colFull        = "Full"
	colKingdom     = "Kingdom"
	colPhylum      = "Phylum"
	colClass       = "Class"
	colOrder       = "Order"
	colParty       = "Family (Party)"
	colSize        = "Size"
	colPhone       = "Phone"
	colEmail       = "Email"
	colAddress1    = "Address 1"
	colAddress2    = "Address 2"
	colCity        = "City"
	colState       = "State"
	colZIP         = "ZIP"
	colCountry     = "Country"
	colChild       = "Child?"
	colDrinking    = "Drinking?"
	colCode        = "Code"
	rsvpCodeRandom = "RANDOM" // the sheet's marker for "generate a code", same as blank
)

// requiredColumns are the headers Parse insists on; a missing one means the
// wrong file (or a re-arranged sheet) and fails immediately.
var requiredColumns = []string{
	colFirst, colLast, colFull, colKingdom, colPhylum, colClass, colOrder,
	colParty, colSize, colPhone, colEmail, colAddress1, colAddress2, colCity,
	colState, colZIP, colCountry, colChild, colDrinking, colCode,
}

// sideByKingdom maps the sheet's Kingdom values to the party side enum.
var sideByKingdom = map[string]string{
	"Robin":    models.SideRobin,
	"Madeline": models.SideMadeline,
}

// relationByPhylum maps the sheet's Phylum values to the party relation enum.
var relationByPhylum = map[string]string{
	"Family": models.RelationFamily,
	"Friend": models.RelationFriend,
}

// knownCircles is the closed circle value set; the sheet's Class values must
// match exactly (the generated TypeScript Circle union has no escape hatch).
var knownCircles = map[string]bool{
	models.CircleImmediate: true,
	models.CircleExtended:  true,
	models.CircleCollege:   true,
	models.CircleWork:      true,
	models.CircleChildhood: true,
	models.CircleOther:     true,
}

// parsedRow is one named CSV data row after per-row mapping and validation,
// before party grouping. Row-level problem messages cite the file line as they
// are recorded in parseRow; grouped rows no longer need it.
type parsedRow struct {
	fullName   string
	partyName  string
	side       string
	relation   string
	circles    []string
	tags       []string
	email      *string
	phone      *string
	isChild    bool
	isDrinking bool
	code       string // uppercased explicit code; "" (a blank or RANDOM cell) means none
	address    addressCells
	size       int // this guest plus their unnamed plus-ones; always >= 1
}

// addressCells carries one row's mailing-address cells. The party's address
// comes from its primary row's cells alone; non-primary rows are only compared
// against them to warn about stray values.
type addressCells struct {
	line1, line2, city, state, postalCode, country string
}

// addressCell pairs one cell value with its sheet column name, for uniform
// compare-and-report loops over a row's address cells.
type addressCell struct {
	col, value string
}

// cells returns the row's address cells with their column names, in sheet
// order.
func (a addressCells) cells() []addressCell {
	return []addressCell{
		{colAddress1, a.line1},
		{colAddress2, a.line2},
		{colCity, a.city},
		{colState, a.state},
		{colZIP, a.postalCode},
		{colCountry, a.country},
	}
}

// parser accumulates rows, warnings, and problems across a Parse run.
// Problems are hard errors (they would import wrong data); they are collected
// rather than returned one at a time so the operator fixes the sheet once.
type parser struct {
	rows     []parsedRow
	warnings []string
	problems []string
	skipped  int
	noParty  int

	// noPartyCodes names the skipped no-party rows that carry an explicit
	// code: a credential that would otherwise vanish without a trace, so the
	// names go into an aggregate warning.
	noPartyCodes []string

	blankChild    int
	blankDrinking int
}

// Parse reads the guest-list CSV and returns the import Plan: guests grouped
// into parties by the "Family (Party)" column, in sheet order, with the
// party-level fields read from each party's first row, its primary guest.
// Fully blank rows (no name) and named rows with no party yet are skipped and
// counted separately. Any data problem that would import wrong records (an
// unknown Kingdom/Phylum/Class value, a code off the primary row, codes
// conflicting within or duplicated across parties) fails the whole parse,
// reporting every problem at once.
func Parse(r io.Reader) (*Plan, error) {
	cr := csv.NewReader(r)
	// The export's column set has shifted before; index by header name and
	// tolerate ragged rows instead of enforcing a fixed width.
	cr.FieldsPerRecord = -1

	header, err := cr.Read()
	if err == io.EOF {
		return nil, errors.New("csv is empty")
	}
	if err != nil {
		return nil, errors.Wrap(err, "read csv")
	}
	// An Excel round-trip prepends a UTF-8 BOM, which TrimSpace does not
	// remove and which would misreport the first column as missing.
	if len(header) > 0 {
		header[0] = strings.TrimPrefix(header[0], "\ufeff")
	}

	idx, err := headerIndex(header)
	if err != nil {
		return nil, err
	}

	p := &parser{}
	for {
		record, err := cr.Read()
		if err == io.EOF {
			break
		}
		if err != nil {
			return nil, errors.Wrap(err, "read csv")
		}
		// FieldPos gives the real 1-based file line, which stays correct even
		// when a quoted cell contains a newline and a record spans lines.
		line, _ := cr.FieldPos(0)
		p.parseRow(line, record, idx)
	}

	plan := p.buildPlan()
	if len(p.problems) > 0 {
		return nil, errors.Errorf("csv has %d problem(s):\n  - %s",
			len(p.problems), strings.Join(p.problems, "\n  - "))
	}
	return plan, nil
}

// headerIndex maps each required column name to its position in the header
// row, failing when the file does not look like the guest-list export. Missing
// columns and duplicated ones (a stale copy left in the sheet would silently
// bind the mapping to whichever copy comes last) are all reported in one
// error, so the operator fixes the sheet once.
func headerIndex(header []string) (map[string]int, error) {
	idx := make(map[string]int, len(header))
	seen := make(map[string]int, len(header))
	for i, name := range header {
		n := strings.TrimSpace(name)
		idx[n] = i
		seen[n]++
	}
	var missing, duplicated []string
	for _, name := range requiredColumns {
		switch {
		case seen[name] == 0:
			missing = append(missing, name)
		case seen[name] > 1:
			duplicated = append(duplicated, name)
		}
	}
	var parts []string
	if len(missing) > 0 {
		parts = append(parts, "is missing expected column(s): "+strings.Join(missing, ", "))
	}
	if len(duplicated) > 0 {
		parts = append(parts, "has duplicate column(s): "+strings.Join(duplicated, ", "))
	}
	if len(parts) > 0 {
		return nil, errors.Errorf("csv %s", strings.Join(parts, "; "))
	}
	return idx, nil
}

// parseRow maps one data row into a parsedRow, recording problems and
// warnings. Rows with no name at all are blank spacers and are skipped; named
// rows with no party yet are filtered out (before any validation) and counted.
func (p *parser) parseRow(line int, record []string, idx map[string]int) {
	get := func(col string) string {
		i, ok := idx[col]
		if !ok || i >= len(record) {
			return ""
		}
		return strings.TrimSpace(record[i])
	}

	first, last, full := get(colFirst), get(colLast), get(colFull)
	if first == "" && last == "" && full == "" {
		p.skipped++
		return
	}

	name := full
	if name == "" {
		name = strings.Join(strings.Fields(first+" "+last), " ")
	}

	// The final sheet assigns every named row a party, but drafts leave some
	// blank while grouping is still in progress. Those rows are not imported,
	// so none of their other cells are validated or tallied either, with one
	// exception: an explicit code on a skipped row is a credential that would
	// vanish silently, so the row's name is collected into a warning.
	if get(colParty) == "" {
		p.noParty++
		if code := get(colCode); code != "" && !strings.EqualFold(code, rsvpCodeRandom) {
			p.noPartyCodes = append(p.noPartyCodes, name)
		}
		return
	}
	problem := func(format string, args ...any) {
		p.problems = append(p.problems, fmt.Sprintf("line %d (%s): ", line, name)+fmt.Sprintf(format, args...))
	}

	row := parsedRow{
		fullName:  name,
		partyName: get(colParty),
		email:     optional(get(colEmail)),
		phone:     optionalPhone(get(colPhone)),
		tags:      splitMulti(get(colOrder)),
		address: addressCells{
			line1:      get(colAddress1),
			line2:      get(colAddress2),
			city:       get(colCity),
			state:      get(colState),
			postalCode: get(colZIP),
			country:    get(colCountry),
		},
		size: 1,
	}

	// Size is per-row: this guest plus their unnamed plus-ones, expanded into
	// placeholder guests when the party is built. Blank means just the named
	// guest; anything else must be a positive count or the row's meaning is
	// unclear (a shifted column, or sheet math left over from another scheme).
	if s := get(colSize); s != "" {
		if n, err := strconv.Atoi(s); err != nil || n < 1 {
			problem("%s must be a positive whole number or blank, got %q", colSize, s)
		} else {
			row.size = n
		}
	}

	var ok bool
	if row.side, ok = sideByKingdom[get(colKingdom)]; !ok {
		problem("%s must be one of Robin or Madeline, got %q", colKingdom, get(colKingdom))
	}
	if row.relation, ok = relationByPhylum[get(colPhylum)]; !ok {
		problem("%s must be one of Family or Friend, got %q", colPhylum, get(colPhylum))
	}

	row.circles = splitMulti(get(colClass))
	for _, c := range row.circles {
		if !knownCircles[c] {
			problem("unknown %s value %q", colClass, c)
		}
	}

	// Blank Child?/Drinking? cells default to false (the schema default) and
	// are tallied into aggregate warnings so the couple can fill them in the
	// admin; an unrecognized value is a hard error (likely a shifted column).
	if row.isChild, ok = parseYesNo(get(colChild)); !ok {
		if get(colChild) == "" {
			p.blankChild++
		} else {
			problem("%s must be Yes, No, or blank, got %q", colChild, get(colChild))
		}
	}
	if row.isDrinking, ok = parseYesNo(get(colDrinking)); !ok {
		if get(colDrinking) == "" {
			p.blankDrinking++
		} else {
			problem("%s must be Yes, No, or blank, got %q", colDrinking, get(colDrinking))
		}
	}

	// The literal RANDOM marker means the same as a blank code: generate one.
	// Explicit codes are uppercased to match the API's rsvp_code normalization
	// (mod:"ucase"), so a lowercase sheet entry cannot import an unreachable
	// code or trip a case-only conflict.
	if code := get(colCode); !strings.EqualFold(code, rsvpCodeRandom) {
		row.code = strings.ToUpper(code)
	}

	p.rows = append(p.rows, row)
}

// buildPlan groups the parsed rows into parties (in first-appearance order)
// and derives each party's fields from its rows, recording cross-row problems
// (conflicting sides, relations, or codes; codes off the primary row or shared
// across parties) and warnings (address values off the primary row).
func (p *parser) buildPlan() *Plan {
	groups := make(map[string][]parsedRow)
	var order []string
	for _, row := range p.rows {
		if _, seen := groups[row.partyName]; !seen {
			order = append(order, row.partyName)
		}
		groups[row.partyName] = append(groups[row.partyName], row)
	}

	plan := &Plan{SkippedBlankRows: p.skipped, SkippedNoPartyRows: p.noParty}
	codeOwners := make(map[string]string) // explicit code -> party that claimed it
	for _, name := range order {
		plan.Parties = append(plan.Parties, p.buildParty(name, groups[name], codeOwners))
	}

	if len(p.noPartyCodes) > 0 {
		p.warnings = append(p.warnings, fmt.Sprintf("%d skipped no-party row(s) carry a %s value that was not imported: %s",
			len(p.noPartyCodes), colCode, strings.Join(p.noPartyCodes, ", ")))
	}
	if p.blankChild > 0 {
		p.warnings = append(p.warnings, fmt.Sprintf("%d guest(s) have a blank %s value; imported as not a child", p.blankChild, colChild))
	}
	if p.blankDrinking > 0 {
		p.warnings = append(p.warnings, fmt.Sprintf("%d guest(s) have a blank %s value; imported as not drinking", p.blankDrinking, colDrinking))
	}
	plan.Warnings = p.warnings
	return plan
}

// buildParty derives one party and its guests from the party's rows, in sheet
// order; the first row is the primary guest. The party-level details (the
// mailing address and the RSVP code) are read from the primary row alone:
// later rows normally leave them blank (a RANDOM code cell counts as blank),
// and a repeat identical to the primary's value is tolerated. A stray address
// value (differing, or present
// when the primary's is blank) warns and is ignored; a stray code is a
// problem, because a code is a guest-facing credential and importing the wrong
// one (or generating one while a personalized code sits ignored on a later
// row) is wrong data. Side and relation must agree across rows; circles are
// the union across rows. A row with Size N expands into the named guest
// followed immediately by its N-1 placeholder guests, so guest order (and the
// import's in-order IDs) keeps each placeholder next to its host.
func (p *parser) buildParty(name string, rows []parsedRow, codeOwners map[string]string) *PartyPlan {
	primary := rows[0]
	party := &models.Party{
		Name:           name,
		Side:           primary.side,
		Relation:       primary.relation,
		Circle:         []string{},
		InvitationType: models.InvitationPhysical,

		AddressLine1:    optional(primary.address.line1),
		AddressLine2:    optional(primary.address.line2),
		City:            optional(primary.address.city),
		StateOrProvince: optional(primary.address.state),
		PostalCode:      optional(primary.address.postalCode),
		Country:         optional(primary.address.country),
	}
	problem := func(format string, args ...any) {
		p.problems = append(p.problems, fmt.Sprintf("party %q: ", name)+fmt.Sprintf(format, args...))
	}
	warn := func(format string, args ...any) {
		p.warnings = append(p.warnings, fmt.Sprintf("party %q: ", name)+fmt.Sprintf(format, args...))
	}

	// Side and relation must agree across the party's rows. Distinct values are
	// collected (skipping blanks, which already failed per-row enum validation)
	// so a conflict is reported once per party, however many rows disagree.
	var sides, relations []string
	for _, row := range rows {
		if row.side != "" && !slices.Contains(sides, row.side) {
			sides = append(sides, row.side)
		}
		if row.relation != "" && !slices.Contains(relations, row.relation) {
			relations = append(relations, row.relation)
		}
	}
	if len(sides) > 1 {
		problem("conflicting %s values across its rows", colKingdom)
	}
	if len(relations) > 1 {
		problem("conflicting %s values across its rows", colPhylum)
	}

	seenCircle := make(map[string]bool)
	guests := make([]*models.Guest, 0, len(rows))
	for i, row := range rows {
		for _, c := range row.circles {
			if !seenCircle[c] {
				seenCircle[c] = true
				party.Circle = append(party.Circle, c)
			}
		}
		guests = append(guests, &models.Guest{
			FullName:   row.fullName,
			Email:      row.email,
			Phone:      row.phone,
			Tags:       row.tags,
			IsPrimary:  i == 0, // the first row of a party is its primary guest
			IsChild:    row.isChild,
			IsDrinking: row.isDrinking,
			Subscribed: true, // imported guests are born subscribed (ADR 0009)
		})
		guests = append(guests, placeholderGuests(row)...)
	}

	// Sweep the non-primary rows for stray party-level values the primary row
	// does not carry.
	primaryCells := primary.address.cells()
	var strayCodes []string
	for _, row := range rows[1:] {
		for i, c := range row.address.cells() {
			if c.value == "" || c.value == primaryCells[i].value {
				continue
			}
			if primaryCells[i].value == "" {
				warn("%s value %q on a non-primary row was ignored; party address fields are read from the first row", c.col, c.value)
			} else {
				warn("conflicting %s values; keeping the primary row's %q", c.col, primaryCells[i].value)
			}
		}
		if row.code != "" && row.code != primary.code && !slices.Contains(strayCodes, row.code) {
			strayCodes = append(strayCodes, row.code)
		}
	}

	switch {
	case primary.code == "":
		// Leave RSVPCode nil for Import to generate, unless a personalized
		// code is stranded on a later row, which would be dropped silently.
		for _, code := range strayCodes {
			problem("%s value %q must be on the party's first row (the primary guest)", colCode, code)
		}
	case len(strayCodes) > 0:
		problem("conflicting %s values across its rows: %s", colCode, strings.Join(append([]string{primary.code}, strayCodes...), ", "))
	default:
		if owner, taken := codeOwners[primary.code]; taken {
			problem("%s value %q is already used by party %q", colCode, primary.code, owner)
		} else {
			codeOwners[primary.code] = name
			party.RSVPCode = pointerutil.String(primary.code)
		}
	}

	return &PartyPlan{Party: party, Guests: guests}
}

// placeholderGuests builds a row's Size-1 placeholder guests: the unnamed
// plus-ones the named guest brings, each carrying its permanent descriptor in
// placeholder_text until the party fills in a real name during RSVP
// (CONTEXT.md). A single plus-one is "Guest of <host>"; several are numbered
// "Guest 1 of <host>", "Guest 2 of <host>". full_name starts as the same
// descriptor (naming during RSVP overwrites full_name, never the descriptor).
// Placeholders are never the party's primary, carry no contact info or tags,
// and default is_child/is_drinking to false; their blank-by-design fields are
// not tallied into the blank-cell warnings, which count real rows.
func placeholderGuests(row parsedRow) []*models.Guest {
	extras := row.size - 1
	guests := make([]*models.Guest, 0, extras)
	for n := 1; n <= extras; n++ {
		name := "Guest of " + row.fullName
		if extras > 1 {
			name = fmt.Sprintf("Guest %d of %s", n, row.fullName)
		}
		guests = append(guests, &models.Guest{
			FullName:        name,
			Tags:            []string{},
			PlaceholderText: pointerutil.String(name),
			Subscribed:      true, // consistent default (placeholders have no email)
		})
	}
	return guests
}

// splitMulti splits a multi-value cell ("Childhood, College") on commas,
// trimming whitespace, dropping empties, and de-duplicating while preserving
// order. It always returns a non-nil slice so text[] columns store '{}'.
func splitMulti(s string) []string {
	out := []string{}
	for _, part := range strings.Split(s, ",") {
		v := strings.TrimSpace(part)
		if v != "" && !slices.Contains(out, v) {
			out = append(out, v)
		}
	}
	return out
}

// parseYesNo maps the sheet's Yes/No cells to a bool; ok is false for blank or
// unrecognized values (the caller decides between defaulting and erroring).
func parseYesNo(s string) (value, ok bool) {
	switch {
	case strings.EqualFold(s, "Yes"):
		return true, true
	case strings.EqualFold(s, "No"):
		return false, true
	default:
		return false, false
	}
}

// optional returns nil for a blank cell and a pointer otherwise, so empty
// fields persist as SQL NULL.
func optional(s string) *string {
	if s == "" {
		return nil
	}
	return pointerutil.String(s)
}

// optionalPhone is optional for the Phone cell: a blank cell, or one holding
// only the invisible formatting runes a Google Sheets export can wrap a value
// in, becomes nil; any real number is normalized to canonical E.164
// (binder.NormalizePhone, the same step the request binder runs) so a sheet
// number matches one a guest later enters through the API, and the frontend
// formats both. The runes are stripped before the blank check and before
// parsing, since libphonenumber treats them as part of the number and would
// otherwise refuse it; a value that still is not dialable is kept as written.
// This mirrors the rsvp_code uppercasing in parseRow: the import deliberately
// replicates the API's normalizations so the two paths converge on one stored
// form.
func optionalPhone(s string) *string {
	stripped := stripFormatRunes(s)
	if stripped == "" {
		return nil
	}
	return pointerutil.String(binder.NormalizePhone(stripped))
}

// stripFormatRunes drops Unicode control and format characters (categories Cc
// and Cf) from a string. A Google Sheets export occasionally wraps a phone cell
// in directional-formatting marks (U+202D ... U+202C): they survive TrimSpace,
// are invisible, and block phone normalization, so they are removed before the
// number is parsed.
func stripFormatRunes(s string) string {
	return strings.Map(func(r rune) rune {
		if unicode.In(r, unicode.Cc, unicode.Cf) {
			return -1
		}
		return r
	}, s)
}
