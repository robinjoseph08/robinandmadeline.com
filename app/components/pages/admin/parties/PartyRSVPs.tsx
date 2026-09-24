import { Loader2, NotebookPen } from "lucide-react";
import { useRef, useState } from "react";
import { toast } from "sonner";

import { PartyRSVPForm } from "@/components/library/PartyRSVPForm";
import {
  labelFor,
  RSVP_STATUS_OPTIONS,
} from "@/components/pages/admin/parties/options";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogBody,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  useAdminPartyRSVPs,
  useRecordPartyRSVPs,
} from "@/hooks/queries/party-rsvps";
import type { EventRSVPStatus } from "@/types/generated/models";
import type {
  PartyRSVPsResponse,
  UpdatePartyRSVPsPayload,
} from "@/types/generated/rsvps";

const STATUS_CLASS: Record<EventRSVPStatus, string> = {
  attending: "font-medium text-green-700",
  not_attending: "font-medium text-red-700",
  pending: "text-amber-700",
};

interface PartyRSVPsProps {
  partyId: string;
  partyName: string;
}

/**
 * The party detail page's RSVP section: a guests-by-events grid of the
 * party's current Event RSVPs, and a "Record RSVP" dialog holding the same
 * form the party fills in online, for a response given to the couple directly
 * (over the phone, in person). Recording ignores the RSVP deadline.
 */
export function PartyRSVPs({ partyId, partyName }: PartyRSVPsProps) {
  const rsvpsQuery = useAdminPartyRSVPs(partyId);
  const recordRSVPs = useRecordPartyRSVPs();
  const [open, setOpen] = useState(false);
  // Whether the dialog's form may mount: only after a fresh read taken when
  // the dialog opened. The form seeds once and saves every guest in full, so
  // seeding from a stale cache (the party answered online while this page sat
  // open) would silently overwrite their newer answers.
  const [fresh, setFresh] = useState(false);
  // Only the latest open's read may mark the form fresh (a close and quick
  // reopen must not be released by the earlier, superseded read).
  const openToken = useRef(0);

  const openDialog = async () => {
    const token = ++openToken.current;
    setFresh(false);
    setOpen(true);
    await rsvpsQuery.refetch();
    if (token === openToken.current) setFresh(true);
  };

  const data = rsvpsQuery.data;
  const hasEvents = (data?.events.length ?? 0) > 0;

  const handleRecord = async (payload: UpdatePartyRSVPsPayload) => {
    try {
      await recordRSVPs.mutateAsync({ partyId, payload });
      toast.success("RSVP recorded");
      setOpen(false);
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "Failed to record RSVP",
      );
    }
  };

  return (
    <section className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-lg font-medium">RSVPs</h2>
        <Button
          disabled={!hasEvents}
          onClick={() => void openDialog()}
          size="sm"
          variant="outline"
        >
          <NotebookPen />
          Record RSVP
        </Button>
      </div>

      {rsvpsQuery.isLoading ? (
        <p className="text-muted-foreground">Loading RSVPs...</p>
      ) : rsvpsQuery.isError || !data ? (
        <p className="text-destructive">
          {rsvpsQuery.error?.message ?? "Failed to load RSVPs."}
        </p>
      ) : !hasEvents ? (
        <p className="text-sm text-muted-foreground">
          This party is not invited to any events yet.
        </p>
      ) : (
        <RSVPGrid data={data} />
      )}

      {data ? (
        <Dialog onOpenChange={setOpen} open={open}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Record RSVP</DialogTitle>
              <DialogDescription>
                Enter the response {partyName} gave you directly. Saving
                replaces anything they submitted online.
                {data.closed
                  ? " The RSVP deadline has passed, but you can still record a response here."
                  : null}
              </DialogDescription>
            </DialogHeader>
            <DialogBody className="py-4">
              {!fresh ? (
                <p className="text-muted-foreground">
                  Loading the latest RSVP...
                </p>
              ) : rsvpsQuery.isError ? (
                <p className="text-destructive">{rsvpsQuery.error.message}</p>
              ) : (
                <PartyRSVPForm
                  data={data}
                  id="record-rsvp-form"
                  onSubmit={handleRecord}
                />
              )}
            </DialogBody>
            <DialogFooter>
              <Button
                disabled={recordRSVPs.isPending}
                onClick={() => setOpen(false)}
                type="button"
                variant="outline"
              >
                Cancel
              </Button>
              <Button
                disabled={!fresh || rsvpsQuery.isError || recordRSVPs.isPending}
                form="record-rsvp-form"
                type="submit"
              >
                {recordRSVPs.isPending ? (
                  <Loader2 className="animate-spin" />
                ) : null}
                Save RSVP
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      ) : null}
    </section>
  );
}

/**
 * One row per guest, one column per event the party is invited to (in
 * schedule order). A guest with no row for an event is not invited to it
 * (ADR 0002).
 */
function RSVPGrid({ data }: { data: PartyRSVPsResponse }) {
  return (
    <div className="rounded-md border border-ink/10">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Guest</TableHead>
            {data.events.map((event) => (
              <TableHead key={event.id}>{event.name}</TableHead>
            ))}
          </TableRow>
        </TableHeader>
        <TableBody>
          {data.guests.map((guest) => (
            <TableRow key={guest.id}>
              <TableCell className="font-medium">{guest.full_name}</TableCell>
              {data.events.map((event) => {
                const entry = event.rsvps.find((r) => r.guest_id === guest.id);
                return (
                  <TableCell className="text-sm" key={event.id}>
                    {entry ? (
                      <span className={STATUS_CLASS[entry.status]}>
                        {labelFor(RSVP_STATUS_OPTIONS, entry.status)}
                      </span>
                    ) : (
                      <span className="text-muted-foreground">Not invited</span>
                    )}
                  </TableCell>
                );
              })}
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}
