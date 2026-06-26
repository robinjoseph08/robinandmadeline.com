import { Pencil, Plus, Trash2 } from "lucide-react";
import { useState } from "react";
import { Link } from "react-router-dom";
import { toast } from "sonner";

import { EventLocation } from "@/components/library/EventLocation";
import {
  EventFormDialog,
  type EventFormPayload,
} from "@/components/pages/admin/events/EventFormDialog";
import { formatEventWhen } from "@/components/pages/admin/events/format";
import { RSVPBreakdownSummary } from "@/components/pages/admin/events/RSVPBreakdownSummary";
import { TooltipIconButton } from "@/components/pages/admin/grid/grid-buttons";
import { Badge } from "@/components/ui/badge";
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
  useCreateEvent,
  useDeleteEvent,
  useEvents,
  useUpdateEvent,
} from "@/hooks/queries/events";
import { useAdminPageTitle } from "@/hooks/usePageTitle";
import type { EventResponse } from "@/types/generated/events";

/**
 * Admin events list: every wedding event in schedule order, each with its RSVP
 * breakdown (an Event RSVP row is the invitation, so the total is the invited
 * count). Events are few, so this is a plain table rather than a spreadsheet
 * grid: create and edit go through a dialog, and each row links to the event
 * detail where parties are invited and individual RSVPs overridden.
 */
export default function AdminEvents() {
  useAdminPageTitle("Events");
  const eventsQuery = useEvents();
  const createEvent = useCreateEvent();
  const updateEvent = useUpdateEvent();
  const deleteEvent = useDeleteEvent();

  const [dialogOpen, setDialogOpen] = useState(false);
  const [editEvent, setEditEvent] = useState<EventResponse | undefined>(
    undefined,
  );

  const events = eventsQuery.data?.items ?? [];

  const openCreate = () => {
    setEditEvent(undefined);
    setDialogOpen(true);
  };

  const openEdit = (event: EventResponse) => {
    setEditEvent(event);
    setDialogOpen(true);
  };

  const handleSubmit = async (payload: EventFormPayload) => {
    try {
      if (editEvent) {
        await updateEvent.mutateAsync({ eventId: editEvent.id, payload });
        toast.success("Event updated");
      } else {
        await createEvent.mutateAsync(payload);
        toast.success(
          payload.is_public
            ? "Event created; every guest has a pending RSVP"
            : "Event created; invite parties from its page",
        );
      }
      setDialogOpen(false);
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "Failed to save event",
      );
    }
  };

  const handleDelete = async (event: EventResponse) => {
    if (!window.confirm(`Delete ${event.name}? All of its RSVPs go with it.`))
      return;
    try {
      await deleteEvent.mutateAsync({ eventId: event.id });
      toast.success("Event deleted");
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "Failed to delete event",
      );
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold">Events</h1>
          <p className="text-sm text-muted-foreground">
            {eventsQuery.data
              ? `${eventsQuery.data.total} event${eventsQuery.data.total === 1 ? "" : "s"}`
              : "The wedding schedule and who is invited to what."}
          </p>
        </div>
        <Button onClick={openCreate}>
          <Plus />
          Add event
        </Button>
      </div>

      {eventsQuery.isLoading ? (
        <p className="text-muted-foreground">Loading events...</p>
      ) : eventsQuery.isError ? (
        <p className="text-destructive">{eventsQuery.error.message}</p>
      ) : events.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          No events yet. Add the first one to start collecting RSVPs.
        </p>
      ) : (
        <div className="rounded-md border border-ink/10">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Name</TableHead>
                <TableHead>When</TableHead>
                <TableHead>Location</TableHead>
                <TableHead>Visibility</TableHead>
                <TableHead>RSVPs</TableHead>
                <TableHead className="w-24" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {events.map((event) => (
                <TableRow key={event.id}>
                  <TableCell>
                    <Link
                      className="font-medium hover:underline"
                      to={`/admin/events/${event.id}`}
                    >
                      {event.name}
                    </Link>
                  </TableCell>
                  <TableCell>{formatEventWhen(event)}</TableCell>
                  <TableCell>
                    {event.location ? (
                      <EventLocation
                        location={event.location}
                        locationUrl={event.location_url}
                      />
                    ) : (
                      <span className="text-muted-foreground">-</span>
                    )}
                  </TableCell>
                  <TableCell>
                    {event.is_public ? (
                      <Badge variant="success">Public</Badge>
                    ) : (
                      <Badge variant="outline">Private</Badge>
                    )}
                  </TableCell>
                  <TableCell>
                    <RSVPBreakdownSummary breakdown={event.rsvp_breakdown} />
                  </TableCell>
                  <TableCell>
                    <div className="flex justify-end gap-1">
                      <TooltipIconButton
                        label={`Edit ${event.name}`}
                        onClick={() => openEdit(event)}
                      >
                        <Pencil />
                      </TooltipIconButton>
                      <TooltipIconButton
                        disabled={deleteEvent.isPending}
                        label={`Delete ${event.name}`}
                        onClick={() => handleDelete(event)}
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

      <EventFormDialog
        event={editEvent}
        isPending={createEvent.isPending || updateEvent.isPending}
        onOpenChange={setDialogOpen}
        onSubmit={handleSubmit}
        open={dialogOpen}
      />
    </div>
  );
}
