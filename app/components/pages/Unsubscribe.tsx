import { useParams } from "react-router-dom";

import { Button } from "@/components/ui/button";
import {
  useSetSubscription,
  useSubscription,
} from "@/hooks/queries/subscriptions";
import { usePageTitle } from "@/hooks/usePageTitle";

/**
 * The email unsubscribe landing page behind the per-guest /u/:guestId link in
 * every email footer (ADR 0009). The guest's UUID in the URL is the whole
 * authentication. The page only reads on load: the GET never mutates, so a mail
 * scanner prefetching the link changes nothing. The Unsubscribe/Resubscribe
 * button is what flips the state, via a POST. The guest's name is shown up top
 * so the person knows the action affects only them, not anyone else who might
 * share the inbox.
 */
export default function Unsubscribe() {
  usePageTitle("Unsubscribe");
  const { guestId = "" } = useParams();
  const { data, error, isPending } = useSubscription(guestId);
  const setSubscription = useSetSubscription(guestId);

  if (isPending) {
    return (
      <section className="mx-auto max-w-xl py-12">
        <p className="text-muted-foreground">Loading...</p>
      </section>
    );
  }

  // A stale, mistyped, or revoked link (the guest was removed) comes back as a
  // 404. Show a friendly dead end rather than an error, since there is nothing
  // to act on.
  if (error || !data) {
    return (
      <section className="mx-auto max-w-xl py-12">
        <h1 className="text-2xl font-bold">This link is no longer valid</h1>
        <p className="mt-3 text-muted-foreground">
          We couldn't find this subscription. The link may be out of date.
        </p>
      </section>
    );
  }

  const firstName = data.full_name.split(" ")[0];

  return (
    <section className="mx-auto max-w-xl py-12">
      <h1 className="text-2xl font-bold">{`Hi ${firstName},`}</h1>
      {data.subscribed ? (
        <>
          <p className="mt-3 text-muted-foreground">
            {data.email
              ? `You're currently getting our wedding email updates at ${data.email}.`
              : "You're currently getting our wedding email updates."}
          </p>
          <Button
            className="mt-6"
            disabled={setSubscription.isPending}
            onClick={() => setSubscription.mutate(false)}
            type="button"
          >
            {setSubscription.isPending ? "Saving..." : "Unsubscribe"}
          </Button>
        </>
      ) : (
        <>
          <p className="mt-3 text-muted-foreground">
            {`You're unsubscribed, ${firstName}. You won't get any more wedding email updates.`}
          </p>
          <Button
            className="mt-6"
            disabled={setSubscription.isPending}
            onClick={() => setSubscription.mutate(true)}
            type="button"
            variant="outline"
          >
            {setSubscription.isPending ? "Saving..." : "Resubscribe"}
          </Button>
        </>
      )}
      {setSubscription.isError ? (
        <p className="mt-3 text-sm text-destructive" role="alert">
          Something went wrong. Please try again.
        </p>
      ) : null}
    </section>
  );
}
