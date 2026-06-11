import { Badge } from "@/components/ui/badge";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import {
  StatusComplete,
  type InfoCollectionStatus,
} from "@/types/generated/models";

interface InfoStatusBadgeProps {
  status: InfoCollectionStatus;
  /** Whether the info link has been sent (requested). */
  requested: boolean;
  /**
   * The required fields the party still lacks (the backend's itemized
   * counterpart of the incomplete status), shown in the Requested and
   * Incomplete badges' hover tooltip.
   */
  missingRequiredFields?: string[];
}

/**
 * Renders a party's info-collection state as one three-state badge:
 *
 * - "Completed": the derived status is complete (whether affirmed by the
 *   guest/admin or derived from the data alone). No tooltip.
 * - "Requested": incomplete, but the info link has been sent, so the ball is
 *   in the guest's court.
 * - "Incomplete": incomplete and not yet requested.
 *
 * Hovering Requested or Incomplete explains which required pieces are
 * missing. A requested party can have every field present and still be
 * unconfirmed (the link was sent to verify the data on file, ADR 0005), so an
 * empty list reads "No missing fields" rather than rendering no tooltip.
 */
export function InfoStatusBadge({
  status,
  requested,
  missingRequiredFields = [],
}: InfoStatusBadgeProps) {
  if (status === StatusComplete) {
    return <Badge variant="success">Completed</Badge>;
  }
  return (
    <Tooltip>
      {/* The badge is not an interactive element, so make it focusable for
          keyboard users (the tooltip is the only place the missing list
          surfaces) while opting it out of the grid's Enter-to-next-row
          traversal, mirroring the disabled-checkbox tooltip in the grid
          cells. */}
      <TooltipTrigger asChild>
        <Badge
          data-grid-nav-skip
          tabIndex={0}
          variant={requested ? "secondary" : "outline"}
        >
          {requested ? "Requested" : "Incomplete"}
        </Badge>
      </TooltipTrigger>
      <TooltipContent>
        {missingRequiredFields.length > 0
          ? `Missing: ${missingRequiredFields.join(", ")}`
          : "No missing fields"}
      </TooltipContent>
    </Tooltip>
  );
}
