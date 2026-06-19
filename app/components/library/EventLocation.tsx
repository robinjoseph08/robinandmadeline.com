import { ExternalLink, MapPin } from "lucide-react";

interface EventLocationProps {
  /** The location label. The caller guards on its presence. */
  location: string;
  /**
   * The Location Link, when the event has one: the label becomes a hyperlink to
   * it (a Google Maps or directions page). A nil pointer reaches the client as
   * JSON null even though the generated type says `?: string`, so this accepts
   * null and the truthiness check below covers null, undefined, and "".
   */
  locationUrl?: string | null;
}

/**
 * An event's location: a leading map-pin, the label, and (when a Location Link
 * is set) a trailing external-link icon with the label hyperlinked to it. The
 * pin marks the line as a place in both cases; the link opens in a new tab.
 * Shared by the guest schedule and the admin event views (list and detail) so
 * the couple sees, and can click to verify, the exact link guests get. The link
 * inherits its surrounding text color and only adds the underline and hover, so
 * it sits naturally in each context (a muted schedule line, an admin table cell,
 * the detail header).
 */
export function EventLocation({ location, locationUrl }: EventLocationProps) {
  if (!locationUrl) {
    return (
      <span className="inline-flex items-center gap-1.5">
        <MapPin aria-hidden="true" className="size-4 shrink-0" />
        {location}
      </span>
    );
  }
  return (
    <a
      className="inline-flex items-center gap-1.5 underline underline-offset-2 transition-colors hover:text-rose"
      href={locationUrl}
      rel="noopener noreferrer"
      target="_blank"
    >
      <MapPin aria-hidden="true" className="size-4 shrink-0" />
      {location}
      <ExternalLink aria-hidden="true" className="size-3.5 shrink-0" />
    </a>
  );
}
