/**
 * Placeholder Guest identity rules (CONTEXT.md), shared by the RSVP form and
 * confirmation pages so the two surfaces can never disagree about what makes
 * a guest a placeholder or when it counts as named. The info-collection page
 * has no use for these: placeholders are excluded from that flow entirely
 * (they first surface during RSVP).
 */

/**
 * The minimal guest shape the placeholder rules read. It is a structural
 * constraint, not a hand-written API mirror: the generated RSVPGuest (rsvps)
 * satisfies it.
 */
interface PlaceholderIdentity {
  full_name: string;
  placeholder_text?: string | null;
}

/**
 * Whether a guest is a placeholder (an unnamed plus-one slot): exactly the
 * guests carrying a placeholder_text descriptor.
 */
export function isPlaceholder(guest: PlaceholderIdentity): boolean {
  return guest.placeholder_text != null;
}

/**
 * Whether a placeholder has been named: the party filled in a real name, so
 * full_name no longer equals the permanent descriptor. Clearing the name
 * (during RSVP or info collection) sets full_name back to the descriptor,
 * making this false again.
 */
export function isNamedPlaceholder(guest: PlaceholderIdentity): boolean {
  return isPlaceholder(guest) && guest.full_name !== guest.placeholder_text;
}
