import { useState } from "react";
import { Navigate, useNavigate } from "react-router-dom";

import { PartyRSVPForm } from "@/components/library/PartyRSVPForm";
import { Button } from "@/components/ui/button";
import { usePartyRSVPs, useUpdatePartyRSVPs } from "@/hooks/queries/rsvp";
import { usePageTitle } from "@/hooks/usePageTitle";
import { formatLongDate } from "@/libraries/format";
import {
  ApiError,
  clearGuestToken,
  readGuestToken,
} from "@/libraries/guest-api";
import type {
  PartyRSVPsResponse,
  UpdatePartyRSVPsPayload,
} from "@/types/generated/rsvps";

/**
 * The RSVP page: the authenticated party's PartyRSVPForm (every guest, with an
 * attending/not-attending toggle per event they are invited to, an editable
 * name for placeholder guests, and a dietary restrictions field per guest). The
 * whole form submits at once. After the RSVP deadline there is no form at all:
 * the visitor is sent to the confirmation page, which shows the read-only
 * summary and the "contact us" message.
 */
export default function RSVPForm() {
  usePageTitle("RSVP");
  const hasToken = readGuestToken() !== null;
  const { data, error, isPending } = usePartyRSVPs({ enabled: hasToken });

  if (!hasToken) {
    return <Navigate replace to="/rsvp" />;
  }
  if (error?.status === 401) {
    // The stored token expired or was revoked: back to code entry.
    clearGuestToken();
    return <Navigate replace to="/rsvp" />;
  }
  if (error) {
    return (
      <section className="mx-auto max-w-2xl py-8">
        <p className="text-destructive" role="alert">
          Something went wrong loading your RSVP. Please try again.
        </p>
      </section>
    );
  }
  if (isPending || !data) {
    return (
      <section className="mx-auto max-w-2xl py-8">
        <p className="text-muted-foreground">Loading your RSVP...</p>
      </section>
    );
  }

  if (data.closed) {
    return <Navigate replace to="/rsvp/confirmation" />;
  }
  return <EditableRSVPForm data={data} />;
}

interface RSVPViewProps {
  data: PartyRSVPsResponse;
}

function EditableRSVPForm({ data }: RSVPViewProps) {
  const navigate = useNavigate();
  const updateRSVPs = useUpdatePartyRSVPs();
  const [submitError, setSubmitError] = useState<string | null>(null);

  async function handleSubmit(payload: UpdatePartyRSVPsPayload) {
    setSubmitError(null);
    try {
      await updateRSVPs.mutateAsync(payload);
      navigate("/rsvp/confirmation");
    } catch (err) {
      if (err instanceof ApiError && err.status === 403) {
        setSubmitError(
          "The RSVP deadline has passed, so responses can no longer be changed online.",
        );
      } else {
        setSubmitError(
          "Something went wrong saving your RSVP. Please try again.",
        );
      }
    }
  }

  return (
    <section className="mx-auto max-w-2xl py-8">
      <h1 className="text-3xl font-bold">RSVP</h1>
      <p className="mt-3 text-muted-foreground">
        Please respond for each member of your party.
        {data.rsvp_deadline
          ? ` Please respond by ${formatLongDate(data.rsvp_deadline)}.`
          : null}
      </p>

      {data.events.length === 0 ? (
        <p className="mt-6 text-muted-foreground">
          There is nothing to respond to yet. Check back once the schedule is
          out!
        </p>
      ) : (
        <div className="mt-6">
          <PartyRSVPForm data={data} onSubmit={handleSubmit}>
            {submitError ? (
              <p className="text-sm text-destructive" role="alert">
                {submitError}
              </p>
            ) : null}

            <Button disabled={updateRSVPs.isPending} type="submit">
              {updateRSVPs.isPending ? "Submitting..." : "Submit RSVP"}
            </Button>
          </PartyRSVPForm>
        </div>
      )}
    </section>
  );
}
