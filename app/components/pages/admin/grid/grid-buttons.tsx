import { Info } from "lucide-react";
import type { ReactNode } from "react";

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
