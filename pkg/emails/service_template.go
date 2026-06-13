package emails

import (
	"context"
	"time"

	"github.com/pkg/errors"
	"github.com/robinjoseph08/robinandmadeline.com/pkg/errcodes"
	"github.com/robinjoseph08/robinandmadeline.com/pkg/models"
)

// ListTemplates returns every template, newest first, and the total count.
// Templates number at most a handful, so there is no filtering or paging.
func (s *Service) ListTemplates(ctx context.Context) ([]*models.EmailTemplate, int, error) {
	var templates []*models.EmailTemplate
	total, err := s.db.NewSelect().Model(&templates).
		Order("et.created_at DESC", "et.id DESC").
		ScanAndCount(ctx)
	if err != nil {
		return nil, 0, errors.Wrap(err, "list email templates")
	}
	return templates, total, nil
}

// GetTemplate returns one template by id, or a 404.
func (s *Service) GetTemplate(ctx context.Context, id string) (*models.EmailTemplate, error) {
	return loadTemplate(ctx, s.db, id)
}

// CreateTemplate inserts a template. The payload is already bound, trimmed,
// and validated by the binder.
func (s *Service) CreateTemplate(ctx context.Context, in CreateTemplatePayload) (*models.EmailTemplate, error) {
	now := time.Now()
	tpl := &models.EmailTemplate{
		ID:        newID(),
		Name:      in.Name,
		Subject:   in.Subject,
		Body:      in.Body,
		CreatedAt: now,
		UpdatedAt: now,
	}
	if _, err := s.db.NewInsert().Model(tpl).Exec(ctx); err != nil {
		return nil, errors.Wrap(err, "insert email template")
	}
	return tpl, nil
}

// UpdateTemplate replaces a template's editable fields (PUT-style). Returns a
// 404 when the template does not exist. Past sends are unaffected: a send
// snapshots its subject/body at dispatch time.
func (s *Service) UpdateTemplate(ctx context.Context, id string, in UpdateTemplatePayload) (*models.EmailTemplate, error) {
	tpl, err := loadTemplate(ctx, s.db, id)
	if err != nil {
		return nil, err
	}
	tpl.Name = in.Name
	tpl.Subject = in.Subject
	tpl.Body = in.Body
	tpl.UpdatedAt = time.Now()
	if _, err := s.db.NewUpdate().Model(tpl).WherePK().Exec(ctx); err != nil {
		return nil, errors.Wrap(err, "update email template")
	}
	return tpl, nil
}

// DeleteTemplate removes a template. Past sends that referenced it survive
// with their template_id nulled (FK SET NULL): the send's subject/body are
// snapshots, so nothing else is lost. Returns a 404 when it does not exist.
func (s *Service) DeleteTemplate(ctx context.Context, id string) error {
	res, err := s.db.NewDelete().Model((*models.EmailTemplate)(nil)).Where("et.id = ?", id).Exec(ctx)
	if err != nil {
		return errors.Wrap(err, "delete email template")
	}
	affected, err := res.RowsAffected()
	if err != nil {
		return errors.Wrap(err, "delete email template rows affected")
	}
	if affected == 0 {
		return errcodes.NotFound("email template")
	}
	return nil
}
