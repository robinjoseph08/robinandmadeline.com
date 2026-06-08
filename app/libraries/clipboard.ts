/**
 * Copies text to the clipboard, preferring the async Clipboard API and falling
 * back to a hidden textarea + execCommand for environments where it is missing
 * or blocked (older browsers, non-secure contexts). Returns whether the copy
 * succeeded so callers can show success or error feedback.
 */
export async function copyToClipboard(text: string): Promise<boolean> {
  if (navigator.clipboard?.writeText) {
    try {
      await navigator.clipboard.writeText(text);
      return true;
    } catch {
      // Fall through to the execCommand fallback below.
    }
  }

  try {
    const textarea = document.createElement("textarea");
    textarea.value = text;
    // Keep it out of the layout and unfocusable as a control.
    textarea.style.position = "fixed";
    textarea.style.opacity = "0";
    textarea.setAttribute("readonly", "");
    document.body.appendChild(textarea);
    textarea.select();
    const ok = document.execCommand("copy");
    document.body.removeChild(textarea);
    return ok;
  } catch {
    return false;
  }
}

/**
 * Builds the absolute info-collection URL for a party's info token. The public
 * info route is `/i/:token`; admins copy the full origin-qualified link to share.
 */
export function infoLinkForToken(token: string): string {
  return `${window.location.origin}/i/${token}`;
}
