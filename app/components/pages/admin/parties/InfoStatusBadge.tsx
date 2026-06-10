import { Badge } from "@/components/ui/badge";
import {
  StatusComplete,
  type InfoCollectionStatus,
} from "@/types/generated/models";

interface InfoStatusBadgeProps {
  status: InfoCollectionStatus;
  /** Whether the info link has been sent (requested), shown as a hint. */
  requested?: boolean;
}

/**
 * Renders a party's derived info-collection status as a colored badge, with an
 * optional "requested" hint so the admin can tell an affirmed status from a
 * still-derived one at a glance.
 */
export function InfoStatusBadge({ status, requested }: InfoStatusBadgeProps) {
  const complete = status === StatusComplete;
  return (
    <span className="inline-flex items-center gap-1.5">
      <Badge variant={complete ? "success" : "secondary"}>
        {complete ? "Complete" : "Incomplete"}
      </Badge>
      {requested ? (
        <span className="text-xs text-muted-foreground">requested</span>
      ) : null}
    </span>
  );
}
