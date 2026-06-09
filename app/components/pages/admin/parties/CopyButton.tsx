import { Check, Copy } from "lucide-react";
import { useState, type ReactNode } from "react";
import { toast } from "sonner";

import { Button, type ButtonProps } from "@/components/ui/button";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { copyToClipboard } from "@/libraries/clipboard";

interface CopyButtonProps {
  /** The text written to the clipboard. */
  value: string;
  /** Visible button label (and the tooltip text in icon-only mode). */
  label: string;
  /** Toast shown on a successful copy. */
  successMessage: string;
  /** Run before copying (e.g. the info link also triggers request-info). */
  onCopy?: () => void | Promise<void>;
  /** Render as an icon-only button with the label shown as a tooltip. */
  iconOnly?: boolean;
  /** Overrides the default copy icon (e.g. a link icon for the info link). */
  icon?: ReactNode;
  size?: ButtonProps["size"];
  variant?: ButtonProps["variant"];
  disabled?: boolean;
}

/**
 * A button that copies a value to the clipboard, briefly swapping its icon to a
 * checkmark and toasting on success. The optional onCopy side effect runs first
 * (the parties UI uses it so copying the info link also calls request-info). In
 * icon-only mode it renders a compact ghost icon button with the label as a
 * tooltip, for the grid's row actions.
 */
export function CopyButton({
  value,
  label,
  successMessage,
  onCopy,
  iconOnly = false,
  icon,
  size,
  variant,
  disabled,
}: CopyButtonProps) {
  const [copied, setCopied] = useState(false);

  const handleClick = async () => {
    try {
      await onCopy?.();
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "Something went wrong";
      toast.error(message);
      return;
    }

    const ok = await copyToClipboard(value);
    if (!ok) {
      toast.error("Could not copy to clipboard");
      return;
    }
    setCopied(true);
    toast.success(successMessage);
    setTimeout(() => setCopied(false), 1500);
  };

  if (iconOnly) {
    return (
      <Tooltip>
        <TooltipTrigger asChild>
          <Button
            aria-label={label}
            className="size-8"
            disabled={disabled}
            onClick={handleClick}
            size={size ?? "icon"}
            type="button"
            variant={variant ?? "ghost"}
          >
            {copied ? <Check /> : (icon ?? <Copy />)}
          </Button>
        </TooltipTrigger>
        <TooltipContent>{label}</TooltipContent>
      </Tooltip>
    );
  }

  return (
    <Button
      disabled={disabled}
      onClick={handleClick}
      size={size ?? "sm"}
      type="button"
      variant={variant ?? "outline"}
    >
      {copied ? <Check /> : (icon ?? <Copy />)}
      {label}
    </Button>
  );
}
