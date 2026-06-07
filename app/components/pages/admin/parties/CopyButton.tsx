import { Check, Copy } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";

import { Button, type ButtonProps } from "@/components/ui/button";
import { copyToClipboard } from "@/libraries/clipboard";

interface CopyButtonProps {
  /** The text written to the clipboard. */
  value: string;
  /** Visible button label. */
  label: string;
  /** Toast shown on a successful copy. */
  successMessage: string;
  /** Run before copying (e.g. the info link also triggers request-info). */
  onCopy?: () => void | Promise<void>;
  size?: ButtonProps["size"];
  variant?: ButtonProps["variant"];
  disabled?: boolean;
}

/**
 * A button that copies a value to the clipboard, briefly swapping its icon to a
 * checkmark and toasting on success. The optional onCopy side effect runs first
 * (the parties UI uses it so copying the info link also calls request-info).
 */
export function CopyButton({
  value,
  label,
  successMessage,
  onCopy,
  size = "sm",
  variant = "outline",
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

  return (
    <Button
      disabled={disabled}
      onClick={handleClick}
      size={size}
      type="button"
      variant={variant}
    >
      {copied ? <Check /> : <Copy />}
      {label}
    </Button>
  );
}
