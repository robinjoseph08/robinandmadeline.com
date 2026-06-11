/**
 * Placeholder Guest identity rules (CONTEXT.md), shared by the RSVP form and
 * confirmation pages so the two surfaces can never disagree about what makes
 * a guest a placeholder or when it counts as named.
 */

import type { RSVPGuest } from "@/types/generated/rsvps";

/**
 * Whether a guest is a placeholder (an unnamed plus-one slot): exactly the
 * guests carrying a placeholder_text descriptor.
 */
export function isPlaceholder(guest: RSVPGuest): boolean {
  return guest.placeholder_text != null;
}

/**
 * Whether a placeholder has been named: the party filled in a real name, so
 * full_name no longer equals the permanent descriptor. Clearing the name
 * during RSVP sets full_name back to the descriptor, making this false again.
 */
export function isNamedPlaceholder(guest: RSVPGuest): boolean {
  return isPlaceholder(guest) && guest.full_name !== guest.placeholder_text;
}
