import { Image as ImageIcon } from "lucide-react";

import PageHeader from "@/components/library/PageHeader";
import { MILESTONES } from "@/components/pages/story-content";
import { cn } from "@/libraries/utils";

/**
 * Our Story: a vertical timeline of relationship milestones. Each milestone
 * shows a date, a short blurb, and a placeholder block where a photo will go.
 */
export default function Story() {
  return (
    <div className="mx-auto max-w-2xl py-12">
      <PageHeader
        subtitle="A few milestones from our journey so far."
        title="Our Story"
      />

      <ol className="mt-12 space-y-12 border-l-2 border-ink/10 pl-6 sm:pl-10">
        {MILESTONES.map((milestone) => (
          <li className="relative" key={milestone.title}>
            {/* Timeline dot, centered on the list's left border. */}
            <span
              aria-hidden
              className="absolute top-1 -left-[31px] size-3 rounded-full bg-complementary-2 ring-4 ring-cream sm:-left-[47px]"
            />
            <p className="text-sm font-medium uppercase tracking-widest text-ink/70">
              {milestone.date}
            </p>
            <h2 className="mt-1 text-xl font-semibold">{milestone.title}</h2>
            <p className="mt-2 leading-relaxed text-ink/80">
              {milestone.blurb}
            </p>
            <div
              className={cn(
                "mt-5 flex aspect-[4/3] items-center justify-center gap-2 rounded-xl text-sm text-ink/70",
                milestone.photoColorClass,
              )}
            >
              <ImageIcon aria-hidden className="size-5" />
              Photo coming soon
            </div>
          </li>
        ))}
      </ol>
    </div>
  );
}
