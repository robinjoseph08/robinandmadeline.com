// Package guestimport turns the couple's Google Sheets guest-list export (a
// CSV) into party and guest records. It is the engine behind the one-time
// cmd/scripts/import-csv script: Parse reads, groups, and validates the CSV
// into a Plan without touching the database, and Import writes a Plan inside a
// single all-or-nothing transaction.
//
// The sheet's taxonomy maps onto the domain language (CONTEXT.md): Kingdom is
// the party's side, Phylum its relation, Class its circles, Order the guest's
// tags, and "Family (Party)" the party grouping key. The Prefix column and the
// trailing junk "Column N" columns are ignored.
package guestimport

import (
	"encoding/csv"
	"fmt"
	"io"
	"slices"
	"strconv"
	"strings"

	"github.com/pkg/errors"
	"github.com/robinjoseph08/golib/pointerutil"
	"github.com/robinjoseph08/robinandmadeline.com/pkg/models"
)

// Plan is the validated, in-memory result of parsing the guest-list CSV:
// every party with its guests, in sheet order, plus the non-fatal warnings the
// operator should review. A Plan's parties have no IDs, info tokens, or
// timestamps yet; Import fills those. A nil RSVPCode means "generate one"
// (the sheet's blank or literal RANDOM); a non-nil one is the couple's
// personalized code, preserved as-is.
type Plan struct {
	Parties []*PartyPlan

	// SkippedBlankRows counts rows with no name at all (the sheet keeps some
	// fully blank spacer rows), which are skipped rather than imported.
	SkippedBlankRows int

	// Warnings are non-fatal data observations (size mismatches, blank
	// Child?/Drinking? cells, conflicting addresses) for the operator to fix in
	// the admin afterward. Anything that would import wrong data is a Parse
	// error instead, never a warning.
	Warnings []string
}

// PartyPlan is one party to import together with its guests in sheet order.
// The first guest is the party's primary.
type PartyPlan struct {
	Party  *models.Party
	Guests []*models.Guest
}

// Sheet column headers the import reads. The export has more columns (Prefix,
// "Column 1".."Column 11"); anything not listed here is ignored.
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
	colAddress     = "Address"
	colCity        = "City"
	colChild       = "Child?"
	colDrinking    = "Drinking?"
	colCode        = "Code"
	rsvpCodeRandom = "RANDOM" // the sheet's marker for "generate a code", same as blank
)

// requiredColumns are the headers Parse insists on; a missing one means the
// wrong file (or a re-arranged sheet) and fails immediately.
var requiredColumns = []string{
	colFirst, colLast, colFull, colKingdom, colPhylum, colClass, colOrder,
	colParty, colSize, colPhone, colEmail, colAddress, colCity, colChild,
	colDrinking, colCode,
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
// before party grouping. line is the 1-based CSV line number for messages.
type parsedRow struct {
	line       int
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
	code       string // "" means generate at import time
	address    string
	city       string
	size       string
}

// parser accumulates rows, warnings, and problems across a Parse run.
// Problems are hard errors (they would import wrong data); they are collected
// rather than returned one at a time so the operator fixes the sheet once.
type parser struct {
	rows     []parsedRow
	warnings []string
	problems []string
	skipped  int

	blankChild    int
	blankDrinking int
}

// Parse reads the guest-list CSV and returns the import Plan: guests grouped
// into parties by the "Family (Party)" column, in sheet order, with all
// party-level fields derived from the rows. Fully blank rows (no name) are
// skipped and counted. Any data problem that would import wrong records (a
// named row without a party, an unknown Kingdom/Phylum/Class value, codes
// conflicting within or duplicated across parties) fails the whole parse,
// reporting every problem at once.
func Parse(r io.Reader) (*Plan, error) {
	cr := csv.NewReader(r)
	// The export's trailing junk columns are not always consistent; index by
	// header name and tolerate ragged rows instead of enforcing a fixed width.
	cr.FieldsPerRecord = -1

	header, err := cr.Read()
	if err == io.EOF {
		return nil, errors.New("csv is empty")
	}
	if err != nil {
		return nil, errors.Wrap(err, "read csv")
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
// row, failing with the full list of missing columns when the file does not
// look like the guest-list export.
func headerIndex(header []string) (map[string]int, error) {
	idx := make(map[string]int, len(header))
	for i, name := range header {
		idx[strings.TrimSpace(name)] = i
	}
	var missing []string
	for _, name := range requiredColumns {
		if _, ok := idx[name]; !ok {
			missing = append(missing, name)
		}
	}
	if len(missing) > 0 {
		return nil, errors.Errorf("csv is missing expected column(s): %s", strings.Join(missing, ", "))
	}
	return idx, nil
}

// parseRow maps one data row into a parsedRow, recording problems and
// warnings. Rows with no name at all are blank spacers and are skipped.
func (p *parser) parseRow(line int, record []string, idx map[string]int) {
	get := func(col string) string {
		i := idx[col]
		if i >= len(record) {
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
	problem := func(format string, args ...any) {
		p.problems = append(p.problems, fmt.Sprintf("line %d (%s): ", line, name)+fmt.Sprintf(format, args...))
	}

	row := parsedRow{
		line:      line,
		fullName:  name,
		partyName: get(colParty),
		email:     optional(get(colEmail)),
		phone:     optional(get(colPhone)),
		tags:      splitMulti(get(colOrder)),
		address:   get(colAddress),
		city:      get(colCity),
		size:      get(colSize),
	}

	// The user guarantees every named row of the final sheet has a party; a
	// missing one here means the wrong file or an unfinished sheet, so it is a
	// hard error rather than a guessed grouping.
	if row.partyName == "" {
		problem("missing %s value", colParty)
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
	if code := get(colCode); !strings.EqualFold(code, rsvpCodeRandom) {
		row.code = code
	}

	p.rows = append(p.rows, row)
}

// buildPlan groups the parsed rows into parties (in first-appearance order)
// and derives each party's fields from its rows, recording cross-row problems
// (conflicting sides, relations, or codes; codes shared across parties) and
// warnings (size mismatches, conflicting addresses).
func (p *parser) buildPlan() *Plan {
	groups := make(map[string][]parsedRow)
	var order []string
	for _, row := range p.rows {
		if row.partyName == "" {
			continue // already a problem; nothing to group
		}
		if _, seen := groups[row.partyName]; !seen {
			order = append(order, row.partyName)
		}
		groups[row.partyName] = append(groups[row.partyName], row)
	}

	plan := &Plan{SkippedBlankRows: p.skipped}
	codeOwners := make(map[string]string) // explicit code -> party that claimed it
	for _, name := range order {
		plan.Parties = append(plan.Parties, p.buildParty(name, groups[name], codeOwners))
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

// buildParty derives one party and its guests from the party's rows. The
// party-level fields must agree across rows (side, relation, code); circles
// are the union across rows; the address is the first non-blank with a
// warning when rows disagree; the first guest is the primary.
func (p *parser) buildParty(name string, rows []parsedRow, codeOwners map[string]string) *PartyPlan {
	party := &models.Party{
		Name:           name,
		Side:           rows[0].side,
		Relation:       rows[0].relation,
		Circle:         []string{},
		InvitationType: models.InvitationPhysical,
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
	var codes []string
	guests := make([]*models.Guest, 0, len(rows))
	for i, row := range rows {
		for _, c := range row.circles {
			if !seenCircle[c] {
				seenCircle[c] = true
				party.Circle = append(party.Circle, c)
			}
		}
		if row.code != "" && !slices.Contains(codes, row.code) {
			codes = append(codes, row.code)
		}
		if row.address != "" {
			if party.AddressLine1 == nil {
				party.AddressLine1 = pointerutil.String(row.address)
			} else if *party.AddressLine1 != row.address {
				warn("conflicting %s values; keeping %q", colAddress, *party.AddressLine1)
			}
		}
		if row.city != "" {
			if party.City == nil {
				party.City = pointerutil.String(row.city)
			} else if *party.City != row.city {
				warn("conflicting %s values; keeping %q", colCity, *party.City)
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
		})
	}

	switch len(codes) {
	case 0: // all blank/RANDOM: leave nil for Import to generate
	case 1:
		if owner, taken := codeOwners[codes[0]]; taken {
			problem("%s value %q is already used by party %q", colCode, codes[0], owner)
		} else {
			codeOwners[codes[0]] = name
			party.RSVPCode = pointerutil.String(codes[0])
		}
	default:
		problem("conflicting %s values across its rows: %s", colCode, strings.Join(codes, ", "))
	}

	// Size is informational; the actual guest count wins, but a mismatch is
	// worth a look (a missing row, or stale sheet math).
	if size := firstNonBlankSize(rows); size != "" {
		if n, err := strconv.Atoi(size); err != nil {
			warn("unparseable %s value %q", colSize, size)
		} else if n != len(guests) {
			warn("%s column says %d but %d guest(s) were imported", colSize, n, len(guests))
		}
	}

	return &PartyPlan{Party: party, Guests: guests}
}

// firstNonBlankSize returns the party's first non-blank Size cell, or "".
func firstNonBlankSize(rows []parsedRow) string {
	for _, row := range rows {
		if row.size != "" {
			return row.size
		}
	}
	return ""
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
// contact fields persist as SQL NULL.
func optional(s string) *string {
	if s == "" {
		return nil
	}
	return pointerutil.String(s)
}
