import { useEffect, useState, type FormEvent } from "react";
import { useNavigate } from "react-router-dom";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  ApiError,
  clearGuestToken,
  guestLogin,
  guestRequest,
  readGuestToken,
} from "@/libraries/guest-api";

/**
 * RSVP code entry. The party code from the printed invitation is exchanged for
 * a long-lived guest JWT, then the visitor continues to the form. Returning
 * visitors whose stored token is still valid skip code entry entirely: the
 * mount effect probes the RSVP endpoint and forwards them; an invalid/expired
 * token is cleared so the code field shows instead.
 */
export default function RSVP() {
  const navigate = useNavigate();

  const [code, setCode] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  // While a stored token is being probed, render nothing interactive so the
  // visitor never sees a code field that is about to disappear.
  const [checkingToken, setCheckingToken] = useState(
    () => readGuestToken() !== null,
  );

  useEffect(() => {
    if (readGuestToken() === null) return;
    let cancelled = false;
    guestRequest("/guest/rsvp")
      .then(() => {
        if (!cancelled) navigate("/rsvp/form", { replace: true });
      })
      .catch(() => {
        // Expired or invalid token (or a transient failure): fall back to code
        // entry. Clearing the token keeps the next probe from looping.
        clearGuestToken();
        if (!cancelled) setCheckingToken(false);
      });
    return () => {
      cancelled = true;
    };
  }, [navigate]);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      await guestLogin(code.trim());
      navigate("/rsvp/form");
    } catch (err) {
      if (err instanceof ApiError && err.status === 401) {
        setError(
          "We couldn't find that code. Double-check your invitation and try again.",
        );
      } else if (err instanceof ApiError && err.status === 429) {
        setError("Too many attempts. Please wait a minute and try again.");
      } else {
        setError("Something went wrong. Please try again.");
      }
    } finally {
      setSubmitting(false);
    }
  }

  if (checkingToken) {
    return (
      <section className="mx-auto max-w-md py-8">
        <p className="text-muted-foreground">Loading your RSVP...</p>
      </section>
    );
  }

  return (
    <section className="mx-auto max-w-md py-8">
      <h1 className="text-3xl font-bold">RSVP</h1>
      <p className="mt-3 text-muted-foreground">
        Enter the code from your invitation to respond for your party.
      </p>

      <form className="mt-6 flex flex-col gap-4" onSubmit={handleSubmit}>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="rsvp-code">Party code</Label>
          <Input
            autoComplete="off"
            autoFocus
            className="uppercase tracking-widest"
            id="rsvp-code"
            onChange={(e) => setCode(e.target.value.toUpperCase())}
            placeholder="e.g. KALEL"
            required
            type="text"
            value={code}
          />
        </div>

        {error ? (
          <p className="text-sm text-destructive" role="alert">
            {error}
          </p>
        ) : null}

        <Button disabled={submitting} type="submit">
          {submitting ? "Checking..." : "Continue"}
        </Button>
      </form>
    </section>
  );
}
