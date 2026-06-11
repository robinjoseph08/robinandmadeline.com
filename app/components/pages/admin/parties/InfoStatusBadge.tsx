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
   * counterpart of the incomplete status), listed in the Incomplete badge's
   * hover tooltip.
   */
  missingRequiredFields?: string[];
}

/**
 * Renders a party's info-collection state as one three-state badge:
 *
 * - "Completed": the derived status is complete (whether affirmed by the
 *   guest/admin or derived from the data alone).
 * - "Requested": incomplete, but the info link has been sent, so the ball is
 *   in the guest's court.
 * - "Incomplete": incomplete and not yet requested; hovering explains which
 *   required pieces are missing.
 */
export function InfoStatusBadge({
  status,
  requested,
  missingRequiredFields = [],
}: InfoStatusBadgeProps) {
  if (status === StatusComplete) {
    return <Badge variant="success">Completed</Badge>;
  }
  if (requested) {
    return <Badge variant="secondary">Requested</Badge>;
  }
  // A derived-incomplete party always has missing fields, but guard anyway so
  // a bare badge renders rather than an empty tooltip.
  if (missingRequiredFields.length === 0) {
    return <Badge variant="outline">Incomplete</Badge>;
  }
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Badge variant="outline">Incomplete</Badge>
      </TooltipTrigger>
      <TooltipContent>
        Missing: {missingRequiredFields.join(", ")}
      </TooltipContent>
    </Tooltip>
  );
}
