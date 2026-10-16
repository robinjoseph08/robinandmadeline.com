import * as React from "react";

import { cn } from "@/libraries/utils";

const Input = React.forwardRef<HTMLInputElement, React.ComponentProps<"input">>(
  ({ autoComplete, className, type, ...props }, ref) => {
    return (
      <input
        autoComplete={autoComplete}
        className={cn(
          "flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-base shadow-sm transition-colors file:border-0 file:bg-transparent file:text-sm file:font-medium file:text-foreground placeholder:text-ink/40 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50 md:text-sm",
          className,
        )}
        // 1Password ignores autocomplete="off" and offers saved logins on any
        // field its heuristics mistake for a username, so opt out explicitly.
        // A field that names a real autocomplete token (such as "email") keeps
        // password-manager autofill.
        data-1p-ignore={
          autoComplete === undefined || autoComplete === "off" ? true : undefined
        }
        ref={ref}
        type={type}
        {...props}
      />
    );
  },
);
Input.displayName = "Input";

export { Input };
