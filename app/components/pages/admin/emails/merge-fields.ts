/**
 * The merge field placeholders the backend resolves per recipient at send
 * time (pkg/emails Render). Surfaced as a hint wherever the admin composes
 * email copy. Kept in sync by hand with the backend's field list.
 */
export const MERGE_FIELDS = [
  "{{guest_name}}",
  "{{rsvp_code}}",
  "{{rsvp_link}}",
  "{{info_link}}",
  "{{event_name}}",
  "{{event_date}}",
] as const;

export const MERGE_FIELDS_HINT = `Merge fields: ${MERGE_FIELDS.join(", ")}. Resolved per recipient at send time; event fields use the event selected in the recipient filter. The body supports Markdown, and a single line break is kept as a line break.`;
