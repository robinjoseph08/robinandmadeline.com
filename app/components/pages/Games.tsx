import { Link } from "react-router-dom";

interface GameInfo {
  description: string;
  title: string;
  to: string;
}

/** The available games. Add an entry here when a new game ships. */
const GAMES: GameInfo[] = [
  {
    description:
      "A quick five-by-five warm-up with easy, medium, and hard clues. Your progress saves in your browser, so come back any time.",
    title: "Mini Crossword",
    to: "/games/mini",
  },
  {
    description:
      "The full-size fifteen-by-fifteen grid for a longer challenge, with the same three difficulty levels. Progress saves here too.",
    title: "Crossword",
    to: "/games/crossword",
  },
];

export default function Games() {
  return (
    <section className="mx-auto max-w-2xl py-8">
      <h1 className="text-3xl font-bold">Games</h1>
      <p className="mt-3 text-muted-foreground">
        A little fun while you wait for the big day.
      </p>

      <div className="mt-6 flex flex-col gap-6">
        {GAMES.map((game) => (
          <Link
            className="block rounded-lg border border-ink/10 bg-cream p-5 transition-colors hover:border-ink/30"
            key={game.to}
            to={game.to}
          >
            <h2 className="text-xl font-semibold">{game.title}</h2>
            <p className="mt-1 text-sm text-muted-foreground">
              {game.description}
            </p>
          </Link>
        ))}
      </div>
    </section>
  );
}
