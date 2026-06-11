import { ArrowLeft, Pencil } from "lucide-react";
import { useMemo, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { toast } from "sonner";

import {
  EventFormDialog,
  type EventFormPayload,
} from "@/components/pages/admin/events/EventFormDialog";
import { formatEventWhen } from "@/components/pages/admin/events/format";
import { RSVPBreakdownSummary } from "@/components/pages/admin/events/RSVPBreakdownSummary";
import { RSVP_STATUS_OPTIONS } from "@/components/pages/admin/parties/options";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  useEvent,
  useEventRSVPs,
  useInviteParties,
  useUpdateEvent,
  useUpdateEventRSVP,
} from "@/hooks/queries/events";
import { useParties } from "@/hooks/queries/parties";
import type { EventRSVPListItem } from "@/types/generated/events";
import type { EventRSVPStatus } from "@/types/generated/models";

/**
 * Admin event detail: the event's facts (edited via the dialog), its RSVP
 * breakdown, the invite-parties control for private events, and the full RSVP
 * list where the admin can override an individual guest's status (a phone or
 * in-person answer). An Event RSVP row is the invitation (ADR 0002): the RSVP
 * list is exactly the invited set, and inviting a party creates pending rows
 * for all its guests.
 */
export default function AdminEventDetail() {
  const { id } = useParams<{ id: string }>();
  const eventQuery = useEvent(id);
  const rsvpsQuery = useEventRSVPs(id);

  const updateEvent = useUpdateEvent();
  const [editOpen, setEditOpen] = useState(false);

  if (eventQuery.isLoading) {
    return <p className="text-muted-foreground">Loading event...</p>;
  }
  if (eventQuery.isError || !eventQuery.data) {
    return (
      <div className="space-y-4">
        <BackLink />
        <p className="text-destructive">
          {eventQuery.error?.message ?? "Event not found."}
        </p>
      </div>
    );
  }

  const event = eventQuery.data;
  const rsvps = rsvpsQuery.data?.items ?? [];

  const handleUpdate = async (payload: EventFormPayload) => {
    if (!id) return;
    try {
      await updateEvent.mutateAsync({ eventId: id, payload });
      toast.success("Event updated");
      setEditOpen(false);
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "Failed to update event",
      );
    }
  };

  return (
    <div className="space-y-8">
      <BackLink />

      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="space-y-2">
          <h1 className="text-2xl font-semibold">{event.name}</h1>
          <div className="flex flex-wrap items-center gap-2">
            {event.is_public ? (
              <Badge variant="success">Public</Badge>
            ) : (
              <Badge variant="outline">Private</Badge>
            )}
            <span className="text-sm text-muted-foreground">
              {formatEventWhen(event)}
              {event.location ? ` at ${event.location}` : ""}
            </span>
          </div>
          {event.description ? (
            <p className="max-w-prose text-sm text-muted-foreground">
              {event.description}
            </p>
          ) : null}
          <RSVPBreakdownSummary breakdown={event.rsvp_breakdown} />
        </div>
        <Button onClick={() => setEditOpen(true)} variant="outline">
          <Pencil />
          Edit event
        </Button>
      </div>

      {event.is_public ? (
        <p className="rounded-md border border-ink/10 p-4 text-sm text-muted-foreground">
          This event is public: every guest is invited automatically, including
          guests added later.
        </p>
      ) : (
        <InvitePartiesSection eventId={event.id} rsvps={rsvps} />
      )}

      <section className="space-y-3">
        <h2 className="text-lg font-medium">
          RSVPs{" "}
          <span className="text-sm font-normal text-muted-foreground">
            ({rsvps.length})
          </span>
        </h2>
        {rsvpsQuery.isLoading ? (
          <p className="text-muted-foreground">Loading RSVPs...</p>
        ) : rsvpsQuery.isError ? (
          <p className="text-destructive">{rsvpsQuery.error.message}</p>
        ) : rsvps.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            Nobody is invited yet. Invite parties above to create pending RSVPs.
          </p>
        ) : (
          <RSVPTable eventId={event.id} rsvps={rsvps} />
        )}
      </section>

      <EventFormDialog
        event={event}
        isPending={updateEvent.isPending}
        onOpenChange={setEditOpen}
        onSubmit={handleUpdate}
        open={editOpen}
      />
    </div>
  );
}

interface InvitePartiesSectionProps {
  eventId: string;
  rsvps: EventRSVPListItem[];
}

/**
 * The invite control for a private event: pick parties, invite them, and every
 * guest in those parties gets a pending Event RSVP. Already-invited parties
 * stay selectable because re-inviting is idempotent and also covers guests
 * added to the party after the original invite.
 */
function InvitePartiesSection({ eventId, rsvps }: InvitePartiesSectionProps) {
  const partiesQuery = useParties();
  const inviteParties = useInviteParties();
  const [selected, setSelected] = useState<string[]>([]);

  const invitedPartyIDs = useMemo(
    () => new Set(rsvps.map((rsvp) => rsvp.party_id)),
    [rsvps],
  );
  const parties = partiesQuery.data?.items ?? [];

  const toggle = (partyId: string, checked: boolean) =>
    setSelected((prev) =>
      checked ? [...prev, partyId] : prev.filter((p) => p !== partyId),
    );

  const handleInvite = async () => {
    try {
      await inviteParties.mutateAsync({
        eventId,
        payload: { party_ids: selected },
      });
      toast.success(
        `Invited ${selected.length} ${selected.length === 1 ? "party" : "parties"}`,
      );
      setSelected([]);
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "Failed to invite parties",
      );
    }
  };

  return (
    <section className="space-y-3 rounded-md border border-ink/10 p-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-lg font-medium">Invite parties</h2>
          <p className="text-sm text-muted-foreground">
            Inviting a party creates a pending RSVP for each of its guests.
          </p>
        </div>
        <Button
          disabled={selected.length === 0 || inviteParties.isPending}
          onClick={handleInvite}
        >
          Invite selected
        </Button>
      </div>

      {partiesQuery.isLoading ? (
        <p className="text-muted-foreground">Loading parties...</p>
      ) : partiesQuery.isError ? (
        <p className="text-destructive">{partiesQuery.error.message}</p>
      ) : parties.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          No parties exist yet; create them from the Guests page.
        </p>
      ) : (
        <div className="grid gap-1 sm:grid-cols-2 lg:grid-cols-3">
          {parties.map((party) => (
            <label
              className="flex items-center gap-2 rounded-md px-2 py-1 text-sm hover:bg-muted/50"
              key={party.id}
            >
              <Checkbox
                checked={selected.includes(party.id)}
                onCheckedChange={(checked) =>
                  toggle(party.id, checked === true)
                }
              />
              <span className="truncate">{party.name}</span>
              {invitedPartyIDs.has(party.id) ? (
                <Badge variant="secondary">Invited</Badge>
              ) : null}
            </label>
          ))}
        </div>
      )}
    </section>
  );
}

interface RSVPTableProps {
  eventId: string;
  rsvps: EventRSVPListItem[];
}

/**
 * The event's RSVP list (one row per invited guest) with the admin override:
 * changing a row's status saves immediately and stamps (or clears) the
 * response time.
 */
function RSVPTable({ eventId, rsvps }: RSVPTableProps) {
  const updateRSVP = useUpdateEventRSVP();

  const handleStatusChange = async (
    rsvp: EventRSVPListItem,
    status: EventRSVPStatus,
  ) => {
    try {
      await updateRSVP.mutateAsync({
        eventId,
        guestId: rsvp.guest_id,
        payload: { status },
      });
      toast.success(`Updated ${rsvp.guest_name}'s RSVP`);
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "Failed to update RSVP",
      );
    }
  };

  return (
    <div className="rounded-md border border-ink/10">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Guest</TableHead>
            <TableHead>Party</TableHead>
            <TableHead>Status</TableHead>
            <TableHead>Responded</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {rsvps.map((rsvp) => (
            <TableRow key={rsvp.id}>
              <TableCell className="font-medium">{rsvp.guest_name}</TableCell>
              <TableCell>
                <Link
                  className="hover:underline"
                  to={`/admin/parties/${rsvp.party_id}`}
                >
                  {rsvp.party_name}
                </Link>
              </TableCell>
              <TableCell>
                <Select
                  onValueChange={(v) =>
                    handleStatusChange(rsvp, v as EventRSVPStatus)
                  }
                  value={rsvp.status}
                >
                  <SelectTrigger
                    aria-label={`RSVP status for ${rsvp.guest_name}`}
                    className="w-40"
                  >
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {RSVP_STATUS_OPTIONS.map((o) => (
                      <SelectItem key={o.value} value={o.value}>
                        {o.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </TableCell>
              <TableCell className="text-sm text-muted-foreground">
                {rsvp.rsvped_at
                  ? new Date(rsvp.rsvped_at).toLocaleString()
                  : "Not yet"}
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}

function BackLink() {
  return (
    <Link
      className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:underline"
      to="/admin/events"
    >
      <ArrowLeft className="size-4" />
      Back to events
    </Link>
  );
}
