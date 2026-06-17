import { Link } from "react-router-dom";

import { RSVPBreakdownSummary } from "@/components/pages/admin/events/RSVPBreakdownSummary";
import { useDashboard } from "@/hooks/queries/dashboard";
import { formatEventDate } from "@/libraries/format";
import type {
  EventRSVPStats,
  RelationBreakdown,
  SideBreakdown,
} from "@/types/generated/dashboard";

/**
 * Admin home: the wedding-site overview. Three headline stat cards (total
 * guests, total parties, overall RSVP response rate), a per-event RSVP
 * breakdown, the info-collection progress bar, and an email-delivery summary.
 * The stats are computed fresh server-side on each request, so they always
 * reflect the current data.
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
  bySide: SideBreakdown;
  byRelation: RelationBreakdown;
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
