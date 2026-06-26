import { useState } from "react";
import { toast } from "sonner";

import {
  dateToDeadline,
  deadlineToDate,
} from "@/components/pages/admin/settings/deadline";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useSettings, useUpdateSettings } from "@/hooks/queries/settings";
import { useAdminPageTitle } from "@/hooks/usePageTitle";

/**
 * Admin settings: the site-wide app settings. The RSVP deadline (a date picker;
 * stored as an RFC3339 end-of-day timestamp) and the contact email used in the
 * post-deadline RSVP message. Both are loaded from and saved back to
 * /admin/settings. It fetches here and only mounts the form once the settings
 * have loaded, so the form can seed its state directly from props (no
 * sync-to-state effect).
 */
export default function AdminSettings() {
  useAdminPageTitle("Settings");
  const settingsQuery = useSettings();

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-2xl font-semibold">Settings</h1>
        <p className="text-sm text-muted-foreground">
          Site-wide settings for the RSVP flow.
        </p>
      </div>

      {settingsQuery.isLoading ? (
        <p className="text-muted-foreground">Loading settings...</p>
      ) : settingsQuery.isError ? (
        <p className="text-destructive">{settingsQuery.error.message}</p>
      ) : (
        <SettingsForm
          initialContactEmail={settingsQuery.data?.contact_email ?? ""}
          initialDeadline={deadlineToDate(settingsQuery.data?.rsvp_deadline)}
          // Re-key on the fetched values so a save's refetch (or any external
          // change) re-seeds the form by remounting it, rather than syncing
          // fetched data into state with an effect.
          key={`${settingsQuery.data?.rsvp_deadline ?? ""}|${settingsQuery.data?.contact_email ?? ""}`}
        />
      )}
    </div>
  );
}

interface SettingsFormProps {
  initialDeadline: string;
  initialContactEmail: string;
}

/**
 * The settings form proper. It seeds its local state from the initial props
 * (passed once the parent has loaded the settings) and saves on submit. A blank
 * value clears the setting (the server's clear gesture).
 */
function SettingsForm({
  initialDeadline,
  initialContactEmail,
}: SettingsFormProps) {
  const updateSettings = useUpdateSettings();
  const [deadline, setDeadline] = useState(initialDeadline);
  const [contactEmail, setContactEmail] = useState(initialContactEmail);

  const handleSave = async (event: React.FormEvent) => {
    event.preventDefault();
    try {
      await updateSettings.mutateAsync({
        // A blank date clears the deadline; a picked one maps to the end of
        // that day. An empty string is the API's clear gesture.
        rsvp_deadline: deadline ? (dateToDeadline(deadline) ?? "") : "",
        contact_email: contactEmail.trim(),
      });
      toast.success("Settings saved");
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "Failed to save settings",
      );
    }
  };

  return (
    <form
      className="max-w-md space-y-4 rounded-md border border-ink/10 p-4"
      onSubmit={handleSave}
    >
      <div className="space-y-1.5">
        <Label htmlFor="rsvp-deadline">RSVP deadline</Label>
        <Input
          id="rsvp-deadline"
          onChange={(e) => setDeadline(e.target.value)}
          type="date"
          value={deadline}
        />
        <p className="text-xs text-muted-foreground">
          RSVPs stay open through the end of this day. Clear it to keep them
          open indefinitely.
        </p>
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="contact-email">Contact email</Label>
        <Input
          id="contact-email"
          onChange={(e) => setContactEmail(e.target.value)}
          placeholder="hello@example.com"
          type="email"
          value={contactEmail}
        />
        <p className="text-xs text-muted-foreground">
          Shown to guests in the message after the RSVP deadline passes.
        </p>
      </div>
      <Button disabled={updateSettings.isPending} type="submit">
        {updateSettings.isPending ? "Saving..." : "Save settings"}
      </Button>
    </form>
  );
}
