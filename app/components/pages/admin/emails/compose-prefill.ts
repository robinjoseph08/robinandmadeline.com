import type { RecipientFilter } from "@/types/generated/models";

/**
 * The draft the compose page starts from when another page hands one over
 * through router state, such as resending an email to one guest from a send's
 * detail page. The compose page treats it like loading a template: it seeds the
 * fields, and every edit afterwards only affects the new send.
 */
export interface ComposePrefill {
  templateId?: string;
  subject: string;
  body: string;
  filter: RecipientFilter;
}

/** Reads a ComposePrefill out of router location state, if one was passed. */
export function readComposePrefill(state: unknown): ComposePrefill | undefined {
  if (typeof state !== "object" || state === null) return undefined;
  const prefill = (state as { prefill?: ComposePrefill }).prefill;
  return prefill && typeof prefill.subject === "string" ? prefill : undefined;
}
