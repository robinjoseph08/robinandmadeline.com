/**
 * The merge field placeholders the backend resolves per recipient at send
 * time (pkg/emails Render). Surfaced as a hint wherever the admin composes
 * email copy. Kept in sync by hand with the backend's field list.
 */
export const MERGE_FIELDS = [
  "{{guest_name}}",
  "{{guest_first_name}}",
  "{{rsvp_code}}",
  "{{rsvp_link}}",
  "{{info_link}}",
  "{{event_name}}",
  "{{event_date}}",
] as const;

/**
 * The decoration shortcodes the backend renders as the site's inline heart
 * images in the HTML email (emoji in the subject and plain text). Kept in sync
 * by hand with the backend's decorations.
 */
export const DECORATIONS = [
  "{{hearts}}",
  "{{blue_heart}}",
  "{{pink_heart}}",
] as const;

export const MERGE_FIELDS_HINT = `Merge fields: ${MERGE_FIELDS.join(", ")}. Resolved per recipient at send time; event fields use the event selected in the recipient filter. Hearts: ${DECORATIONS.join(", ")}. The body supports Markdown, a single line break is kept as a line break, and a line that is only a link becomes a button.`;
