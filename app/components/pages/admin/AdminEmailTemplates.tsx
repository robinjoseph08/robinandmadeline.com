import { Pencil, Plus, Trash2 } from "lucide-react";
import { useState } from "react";
import { Link } from "react-router-dom";
import { toast } from "sonner";

import {
  TemplateFormDialog,
  type TemplateFormPayload,
} from "@/components/pages/admin/emails/TemplateFormDialog";
import { TooltipIconButton } from "@/components/pages/admin/grid/grid-buttons";
import { Button } from "@/components/ui/button";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  useCreateEmailTemplate,
  useDeleteEmailTemplate,
  useEmailTemplates,
  useUpdateEmailTemplate,
} from "@/hooks/queries/emails";
import type { TemplateResponse } from "@/types/generated/emails";

/**
 * Admin email templates: list, create, edit, delete. Templates are reusable
 * subject/body pairs with merge field placeholders; the compose page loads one
 * as a starting point. Deleting one never touches past sends (they snapshot
 * their copy).
 */
export default function AdminEmailTemplates() {
  const templatesQuery = useEmailTemplates();
  const createTemplate = useCreateEmailTemplate();
  const updateTemplate = useUpdateEmailTemplate();
  const deleteTemplate = useDeleteEmailTemplate();

  const [dialogOpen, setDialogOpen] = useState(false);
  const [editTemplate, setEditTemplate] = useState<
    TemplateResponse | undefined
  >(undefined);

  const templates = templatesQuery.data?.items ?? [];

  const openCreate = () => {
    setEditTemplate(undefined);
    setDialogOpen(true);
  };

  const openEdit = (template: TemplateResponse) => {
    setEditTemplate(template);
    setDialogOpen(true);
  };

  const handleSubmit = async (payload: TemplateFormPayload) => {
    try {
      if (editTemplate) {
        await updateTemplate.mutateAsync({
          templateId: editTemplate.id,
          payload,
        });
        toast.success("Template updated");
      } else {
        await createTemplate.mutateAsync(payload);
        toast.success("Template created");
      }
      setDialogOpen(false);
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "Failed to save template",
      );
    }
  };

  const handleDelete = async (template: TemplateResponse) => {
    if (
      !window.confirm(
        `Delete ${template.name}? Past sends keep the copy they were sent with.`,
      )
    )
      return;
    try {
      await deleteTemplate.mutateAsync({ templateId: template.id });
      toast.success("Template deleted");
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "Failed to delete template",
      );
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold">Email Templates</h1>
          <p className="text-sm text-muted-foreground">
            {templatesQuery.data
              ? `${templatesQuery.data.total} template${templatesQuery.data.total === 1 ? "" : "s"}`
              : "Reusable emails with merge fields."}
          </p>
        </div>
        <div className="flex gap-2">
          <Button asChild variant="outline">
            <Link to="/admin/emails">Send history</Link>
          </Button>
          <Button onClick={openCreate}>
            <Plus />
            Add template
          </Button>
        </div>
      </div>

      {templatesQuery.isLoading ? (
        <p className="text-muted-foreground">Loading templates...</p>
      ) : templatesQuery.isError ? (
        <p className="text-destructive">{templatesQuery.error.message}</p>
      ) : templates.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          No templates yet. Add one to reuse it across sends, or compose a
          one-off from the compose page.
        </p>
      ) : (
        <div className="rounded-md border border-ink/10">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Name</TableHead>
                <TableHead>Subject</TableHead>
                <TableHead className="w-32" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {templates.map((template) => (
                <TableRow key={template.id}>
                  <TableCell className="font-medium">{template.name}</TableCell>
                  <TableCell className="max-w-md truncate">
                    {template.subject}
                  </TableCell>
                  <TableCell>
                    <div className="flex justify-end gap-1">
                      <TooltipIconButton
                        label={`Edit ${template.name}`}
                        onClick={() => openEdit(template)}
                      >
                        <Pencil />
                      </TooltipIconButton>
                      <TooltipIconButton
                        disabled={deleteTemplate.isPending}
                        label={`Delete ${template.name}`}
                        onClick={() => handleDelete(template)}
                      >
                        <Trash2 />
                      </TooltipIconButton>
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}

      <TemplateFormDialog
        isPending={createTemplate.isPending || updateTemplate.isPending}
        onOpenChange={setDialogOpen}
        onSubmit={handleSubmit}
        open={dialogOpen}
        template={editTemplate}
      />
    </div>
  );
}
