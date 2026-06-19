import { Link } from "react-router-dom";

import { useAuth } from "@/libraries/auth-context";

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
  const { isAuthenticated } = useAuth();

  // The games aren't ready for guests yet, so anyone without an admin session
  // gets a friendly "coming soon" note instead of the list. The play routes are
  // gated to match (see RequireGamesAccess), so the cards stay hidden here too.
  if (!isAuthenticated) {
    return (
      <section className="mx-auto max-w-2xl py-8">
        <h1 className="text-3xl font-bold">Games</h1>
        <p className="mt-3 text-muted-foreground">
          We're building some games for you to play while you wait for the
          wedding. Check back later to play them!
        </p>
      </section>
    );
  }

  return (
    <section className="mx-auto max-w-2xl py-8">
      <p className="mb-6 rounded-md border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-900">
        You're seeing the games below because you're signed in as an admin.
        Guests get a coming soon note until they're ready.
      </p>

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
