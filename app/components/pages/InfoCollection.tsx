import { useState, type FormEvent } from "react";
import { useParams } from "react-router-dom";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { usePartyInfo, useUpdatePartyInfo } from "@/hooks/queries/info";
import { ApiError } from "@/libraries/api";
import { isNamedPlaceholder, isPlaceholder } from "@/libraries/placeholders";
import type {
  Guest,
  GuestInfoUpdate,
  PartyInfoResponse,
  UpdatePartyInfoPayload,
} from "@/types/generated/info";

/**
 * The pre-invitation info-collection page behind the personalized /i/:token
 * URL: every guest in the party with editable name and contact fields, a
 * remove action for non-primary guests, and the party's mailing address
 * (required for physical parties; omitted entirely for digital ones, without
 * calling attention to the difference). The whole form submits at once; a
 * success confirmation follows, and revisiting the same link re-opens the
 * form pre-filled with the saved values.
 */
export default function InfoCollection() {
  const { token = "" } = useParams();
  const { data, error, isPending } = usePartyInfo(token);
  const [saved, setSaved] = useState(false);

  if (error?.status === 404) {
    return (
      <section className="mx-auto max-w-2xl py-8">
        <h1 className="text-3xl font-bold">Hmm, we can't find that page</h1>
        <p className="mt-3 text-muted-foreground" role="alert">
          This link isn't valid. Double-check the link we sent you, or reach out
          to us and we'll send a fresh one.
        </p>
      </section>
    );
  }
  if (error) {
    return (
      <section className="mx-auto max-w-2xl py-8">
        <p className="text-destructive" role="alert">
          Something went wrong loading your details. Please try again.
        </p>
      </section>
    );
  }
  if (isPending || !data) {
    return (
      <section className="mx-auto max-w-2xl py-8">
        <p className="text-muted-foreground">Loading your details...</p>
      </section>
    );
  }

  if (saved) {
    return (
      <section className="mx-auto max-w-2xl py-8">
        <h1 className="text-3xl font-bold">Thank you!</h1>
        <p className="mt-3 text-muted-foreground">
          Your details have been saved. You can come back to this link anytime
          before invitations go out to update them.
        </p>
        <Button className="mt-6" onClick={() => setSaved(false)}>
          Make changes
        </Button>
      </section>
    );
  }
  // The form unmounts while the success view shows, so returning to it
  // re-seeds the fields from the refreshed cache (the PUT response replaced
  // it) rather than stale local state.
  return <InfoForm data={data} onSaved={() => setSaved(true)} token={token} />;
}

/**
 * The greeting's name: the primary guest's first name ("Hi Amanda!"). Listing
 * every member gets unwieldy for big parties; the cards below name them all.
 * Falls back to the first guest if no primary is flagged (defensive; every
 * party has one).
 */
function greetingName(guests: Guest[]): string {
  const primary = guests.find((g) => g.is_primary) ?? guests[0];
  return primary ? primary.full_name.split(" ")[0] : "";
}

/** The asterisk marking a required field, with a hover hint saying why. */
function RequiredMark() {
  return (
    <span className="text-destructive" title="required">
      {" "}
      *
    </span>
  );
}

/**
 * The initial value of a guest's name input. A real guest's (possibly
 * best-guess) name prefills for correction. An unnamed placeholder starts
 * blank (its heading already shows the descriptor); a named one prefills with
 * the submitted name.
 */
function initialName(guest: Guest): string {
  if (isPlaceholder(guest)) {
    return isNamedPlaceholder(guest) ? guest.full_name : "";
  }
  return guest.full_name;
}

/**
 * The full_name one guest's submission carries. A non-blank input corrects a
 * real guest's name or names a placeholder slot. A blank input sends nothing
 * for a real guest (a name can be corrected, never removed) and for an
 * untouched unnamed slot; on a named placeholder it sends blank, which the
 * backend reads as "revert to unnamed" (the name goes back to the
 * descriptor).
 */
function submittedName(guest: Guest, input: string): string | undefined {
  const trimmed = input.trim();
  if (trimmed !== "") return trimmed;
  return isNamedPlaceholder(guest) ? "" : undefined;
}

/** The party-level address fields, in display order. */
const addressFields = [
  { key: "address_line_1", label: "Address line 1", required: true },
  { key: "address_line_2", label: "Address line 2", required: false },
  { key: "city", label: "City", required: true },
  { key: "state_or_province", label: "State or province", required: true },
  { key: "postal_code", label: "Postal code", required: true },
  { key: "country", label: "Country", required: true },
] as const;

type AddressKey = (typeof addressFields)[number]["key"];

interface InfoFormProps {
  token: string;
  data: PartyInfoResponse;
  onSaved: () => void;
}

function InfoForm({ token, data, onSaved }: InfoFormProps) {
  const updateInfo = useUpdatePartyInfo(token);
  const [submitError, setSubmitError] = useState<string | null>(null);

  const isPhysical = data.invitation_type === "physical";

  // Form state, seeded from the fetched data once at mount (the component
  // only renders with data in hand). Names/emails/phones are keyed by guest;
  // the address is party-level (one envelope per party, CONTEXT.md).
  const [names, setNames] = useState<Record<string, string>>(() =>
    Object.fromEntries(data.guests.map((g) => [g.id, initialName(g)])),
  );
  const [emails, setEmails] = useState<Record<string, string>>(() =>
    Object.fromEntries(data.guests.map((g) => [g.id, g.email ?? ""])),
  );
  const [phones, setPhones] = useState<Record<string, string>>(() =>
    Object.fromEntries(data.guests.map((g) => [g.id, g.phone ?? ""])),
  );
  const [address, setAddress] = useState<Record<AddressKey, string>>(() => {
    const initial = {} as Record<AddressKey, string>;
    for (const field of addressFields) {
      initial[field.key] = data[field.key] ?? "";
    }
    return initial;
  });
  // Removal is applied on save: a marked guest's card collapses to a note
  // with an undo, and the submit sends a remove entry for each marked id.
  // confirming holds the guest whose inline "are you sure?" is open.
  const [removed, setRemoved] = useState<Record<string, boolean>>({});
  const [confirming, setConfirming] = useState<string | null>(null);

  function setKeyed(
    setter: React.Dispatch<React.SetStateAction<Record<string, string>>>,
    id: string,
    value: string,
  ) {
    setter((prev) => ({ ...prev, [id]: value }));
  }

  function markRemoved(id: string, value: boolean) {
    setRemoved((prev) => ({ ...prev, [id]: value }));
    setConfirming(null);
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSubmitError(null);

    const payload: UpdatePartyInfoPayload = {
      guests: data.guests.map((guest): GuestInfoUpdate => {
        if (removed[guest.id]) {
          return { guest_id: guest.id, remove: true };
        }
        // Email and phone are full-state: the trimmed inputs are stored as
        // sent, so clearing a field clears the saved value.
        return {
          guest_id: guest.id,
          full_name: submittedName(guest, names[guest.id] ?? ""),
          email: (emails[guest.id] ?? "").trim(),
          phone: (phones[guest.id] ?? "").trim(),
          remove: false,
        };
      }),
    };
    if (isPhysical) {
      // A digital party's form never renders the address section, and its
      // submit omits the fields entirely so the backend leaves any
      // admin-entered address untouched.
      for (const field of addressFields) {
        payload[field.key] = address[field.key].trim();
      }
    }

    try {
      await updateInfo.mutateAsync(payload);
      onSaved();
    } catch (err) {
      if (err instanceof ApiError && err.status === 422) {
        setSubmitError(err.message);
      } else {
        setSubmitError(
          "Something went wrong saving your details. Please try again.",
        );
      }
    }
  }

  return (
    <section className="mx-auto max-w-2xl py-8">
      <h1 className="text-3xl font-bold">Hi {greetingName(data.guests)}!</h1>
      <p className="mt-3 text-muted-foreground">
        Before invitations go out, please confirm your party's details below and
        correct anything we got wrong.
      </p>

      <form className="mt-6 flex flex-col gap-6" onSubmit={handleSubmit}>
        {data.guests.map((guest) => (
          <section
            aria-label={guest.full_name}
            className="rounded-lg border border-ink/10 bg-cream p-5"
            key={guest.id}
          >
            <h2 className="text-xl font-semibold">{guest.full_name}</h2>
            {/* A named placeholder keeps its descriptor visible so a
                returning party sees what the slot is for when changing or
                clearing the name. An unnamed slot's heading already IS the
                descriptor, so no subtitle. */}
            {isNamedPlaceholder(guest) ? (
              <p className="text-sm text-muted-foreground">
                {guest.placeholder_text}
              </p>
            ) : null}

            {removed[guest.id] ? (
              <div className="mt-3 flex flex-wrap items-center gap-3">
                <p className="text-sm text-muted-foreground">
                  {guest.full_name} will be removed from your party when you
                  save.
                </p>
                <Button
                  onClick={() => markRemoved(guest.id, false)}
                  size="sm"
                  type="button"
                  variant="outline"
                >
                  Undo
                </Button>
              </div>
            ) : (
              <>
                <div className="mt-3 flex flex-col gap-1.5">
                  <Label htmlFor={`name-${guest.id}`}>Name</Label>
                  <Input
                    id={`name-${guest.id}`}
                    onChange={(e) =>
                      setKeyed(setNames, guest.id, e.target.value)
                    }
                    placeholder={
                      isPlaceholder(guest) ? "Their full name" : undefined
                    }
                    type="text"
                    value={names[guest.id] ?? ""}
                  />
                </div>
                <div className="mt-3 flex flex-col gap-1.5">
                  <Label htmlFor={`email-${guest.id}`}>
                    Email
                    {guest.is_primary ? <RequiredMark /> : null}
                  </Label>
                  <Input
                    id={`email-${guest.id}`}
                    onChange={(e) =>
                      setKeyed(setEmails, guest.id, e.target.value)
                    }
                    required={guest.is_primary}
                    type="email"
                    value={emails[guest.id] ?? ""}
                  />
                </div>
                <div className="mt-3 flex flex-col gap-1.5">
                  <Label htmlFor={`phone-${guest.id}`}>Phone</Label>
                  <Input
                    id={`phone-${guest.id}`}
                    onChange={(e) =>
                      setKeyed(setPhones, guest.id, e.target.value)
                    }
                    type="tel"
                    value={phones[guest.id] ?? ""}
                  />
                </div>

                {!guest.is_primary ? (
                  <div className="mt-4">
                    {confirming === guest.id ? (
                      <div className="flex flex-wrap items-center gap-3">
                        <p className="text-sm text-muted-foreground">
                          Remove {guest.full_name} from your party?
                        </p>
                        <Button
                          onClick={() => markRemoved(guest.id, true)}
                          size="sm"
                          type="button"
                          variant="destructive"
                        >
                          Yes, remove
                        </Button>
                        <Button
                          onClick={() => setConfirming(null)}
                          size="sm"
                          type="button"
                          variant="outline"
                        >
                          Cancel
                        </Button>
                      </div>
                    ) : (
                      <Button
                        className="px-0 text-muted-foreground"
                        onClick={() => setConfirming(guest.id)}
                        size="sm"
                        type="button"
                        variant="link"
                      >
                        No longer part of your party?
                      </Button>
                    )}
                  </div>
                ) : null}
              </>
            )}
          </section>
        ))}

        {isPhysical ? (
          <section
            aria-label="Mailing address"
            className="rounded-lg border border-ink/10 bg-cream p-5"
          >
            <h2 className="text-xl font-semibold">Mailing address</h2>
            <p className="mt-1 text-sm text-muted-foreground">
              We'll mail your invitation here, so please make sure it's
              complete.
            </p>
            <div className="mt-3 flex flex-col gap-3">
              {addressFields.map((field) => (
                <div className="flex flex-col gap-1.5" key={field.key}>
                  <Label htmlFor={`address-${field.key}`}>
                    {field.label}
                    {field.required ? <RequiredMark /> : null}
                  </Label>
                  <Input
                    id={`address-${field.key}`}
                    onChange={(e) =>
                      setAddress((prev) => ({
                        ...prev,
                        [field.key]: e.target.value,
                      }))
                    }
                    required={field.required}
                    type="text"
                    value={address[field.key]}
                  />
                </div>
              ))}
            </div>
          </section>
        ) : null}

        {submitError ? (
          <p className="text-sm text-destructive" role="alert">
            {submitError}
          </p>
        ) : null}

        <Button disabled={updateInfo.isPending} type="submit">
          {updateInfo.isPending ? "Saving..." : "Save your info"}
        </Button>
      </form>
    </section>
  );
}
