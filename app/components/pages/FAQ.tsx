import { ChevronDown } from "lucide-react";
import { useId, useState, type ReactNode } from "react";
import { Link } from "react-router-dom";

import PageHeader from "@/components/library/PageHeader";
import { cn } from "@/libraries/utils";

/**
 * Inline links inherit the surrounding text color and add only an underline and
 * a rose hover, matching the link treatment used elsewhere on the site.
 */
const linkClass =
  "underline underline-offset-2 transition-colors hover:text-rose";

/**
 * A single expandable question; each entry toggles independently. The answer is
 * free-form JSX (`children`), so it can hold rich text (links, lists, multiple
 * paragraphs) as the copy gets fleshed out.
 */
function FAQEntry({
  question,
  children,
}: {
  question: string;
  children: ReactNode;
}) {
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
          {question}
          <ChevronDown
            aria-hidden
            className={cn(
              "size-4 shrink-0 transition-transform duration-300 motion-reduce:transition-none",
              open && "rotate-180",
            )}
          />
        </button>
      </h2>
      {/* Expand/collapse animates the grid row between 0fr and 1fr (an
          animatable stand-in for height: auto). Visibility rides the same
          transition: it holds "visible" until the collapse finishes, then
          drops the answer from the accessibility tree, like `hidden` did
          before the animation. */}
      <div
        className={cn(
          "grid transition-[grid-template-rows,visibility] duration-300 ease-in-out motion-reduce:transition-none",
          open ? "grid-rows-[1fr]" : "grid-rows-[0fr]",
        )}
        style={{ visibility: open ? undefined : "hidden" }}
      >
        <div className="overflow-hidden">
          <div
            aria-labelledby={buttonId}
            className={cn(
              "px-5 pb-4 text-ink/80 transition-opacity duration-300 motion-reduce:transition-none",
              open ? "opacity-100" : "opacity-0",
            )}
            id={panelId}
            role="region"
          >
            {children}
          </div>
        </div>
      </div>
    </div>
  );
}

/**
 * FAQ: an accordion of common questions, each expanding independently. Copy is
 * hard-coded inline; edit it directly below (each answer is free-form JSX, so
 * rich text is fine).
 */
export default function FAQ() {
  return (
    <div className="mx-auto max-w-2xl py-12">
      <PageHeader
        subtitle="Answers to the things guests ask us most."
        title="Frequently Asked Questions"
      />

      <div className="mt-10 flex flex-col gap-3">
        <FAQEntry question="Where will the wedding take place?">
          <p>
            The ceremony and reception will both be in the same location:{" "}
            <a
              className={linkClass}
              href="https://arrowwoodevents.com/"
              rel="noopener noreferrer"
              target="_blank"
            >
              Arrowwood Weddings &amp; Events
            </a>
            . This is in Palmer, TX.
          </p>
        </FAQEntry>

        <FAQEntry question="Do I need to rent a car?">
          <p>
            We definitely recommend having a car available to you. More info can
            be found on the{" "}
            <Link className={linkClass} to="/travel">
              Travel
            </Link>{" "}
            page.
          </p>
        </FAQEntry>

        <FAQEntry question="What's a Madhuram Veppu?">
          <p>
            The Madhuram Veppu (pronounced muh-THOO-ruhm VEP-poo) is a
            traditional ceremony that happens on the day before a Kerala
            wedding, and it's a celebration that is meant to bring family and
            friends from both sides together and start the festivities.
          </p>
          <p className="mt-3">
            Madhuram means "sweetness" and veppu means "to give", so it's also
            sometimes called the "Sweetening Ceremony". The bride and groom will
            be seated at a table, and everyone can go up to feed them some
            sweets. It's a fun time that everyone can be involved in!
          </p>
        </FAQEntry>

        <FAQEntry question="What's the dress code for the events?">
          <p>
            For both the rehearsal dinner/Madhuram Veppu and the
            ceremony/reception, the dress code is semi-formal. In addition,
            you're also free to wear any kind of Indian clothes as well (e.g.
            sarees, lehengas, kurtas, etc).
          </p>
          <p className="mt-3">
            One thing to be mindful about is the weather. The rehearsal dinner
            will be indoors, so this is less of a concern for that, but the
            ceremony and reception will be outdoors. We want you to look nice,
            but we also want you to be comfortable!
          </p>
        </FAQEntry>

        <FAQEntry question="Do you have a gift registry?">
          <p>
            Your presence at our wedding is gift enough! We know some of you
            will be traveling in from out of town, so we greatly appreciate you
            taking the time to celebrate with us.
          </p>
          <p className="mt-3">
            If you'd still like to give something, we ask you to not bring any
            boxed gifts to the wedding, but instead, contribute to our new house
            fund through{" "}
            <a
              className={linkClass}
              href="https://venmo.com/u/robinjoseph08"
              rel="noopener noreferrer"
              target="_blank"
            >
              Venmo
            </a>{" "}
            or{" "}
            <a
              className={linkClass}
              href="https://enroll.zellepay.com/qr-codes?data=ewogICJ0b2tlbiIgOiAiOTcyNzU0NzIzNyIsCiAgImFjdGlvbiIgOiAicGF5bWVudCIsCiAgIm5hbWUiIDogIlJPQklOIgp9"
              rel="noopener noreferrer"
              target="_blank"
            >
              Zelle
            </a>
            .
          </p>
        </FAQEntry>
      </div>
    </div>
  );
}
