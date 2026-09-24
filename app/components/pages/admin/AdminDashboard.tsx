import { ChevronRight } from "lucide-react";
import { Link } from "react-router-dom";

import {
  guestsLink,
  partiesLink,
} from "@/components/pages/admin/dashboard/links";
import { RSVPBreakdownSummary } from "@/components/pages/admin/events/RSVPBreakdownSummary";
import { useDashboard } from "@/hooks/queries/dashboard";
import { useAdminPageTitle } from "@/hooks/usePageTitle";
import { formatDeadline, formatEventDate } from "@/libraries/format";
import type {
  AgeBreakdown,
  DrinkingBreakdown,
  EventRSVPStats,
  GuestAttendanceCounts,
  PartyRSVPProgressCounts,
  RelationBreakdown,
  RSVPSummary,
  SideBreakdown,
} from "@/types/generated/dashboard";

/**
 * Admin home: the wedding-site overview. Three headline stat cards (expected
 * guests, total parties, overall RSVP response rate), a guest breakdown, a
 * per-event RSVP breakdown, the info-collection progress bar, and an
 * email-delivery summary. Wherever a count is a set of guests or parties it
 * links to the guests or parties list filtered to exactly that set. The stats
 * are computed fresh server-side on each request, so they always reflect the
 * current data.
 */
export default function AdminDashboard() {
  useAdminPageTitle("Dashboard");
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
            attendance={dashboardQuery.data.guest_attendance}
            partyProgress={dashboardQuery.data.party_rsvp_progress}
            rsvpDeadline={dashboardQuery.data.rsvp_deadline}
            rsvpSummary={dashboardQuery.data.rsvp_summary}
          />
          <GuestBreakdownSection
            byAge={dashboardQuery.data.guest_breakdown.by_age}
            byDrinking={dashboardQuery.data.guest_breakdown.by_drinking}
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
  attendance: GuestAttendanceCounts;
  partyProgress: PartyRSVPProgressCounts;
  rsvpSummary: RSVPSummary;
  rsvpDeadline?: string | null;
}

/**
 * The three headline cards. Each pairs its number with a one-line definition
 * and the breakdown behind it, since a bare count ("expected", "responded")
 * is ambiguous on its own. Guest and party counts link to their filtered
 * lists. The response-rate card's attending/declined counts do not: they count
 * event invitations (one per guest per event), which no guest list matches.
 */
function StatCards({
  attendance,
  partyProgress,
  rsvpSummary,
  rsvpDeadline,
}: StatCardsProps) {
  return (
    <div className="grid gap-4 sm:grid-cols-3">
      {/* The headcount that shrinks as declines come in (see
          models.GuestAttendanceCondition). */}
      <StatCard
        hint={`${attendance.total} guests, minus ${attendance.declined} who declined every event`}
        label="Expected guests"
        rows={[
          {
            label: "Coming",
            value: attendance.coming,
            to: guestsLink({ attendance: "coming" }),
          },
          {
            label: "Awaiting reply",
            value: attendance.awaiting,
            to: guestsLink({ attendance: "awaiting" }),
          },
          {
            label: "Declined",
            value: attendance.declined,
            to: guestsLink({ attendance: "declined" }),
          },
        ]}
        to={guestsLink({ attendance: "expected" })}
        value={String(attendance.expected)}
      />
      {/* Who still needs chasing (see models.PartyRSVPProgressCondition). */}
      <StatCard
        hint="Responded means every guest answered every event"
        label="Total parties"
        rows={[
          {
            label: "Responded",
            value: partyProgress.responded,
            to: partiesLink({ rsvp_progress: "responded" }),
          },
          {
            label: "Partially responded",
            value: partyProgress.partial,
            to: partiesLink({ rsvp_progress: "partial" }),
          },
          {
            label: "No response yet",
            value: partyProgress.not_responded,
            to: partiesLink({ rsvp_progress: "not_responded" }),
          },
        ]}
        to="/admin/parties"
        value={String(partyProgress.total)}
      />
      <StatCard
        hint={
          rsvpSummary.total === 0
            ? "No invitations yet"
            : `${rsvpSummary.responded} of ${rsvpSummary.total} event invitations answered`
        }
        label="RSVP response rate"
        rows={[
          { label: "Invitations accepted", value: rsvpSummary.attending },
          { label: "Invitations declined", value: rsvpSummary.not_attending },
          {
            label: "Deadline",
            value: formatDeadline(rsvpDeadline, new Date()),
            to: "/admin/settings",
          },
        ]}
        value={formatPercent(rsvpSummary.response_rate)}
      />
    </div>
  );
}

interface StatRow {
  label: string;
  value: number | string;
  /** Where the row links: the list filtered to exactly this count. */
  to?: string;
}

interface StatCardProps {
  label: string;
  value: string;
  /** Where the headline number links. */
  to?: string;
  hint?: string;
  /** The breakdown under the number, below a divider. */
  rows?: StatRow[];
}

function StatCard({ label, value, to, hint, rows }: StatCardProps) {
  return (
    <div className="rounded-md border border-ink/10 p-4">
      <p className="text-sm text-muted-foreground">{label}</p>
      <p className="mt-1 text-3xl font-semibold">
        {to ? (
          <Link
            aria-label={`${label}: ${value}`}
            className="underline-offset-4 hover:underline"
            to={to}
          >
            {value}
          </Link>
        ) : (
          value
        )}
      </p>
      {hint ? (
        <p className="mt-1 text-xs text-muted-foreground">{hint}</p>
      ) : null}
      {rows ? (
        <dl className="mt-3 space-y-0.5 border-t border-ink/10 pt-3 text-sm">
          {rows.map((row) => (
            <BreakdownRow key={row.label} {...row} />
          ))}
        </dl>
      ) : null}
    </div>
  );
}

interface GuestBreakdownSectionProps {
  bySide: SideBreakdown;
  byRelation: RelationBreakdown;
  byAge: AgeBreakdown;
  byDrinking: DrinkingBreakdown;
}

function GuestBreakdownSection({
  bySide,
  byRelation,
  byAge,
  byDrinking,
}: GuestBreakdownSectionProps) {
  return (
    <section className="space-y-3">
      <h2 className="text-lg font-medium">Guest breakdown</h2>
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <BreakdownCard
          rows={[
            {
              label: "Robin",
              value: bySide.robin,
              to: guestsLink({ side: "robin" }),
            },
            {
              label: "Madeline",
              value: bySide.madeline,
              to: guestsLink({ side: "madeline" }),
            },
          ]}
          title="By side"
        />
        <BreakdownCard
          rows={[
            {
              label: "Family",
              value: byRelation.family,
              to: guestsLink({ relation: "family" }),
            },
            {
              label: "Friend",
              value: byRelation.friend,
              to: guestsLink({ relation: "friend" }),
            },
          ]}
          title="By relation"
        />
        <BreakdownCard
          rows={[
            {
              label: "Adults",
              value: byAge.adults,
              to: guestsLink({ is_child: false }),
            },
            {
              label: "Children",
              value: byAge.children,
              to: guestsLink({ is_child: true }),
            },
          ]}
          title="By age"
        />
        <BreakdownCard
          rows={[
            {
              label: "Drinking",
              value: byDrinking.drinking,
              to: guestsLink({ is_drinking: true }),
            },
            {
              label: "Not drinking",
              value: byDrinking.not_drinking,
              to: guestsLink({ is_drinking: false }),
            },
          ]}
          title="By drinking"
        />
      </div>
    </section>
  );
}

function BreakdownCard({ title, rows }: { title: string; rows: StatRow[] }) {
  return (
    <div className="rounded-md border border-ink/10 p-4">
      <p className="text-sm font-medium">{title}</p>
      <dl className="mt-2 space-y-0.5 text-sm">
        {rows.map((row) => (
          <BreakdownRow key={row.label} {...row} />
        ))}
      </dl>
    </div>
  );
}

/**
 * One label/value line. With a destination the whole row is clickable (the
 * value's link stretches over it) and a chevron marks it as navigable; the
 * link's accessible name carries the label so it reads sensibly on its own.
 */
function BreakdownRow({ label, value, to }: StatRow) {
  if (!to) {
    return (
      <div className="flex justify-between gap-2 py-0.5">
        <dt className="text-muted-foreground">{label}</dt>
        <dd className="font-medium">{value}</dd>
      </div>
    );
  }
  return (
    <div className="group relative -mx-2 flex justify-between gap-2 rounded px-2 py-0.5 hover:bg-ink/5">
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="flex items-center gap-1 font-medium">
        <Link
          aria-label={`${label}: ${value}`}
          className="underline-offset-2 after:absolute after:inset-0 group-hover:underline"
          to={to}
        >
          {value}
        </Link>
        <ChevronRight
          aria-hidden
          className="size-3.5 text-muted-foreground/60 group-hover:text-foreground"
        />
      </dd>
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
              <RSVPBreakdownSummary
                breakdown={event.rsvp_breakdown}
                linkFor={(status) =>
                  guestsLink({ event_id: event.id, rsvp_status: status })
                }
              />
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
            <Link
              className="font-medium text-foreground underline-offset-2 hover:underline"
              to={partiesLink({ info_collection_status: "complete" })}
            >
              {complete}
            </Link>{" "}
            of {total} parties complete
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
            <Link
              className="underline underline-offset-2 hover:text-foreground"
              to={partiesLink({ info_collection_status: "incomplete" })}
            >
              {incomplete} {incomplete === 1 ? "party" : "parties"} still
              incomplete
            </Link>
            .
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
