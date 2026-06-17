import { useState } from "react";
import { Link } from "react-router-dom";
import { toast } from "sonner";

import {
  dateToDeadline,
  deadlineToDate,
} from "@/components/pages/admin/dashboard/deadline";
import { RSVPBreakdownSummary } from "@/components/pages/admin/events/RSVPBreakdownSummary";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  useDashboard,
  useSettings,
  useUpdateSettings,
} from "@/hooks/queries/dashboard";
import { formatEventDate } from "@/libraries/format";
import type { EventRSVPStats } from "@/types/generated/dashboard";

/**
 * Admin home: the wedding-site overview. Three headline stat cards (total
 * guests, total parties, overall RSVP response rate), a per-event RSVP
 * breakdown, the info-collection progress bar, an email-delivery summary, the
 * editable RSVP deadline and contact email (both app settings), and quick
 * links to the other admin sections. The stats are computed fresh server-side
 * on each request, so they always reflect the current data.
 */
export default function AdminDashboard() {
  const dashboardQuery = useDashboard();

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-2xl font-semibold">Dashboard</h1>
        <p className="text-sm text-muted-foreground">
          An overview of guests, RSVPs, and info collection.
        </p>
      </div>

      {dashboardQuery.isLoading ? (
        <p className="text-muted-foreground">Loading dashboard...</p>
      ) : dashboardQuery.isError ? (
        <p className="text-destructive">{dashboardQuery.error.message}</p>
      ) : dashboardQuery.data ? (
        <>
          <StatCards
            responded={dashboardQuery.data.rsvp_summary.responded}
            responseRate={dashboardQuery.data.rsvp_summary.response_rate}
            rsvpTotal={dashboardQuery.data.rsvp_summary.total}
            totalGuests={dashboardQuery.data.total_guests}
            totalParties={dashboardQuery.data.total_parties}
          />
          <GuestBreakdownSection
            byRelation={dashboardQuery.data.guest_breakdown.by_relation}
            bySide={dashboardQuery.data.guest_breakdown.by_side}
          />
          <EventsSection events={dashboardQuery.data.events} />
          <InfoCollectionSection
            complete={dashboardQuery.data.info_collection.complete}
            incomplete={dashboardQuery.data.info_collection.incomplete}
            rate={dashboardQuery.data.info_collection.rate}
            total={dashboardQuery.data.info_collection.total}
          />
          <EmailSection
            delivered={dashboardQuery.data.emails.delivered}
            deliveryRate={dashboardQuery.data.emails.delivery_rate}
            sent={dashboardQuery.data.emails.sent}
          />
        </>
      ) : null}

      <SettingsSection />
      <QuickLinks />
    </div>
  );
}

/** Formats a 0..1 fraction as a whole-number percentage ("67%"). */
function formatPercent(rate: number): string {
  return `${Math.round(rate * 100)}%`;
}

interface StatCardsProps {
  totalGuests: number;
  totalParties: number;
  responseRate: number;
  responded: number;
  rsvpTotal: number;
}

function StatCards({
  totalGuests,
  totalParties,
  responseRate,
  responded,
  rsvpTotal,
}: StatCardsProps) {
  return (
    <div className="grid gap-4 sm:grid-cols-3">
      <StatCard label="Total guests" value={String(totalGuests)} />
      <StatCard label="Total parties" value={String(totalParties)} />
      <StatCard
        hint={
          rsvpTotal === 0
            ? "No invitations yet"
            : `${responded} of ${rsvpTotal} responses`
        }
        label="RSVP response rate"
        value={formatPercent(responseRate)}
      />
    </div>
  );
}

interface StatCardProps {
  label: string;
  value: string;
  hint?: string;
}

function StatCard({ label, value, hint }: StatCardProps) {
  return (
    <div className="rounded-md border border-ink/10 p-4">
      <p className="text-sm text-muted-foreground">{label}</p>
      <p className="mt-1 text-3xl font-semibold">{value}</p>
      {hint ? (
        <p className="mt-1 text-xs text-muted-foreground">{hint}</p>
      ) : null}
    </div>
  );
}

interface GuestBreakdownSectionProps {
  bySide: { robin: number; madeline: number };
  byRelation: { family: number; friend: number };
}

function GuestBreakdownSection({
  bySide,
  byRelation,
}: GuestBreakdownSectionProps) {
  return (
    <section className="space-y-3">
      <h2 className="text-lg font-medium">Guest breakdown</h2>
      <div className="grid gap-4 sm:grid-cols-2">
        <div className="rounded-md border border-ink/10 p-4">
          <p className="text-sm font-medium">By side</p>
          <dl className="mt-2 space-y-1 text-sm">
            <BreakdownRow label="Robin" value={bySide.robin} />
            <BreakdownRow label="Madeline" value={bySide.madeline} />
          </dl>
        </div>
        <div className="rounded-md border border-ink/10 p-4">
          <p className="text-sm font-medium">By relation</p>
          <dl className="mt-2 space-y-1 text-sm">
            <BreakdownRow label="Family" value={byRelation.family} />
            <BreakdownRow label="Friend" value={byRelation.friend} />
          </dl>
        </div>
      </div>
    </section>
  );
}

function BreakdownRow({ label, value }: { label: string; value: number }) {
  return (
    <div className="flex justify-between">
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="font-medium">{value}</dd>
    </div>
  );
}

function EventsSection({ events }: { events: EventRSVPStats[] }) {
  return (
    <section className="space-y-3">
      <h2 className="text-lg font-medium">RSVPs by event</h2>
      {events.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          No events yet. Create them on the{" "}
          <Link className="underline" to="/admin/events">
            Events
          </Link>{" "}
          page.
        </p>
      ) : (
        <div className="space-y-2">
          {events.map((event) => (
            <div
              className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-ink/10 p-4"
              key={event.id}
            >
              <div>
                <Link
                  className="font-medium hover:underline"
                  to={`/admin/events/${event.id}`}
                >
                  {event.name}
                </Link>
                <p className="text-sm text-muted-foreground">
                  {formatEventDate(event.date)}
                </p>
              </div>
              <RSVPBreakdownSummary breakdown={event.rsvp_breakdown} />
            </div>
          ))}
        </div>
      )}
    </section>
  );
}

interface InfoCollectionSectionProps {
  complete: number;
  incomplete: number;
  total: number;
  rate: number;
}

function InfoCollectionSection({
  complete,
  incomplete,
  total,
  rate,
}: InfoCollectionSectionProps) {
  const percent = Math.round(rate * 100);
  return (
    <section className="space-y-3">
      <h2 className="text-lg font-medium">Info collection</h2>
      <div className="rounded-md border border-ink/10 p-4">
        <div className="flex items-center justify-between text-sm">
          <span className="text-muted-foreground">
            {complete} of {total} parties complete
          </span>
          <span className="font-medium">{formatPercent(rate)}</span>
        </div>
        <div
          aria-label="Info collection progress"
          aria-valuemax={100}
          aria-valuemin={0}
          aria-valuenow={percent}
          className="mt-2 h-2 w-full overflow-hidden rounded-full bg-ink/10"
          role="progressbar"
        >
          <div
            className="h-full rounded-full bg-accent"
            style={{ width: `${percent}%` }}
          />
        </div>
        {incomplete > 0 ? (
          <p className="mt-2 text-xs text-muted-foreground">
            {incomplete} {incomplete === 1 ? "party" : "parties"} still
            incomplete.
          </p>
        ) : null}
      </div>
    </section>
  );
}

interface EmailSectionProps {
  sent: number;
  delivered: number;
  deliveryRate: number;
}

function EmailSection({ sent, delivered, deliveryRate }: EmailSectionProps) {
  return (
    <section className="space-y-3">
      <h2 className="text-lg font-medium">Emails</h2>
      <div className="rounded-md border border-ink/10 p-4 text-sm">
        {sent === 0 ? (
          <p className="text-muted-foreground">
            Nothing sent yet. Compose an email on the{" "}
            <Link className="underline" to="/admin/emails">
              Emails
            </Link>{" "}
            page.
          </p>
        ) : (
          <p>
            <span className="font-medium">{sent}</span> sent,{" "}
            <span className="font-medium">{delivered}</span> delivered (
            {formatPercent(deliveryRate)} delivery rate).
          </p>
        )}
      </div>
    </section>
  );
}

/**
 * The editable app settings: the RSVP deadline (a date picker; stored as an
 * RFC3339 end-of-day timestamp) and the contact email used in the post-deadline
 * RSVP message. Both are loaded from and saved back to /admin/settings. It
 * fetches here and only mounts the form once the settings have loaded, so the
 * form can seed its state directly from props (no sync-to-state effect).
 */
function SettingsSection() {
  const settingsQuery = useSettings();

  return (
    <section className="space-y-3">
      <h2 className="text-lg font-medium">Settings</h2>
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
    </section>
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

function QuickLinks() {
  const links = [
    { to: "/admin/guests", label: "Guests" },
    { to: "/admin/parties", label: "Parties" },
    { to: "/admin/events", label: "Events" },
    { to: "/admin/photo-groups", label: "Group Photos" },
    { to: "/admin/emails", label: "Emails" },
  ];
  return (
    <section className="space-y-3">
      <h2 className="text-lg font-medium">Quick links</h2>
      <div className="flex flex-wrap gap-2">
        {links.map((link) => (
          <Button asChild key={link.to} variant="outline">
            <Link to={link.to}>{link.label}</Link>
          </Button>
        ))}
      </div>
    </section>
  );
}
