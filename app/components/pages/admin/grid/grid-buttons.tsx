import { ArrowRight, Info } from "lucide-react";
import type { ReactNode } from "react";
import { Link } from "react-router-dom";

import { Button, type ButtonProps } from "@/components/ui/button";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";

interface TooltipIconButtonProps {
  /** Accessible name and tooltip text. */
  label: string;
  onClick: () => void;
  children: ReactNode;
  disabled?: boolean;
  variant?: ButtonProps["variant"];
}

/** A compact icon button whose accessible name doubles as its tooltip. */
export function TooltipIconButton({
  label,
  onClick,
  children,
  disabled,
  variant = "ghost",
}: TooltipIconButtonProps) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button
          aria-label={label}
          className="size-8"
          disabled={disabled}
          onClick={onClick}
          size="icon"
          type="button"
          variant={variant}
        >
          {children}
        </Button>
      </TooltipTrigger>
      <TooltipContent>{label}</TooltipContent>
    </Tooltip>
  );
}

/**
 * A compact "open this party" link for a grid's frozen Name column, so the
 * party page is one click away from any row without scrolling to the far-right
 * columns. The accessible name doubles as its tooltip. It is left out of the
 * Tab order so tabbing from Name still lands on the next column, as in a
 * spreadsheet.
 */
export function OpenPartyLink({
  partyId,
  partyName,
}: {
  partyId: string;
  partyName: string;
}) {
  const label = `Open ${partyName}`;
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button
          asChild
          className="size-7 shrink-0 text-muted-foreground hover:text-foreground"
          size="icon"
          variant="ghost"
        >
          <Link
            aria-label={label}
            tabIndex={-1}
            to={`/admin/parties/${partyId}`}
          >
            <ArrowRight />
          </Link>
        </Button>
      </TooltipTrigger>
      <TooltipContent>{label}</TooltipContent>
    </Tooltip>
  );
}

/** A small info icon next to a column header that explains the column on hover. */
export function InfoHint({ text }: { text: string }) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button
          aria-label="What is this?"
          className="text-muted-foreground/70 transition-colors hover:text-foreground"
          type="button"
        >
          <Info className="size-3.5" />
        </button>
      </TooltipTrigger>
      <TooltipContent>{text}</TooltipContent>
    </Tooltip>
  );
}
