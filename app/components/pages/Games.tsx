import { Link } from "react-router-dom";

import { usePageTitle } from "@/hooks/usePageTitle";

const PROPOSAL_BLURB =
  "This is the same crossword grid that Madeline solved when Robin proposed to her. The clues have been adjusted so it's actually possible for other people to solve it. When you solve this puzzle, you'll see the same animation that Madeline saw when she completed it as well.";

export default function Games() {
  usePageTitle("Games");

  return (
    <section className="mx-auto max-w-2xl py-8">
      <h1 className="text-3xl font-bold">Games</h1>
      <p className="mt-3 text-muted-foreground">
        A little fun while you wait for the big day.
      </p>

      <div className="mt-6">
        <Link
          className="block rounded-lg border border-ink/10 bg-cream p-5 transition-colors hover:border-ink/30"
          to="/games/proposal"
        >
          <h2 className="text-xl font-semibold">Proposal Crossword</h2>
          <p className="mt-1 text-sm text-muted-foreground">{PROPOSAL_BLURB}</p>
        </Link>
      </div>
    </section>
  );
}
