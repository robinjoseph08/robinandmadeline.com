import { Heart } from "lucide-react";

import Monogram from "@/components/library/Monogram";

/** Shared site footer: the floral monogram mark and a small signature line. */
export default function SiteFooter() {
  return (
    <footer className="relative z-10 mt-24 border-t border-line bg-page">
      <div className="mx-auto max-w-5xl px-4 py-12 text-center">
        <Monogram className="mx-auto h-24 w-auto" sizes="104px" />
        <p className="mt-4 flex items-center justify-center gap-1.5 text-sm text-ink-muted">
          Made with
          <Heart aria-hidden className="size-3.5 fill-rose text-rose" />
          by Robin
        </p>
      </div>
    </footer>
  );
}
