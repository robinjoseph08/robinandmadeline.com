import { Toaster as Sonner, type ToasterProps } from "sonner";

/**
 * App toaster, wired to the wedding palette via CSS variables. The site has no
 * theme switcher, so the toaster is always light.
 */
function Toaster(props: ToasterProps) {
  return (
    <Sonner
      className="toaster group"
      style={
        {
          "--normal-bg": "var(--popover)",
          "--normal-text": "var(--popover-foreground)",
          "--normal-border": "var(--border)",
        } as React.CSSProperties
      }
      theme="light"
      {...props}
    />
  );
}

export { Toaster };
