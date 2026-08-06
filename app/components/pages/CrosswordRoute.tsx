import { Link, useParams } from "react-router-dom";

import { PUZZLES_BY_SLUG } from "@/components/library/crossword/puzzles";
import Crossword from "@/components/pages/Crossword";
import { usePageTitle } from "@/hooks/usePageTitle";

function PuzzleNotFound() {
  usePageTitle();

  return (
    <section className="mx-auto max-w-2xl py-8">
      <h1 className="text-3xl font-bold">Hmm, we can't find that puzzle</h1>
      <p className="mt-3 text-muted-foreground" role="alert">
        There's no crossword at this address. Head back to{" "}
        <Link className="underline" to="/games">
          the games page
        </Link>{" "}
        to find one.
      </p>
    </section>
  );
}

/** Limits the generic puzzle route to entries in the public puzzle registry. */
export default function CrosswordRoute() {
  const { puzzleSlug = "" } = useParams();
  const isPublicPuzzle = Object.prototype.hasOwnProperty.call(
    PUZZLES_BY_SLUG,
    puzzleSlug,
  );

  return isPublicPuzzle ? <Crossword /> : <PuzzleNotFound />;
}
