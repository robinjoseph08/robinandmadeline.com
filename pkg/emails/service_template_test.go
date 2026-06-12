package emails_test

import (
	"testing"

	"github.com/robinjoseph08/robinandmadeline.com/pkg/emails"
	"github.com/robinjoseph08/robinandmadeline.com/pkg/errcodes"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestCreateTemplate_PersistsAndLists(t *testing.T) {
	f := newFixtures(t)

	tpl := createTemplateT(t, f, templateInput())
	assert.NotEmpty(t, tpl.ID)
	assert.Equal(t, "Save the date", tpl.Name)

	list, total, err := f.emails.ListTemplates(ctx())
	require.NoError(t, err)
	assert.Equal(t, 1, total)
	require.Len(t, list, 1)
	assert.Equal(t, tpl.ID, list[0].ID)
	// Merge field placeholders are stored unresolved.
	assert.Equal(t, "Save the date, {{guest_name}}!", list[0].Subject)
}

func TestListTemplates_NewestFirst(t *testing.T) {
	f := newFixtures(t)

	first := createTemplateT(t, f, templateInput())
	in := templateInput()
	in.Name = "Reminder"
	second := createTemplateT(t, f, in)

	list, total, err := f.emails.ListTemplates(ctx())
	require.NoError(t, err)
	assert.Equal(t, 2, total)
	require.Len(t, list, 2)
	assert.Equal(t, second.ID, list[0].ID)
	assert.Equal(t, first.ID, list[1].ID)
}

func TestGetTemplate_ReturnsTemplate(t *testing.T) {
	f := newFixtures(t)
	tpl := createTemplateT(t, f, templateInput())

	got, err := f.emails.GetTemplate(ctx(), tpl.ID)
	require.NoError(t, err)
	assert.Equal(t, tpl.ID, got.ID)
	assert.Equal(t, tpl.Body, got.Body)
}

func TestGetTemplate_MissingIs404(t *testing.T) {
	f := newFixtures(t)
	_, err := f.emails.GetTemplate(ctx(), "00000000-0000-0000-0000-000000000000")
	assertErrCode(t, err, errcodes.CodeNotFound)
}

func TestUpdateTemplate_ReplacesFields(t *testing.T) {
	f := newFixtures(t)
	tpl := createTemplateT(t, f, templateInput())

	updated, err := f.emails.UpdateTemplate(ctx(), tpl.ID, emails.UpdateTemplatePayload{
		Name:    "Save the date v2",
		Subject: "New subject",
		Body:    "New body",
	})
	require.NoError(t, err)
	assert.Equal(t, "Save the date v2", updated.Name)

	got, err := f.emails.GetTemplate(ctx(), tpl.ID)
	require.NoError(t, err)
	assert.Equal(t, "New subject", got.Subject)
	assert.Equal(t, "New body", got.Body)
}

func TestUpdateTemplate_MissingIs404(t *testing.T) {
	f := newFixtures(t)
	_, err := f.emails.UpdateTemplate(ctx(), "00000000-0000-0000-0000-000000000000", emails.UpdateTemplatePayload{
		Name: "x", Subject: "y", Body: "z",
	})
	assertErrCode(t, err, errcodes.CodeNotFound)
}

func TestDeleteTemplate_RemovesTemplate(t *testing.T) {
	f := newFixtures(t)
	tpl := createTemplateT(t, f, templateInput())

	require.NoError(t, f.emails.DeleteTemplate(ctx(), tpl.ID))

	_, err := f.emails.GetTemplate(ctx(), tpl.ID)
	assertErrCode(t, err, errcodes.CodeNotFound)
}

func TestDeleteTemplate_MissingIs404(t *testing.T) {
	f := newFixtures(t)
	err := f.emails.DeleteTemplate(ctx(), "00000000-0000-0000-0000-000000000000")
	assertErrCode(t, err, errcodes.CodeNotFound)
}
