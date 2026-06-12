/** Renders an RFC3339 timestamp as a local, human-readable date and time. */
export function formatSentAt(sentAt: string): string {
  return new Date(sentAt).toLocaleString(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  });
}
