import { ChevronDown } from "lucide-react";
import { useId, useState } from "react";

import PageHeader from "@/components/library/PageHeader";
import { FAQ_ITEMS, type FAQItem } from "@/components/pages/faq-content";
import { cn } from "@/libraries/utils";

/** A single expandable question; each entry toggles independently. */
function FAQEntry({ item }: { item: FAQItem }) {
  const [open, setOpen] = useState(false);
  const id = useId();
  const buttonId = `${id}-button`;
  const panelId = `${id}-panel`;

  return (
    <div className="rounded-xl border border-ink/10 bg-primary/30">
      {/* Heading wrapper per the WAI-ARIA accordion pattern, so screen
          readers can navigate the questions by heading. */}
      <h2>
        <button
          aria-controls={panelId}
          aria-expanded={open}
          className="flex w-full cursor-pointer items-center justify-between gap-4 px-5 py-4 text-left font-medium"
          id={buttonId}
          onClick={() => setOpen((v) => !v)}
          type="button"
        >
          {item.question}
          <ChevronDown
            aria-hidden
            className={cn(
              "size-4 shrink-0 transition-transform",
              open && "rotate-180",
            )}
          />
        </button>
      </h2>
      <div
        aria-labelledby={buttonId}
        className="px-5 pb-4 text-ink/80"
        hidden={!open}
        id={panelId}
        role="region"
      >
        {item.answer}
      </div>
    </div>
  );
}

/** FAQ: an accordion of common questions, each expanding independently. */
export default function FAQ() {
  return (
    <div className="mx-auto max-w-2xl py-12">
      <PageHeader
        subtitle="Answers to the things guests ask us most."
        title="Frequently Asked Questions"
      />

      <div className="mt-10 flex flex-col gap-3">
        {FAQ_ITEMS.map((item) => (
          <FAQEntry item={item} key={item.question} />
        ))}
      </div>
    </div>
  );
}
