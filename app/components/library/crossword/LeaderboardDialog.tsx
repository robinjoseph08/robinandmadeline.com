// One puzzle's leaderboard, split into one tab per difficulty: fastest
// published solves first within the difficulty each solve is recorded at
// (the easiest used). Fetched lazily per tab when the dialog opens; the read
// is fully public. The dialog is only reachable after solving, so it opens
// on the tab of the guest's own recorded difficulty.
//
// The population is small and bounded (the wedding's guests), so the board
// shows EVERYONE rather than a top-N: every returned row renders inside the
// list's own bounded, independently scrollable scrollport, so the dialog
// stays within the viewport while the list scrolls. The backend cap (500) is
// a defensive ceiling well above any real board, so at wedding scale this is
// literally everyone. The fastest three get a gold/silver/bronze podium so
// the winners still get their moment even though all are shown.
//
// When given the solver's own session id, the read also returns that solver's
// ranked row (the backend's viewer), so the dialog always shows them their
// place: highlighted in the list when they are within the (capped) items, and
// appended as a separated row with its true rank when they fall past it. On
// open, the list scrolls that highlighted row into view within its own
// scrollport (centered), so a guest who placed, say, 80th lands on themselves
// and can scroll up to who beat them and down to who is chasing. The viewer
// comes back only on the solver's own recorded-difficulty tab, so no per-tab
// special-casing is needed here.

import { Trophy } from "lucide-react";
import { useEffect, useRef, useState } from "react";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogBody,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { useLeaderboard } from "@/hooks/queries/games";
import { formatDuration } from "@/libraries/format";
import { cn } from "@/libraries/utils";
import type { LeaderboardEntry } from "@/types/generated/games";

import { DIFFICULTIES, Difficulty, DIFFICULTY_LABELS } from "./puzzle";

interface LeaderboardDialogProps {
  /**
   * The tab to open on: the difficulty the guest's solve was recorded at.
   * The dialog is gated behind solving, so this always exists; "easy" is a
   * defensive fallback only.
   */
  defaultDifficulty?: Difficulty;
  onOpenChange: (open: boolean) => void;
  open: boolean;
  puzzleId: string;
  puzzleTitle: string;
  /**
   * The solver's own session id, when known. Passed to the read so the
   * backend returns the solver's own ranked row; the dialog then highlights
   * it in the list or appends it (with its true rank) when it falls past the
   * displayed items (only possible beyond the 500 cap). The viewer is returned
   * only on the solver's own recorded-difficulty tab, so other tabs render
   * plainly.
   */
  sessionId?: string;
}

export default function LeaderboardDialog({
  defaultDifficulty = "easy",
  onOpenChange,
  open,
  puzzleId,
  puzzleTitle,
  sessionId,
}: LeaderboardDialogProps) {
  const [difficulty, setDifficulty] = useState<Difficulty>(defaultDifficulty);

  // Re-anchor to the solve's own difficulty each time the dialog opens, so a
  // tab explored on a previous open doesn't stick (the render-time adjustment
  // pattern from the React docs, same as CompletionDialog's error reset).
  const [wasOpen, setWasOpen] = useState(open);
  if (open !== wasOpen) {
    setWasOpen(open);
    if (open) {
      setDifficulty(defaultDifficulty);
    }
  }

  const { data, isError, isPending } = useLeaderboard(
    puzzleId,
    difficulty,
    { enabled: open },
    sessionId,
  );

  // The backend sends viewer as null when there is no eligible solver (a
  // tab that is not the solver's, an anonymous read), so a falsy check is
  // all that is needed before reading its rank.
  const viewer = data?.viewer;

  // The list's own scrollport and the viewer's row within it, for the
  // open-time auto-scroll. The row ref is set whether the viewer's row sits
  // inside the displayed items or is the appended off-list row, so either
  // path centers the same way.
  const listRef = useRef<HTMLOListElement>(null);
  const viewerRowRef = useRef<HTMLLIElement>(null);

  // On open (and once the viewer's data arrives, and on a return to the
  // solver's own tab), bring the viewer's highlighted row into view within
  // the list's OWN scrollport. The list and the viewer's rank are the
  // dependencies: a tab switch swaps both, and the data arriving flips
  // items/viewer from undefined.
  const viewerRank = viewer?.rank;
  useEffect(() => {
    if (!open || viewerRank === undefined) {
      return;
    }
    // Measure and scroll on the next frame, not synchronously in the effect:
    // the dialog content is a Radix portal that remounts on each open, so on a
    // reopen the list/row nodes attach (and lay out) a beat after this effect
    // runs. Measuring now would read a not-yet-mounted scrollport and silently
    // no-op (the bug that left a reopened dialog stuck at the top); the frame
    // delay lets the fresh list lay out so the geometry is real.
    const frame = requestAnimationFrame(() => {
      const list = listRef.current;
      const row = viewerRowRef.current;
      if (!list || !row) {
        return;
      }
      // Scroll the list's own scrollport, never row.scrollIntoView(): on the
      // single-column mobile layout scrollIntoView walks every scrollable
      // ancestor and would yank the dialog or the page, the same trap the clue
      // list hit. Only the list itself may move, and only when the row is not
      // already fully inside it (a podium finisher near the top is left put).
      const listRect = list.getBoundingClientRect();
      const rowRect = row.getBoundingClientRect();
      const fullyVisible =
        rowRect.top >= listRect.top && rowRect.bottom <= listRect.bottom;
      if (fullyVisible) {
        return;
      }
      // Center the row in the scrollport: move its middle to the scrollport's
      // middle. The browser clamps scrollTo to the scrollable range on its
      // own, so a row near either end lands as close to centered as it can.
      const rowCenter = rowRect.top + rowRect.height / 2;
      const listCenter = listRect.top + listRect.height / 2;
      list.scrollTo({
        behavior: "auto",
        top: list.scrollTop + (rowCenter - listCenter),
      });
    });
    return () => cancelAnimationFrame(frame);
  }, [open, viewerRank, data?.items]);

  return (
    <Dialog onOpenChange={onOpenChange} open={open}>
      <DialogContent data-testid="crossword-leaderboard-dialog">
        <DialogHeader>
          <DialogTitle>Leaderboard</DialogTitle>
          <DialogDescription>
            {puzzleTitle}: the fastest posted solves at each difficulty.
          </DialogDescription>
        </DialogHeader>
        <DialogBody className="py-4">
          {/* Styled as tabs, exposed as a pressed-button group: the same
              idiom as the other difficulty pickers (StartDialog, the
              more-menu), which keeps plain Tab/Enter operation honest
              instead of half-promising the ARIA tabs keyboard contract. */}
          <div
            aria-label="Leaderboard difficulty"
            className="flex gap-1 rounded-md bg-secondary/20 p-1"
            role="group"
          >
            {DIFFICULTIES.map((level) => (
              <button
                aria-pressed={difficulty === level}
                className={cn(
                  "flex-1 cursor-pointer rounded px-2 py-1 text-sm transition-colors",
                  difficulty === level
                    ? "bg-cream font-medium shadow-sm"
                    : "text-muted-foreground hover:text-ink",
                )}
                key={level}
                onClick={() => setDifficulty(level)}
                type="button"
              >
                {DIFFICULTY_LABELS[level]}
              </button>
            ))}
          </div>
          <div className="mt-4">
            {isPending ? (
              <p className="text-sm text-muted-foreground">
                Loading the fastest solvers...
              </p>
            ) : isError ? (
              <p className="text-sm text-muted-foreground" role="alert">
                We couldn't load the leaderboard. Please try again in a bit.
              </p>
            ) : data.items.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                No {DIFFICULTY_LABELS[difficulty].toLowerCase()} times posted
                yet. Be the first!
              </p>
            ) : (
              <>
                {/* The whole board scrolls within this bounded scrollport, so
                    the dialog stays put at any guest count; the same
                    containment the clue lists use. The symmetric px-1 keeps a
                    tinted row's 1px ring off the left/right overflow edge, and
                    py-1.5 gives the first and last rows the same breathing room:
                    without it the last row (and its ring) sits flush against the
                    overflow boundary and its time reads as clipped when scrolled
                    to the bottom. The padding lands inside the scroll range, so
                    scrolling to the end now reveals the last row in full. */}
                <ol
                  className="max-h-[22rem] space-y-1.5 overflow-y-auto overscroll-contain px-1 py-1.5"
                  data-testid="crossword-leaderboard-list"
                  ref={listRef}
                >
                  {data.items.map((entry, index) => {
                    // The viewer (the solver's own row) is in the list when its
                    // rank falls within the displayed items; highlight that row
                    // rather than appending a duplicate below.
                    const isViewer =
                      Boolean(viewer) && viewer!.rank === index + 1;
                    return (
                      // The index disambiguates entries that share a name and a
                      // completion timestamp (the backend dedupes neither); the
                      // list is replaced wholesale on refetch, so an index key
                      // cannot go stale.
                      <Row
                        entry={entry}
                        isViewer={isViewer}
                        key={`${index}:${entry.display_name}`}
                        rank={index + 1}
                        rowRef={isViewer ? viewerRowRef : undefined}
                      />
                    );
                  })}
                </ol>
                {data.total > data.items.length && (
                  <p className="mt-3 text-xs text-muted-foreground">
                    Showing the fastest {data.items.length} of {data.total}{" "}
                    posted solves.
                  </p>
                )}
                {/* The solver's rank is past the displayed items: show their
                    own row anyway, separated, with its true number. (Only
                    reachable past the 500 cap, i.e. never at wedding scale.) */}
                {viewer && viewer.rank > data.items.length && (
                  <>
                    <div className="my-3 border-t border-dashed" />
                    <ol className="space-y-1.5">
                      <Row
                        entry={viewer.entry}
                        isViewer
                        rank={viewer.rank}
                        rowRef={viewerRowRef}
                      />
                    </ol>
                  </>
                )}
              </>
            )}
          </div>
        </DialogBody>
        <DialogFooter>
          <Button
            onClick={() => onOpenChange(false)}
            type="button"
            variant="outline"
          >
            Close
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/**
 * The gold/silver/bronze treatment for the top three ranks, keyed by rank.
 * Each place tints the WHOLE ROW the way the blue "You" highlight does, just in
 * its metal: a filled background plus a ring at the same intensity as the
 * viewer's `bg-secondary/40` + `ring-secondary`, so a podium row reads as a
 * place-colored sibling of the "You" row rather than a separate widget. The
 * `badge` recolors the "You" pill to the place (so a top-three viewer's badge
 * is gold/silver/bronze, never blue), and `trophy` tints the small trophy that
 * hugs the rank number. The tones are saturated enough to register as their
 * metal at a glance (a washed-out pastel reads as neither gold nor silver)
 * while staying warm next to the cream/ink wedding palette: amber for gold,
 * slate for silver, and orange for bronze (kept distinct from gold's amber).
 */
const PODIUM: Record<
  number,
  { badge: string; label: string; row: string; trophy: string }
> = {
  1: {
    // Gold: a warm amber wash with a deeper amber ring; the badge is a solid
    // amber pill with near-black text, and the trophy a mid amber.
    badge: "bg-amber-400 text-amber-950",
    label: "1st place",
    row: "bg-amber-300/45 ring-1 ring-amber-400",
    trophy: "text-amber-600",
  },
  2: {
    // Silver: a cool slate wash kept dark enough to read as metal on cream (the
    // usual silver-on-light trap is too pale a gray), ring and trophy to match.
    badge: "bg-slate-400 text-slate-950",
    label: "2nd place",
    row: "bg-slate-300/55 ring-1 ring-slate-400",
    trophy: "text-slate-600",
  },
  3: {
    // Bronze: a copper-orange wash, distinct from gold's amber so the two warm
    // metals don't blur together, with a deeper orange ring and trophy.
    badge: "bg-orange-400 text-orange-950",
    label: "3rd place",
    row: "bg-orange-300/45 ring-1 ring-orange-400",
    trophy: "text-orange-700",
  },
};

/**
 * One leaderboard line, laid out as: rank unit (trophy + number), name, time.
 * The fastest three tint the whole row gold/silver/bronze the same way the
 * viewer's "You" row tints blue (a background + ring), and a small trophy hugs
 * the left of the rank number. The rank number itself is the same muted "{rank}."
 * on every row, right-aligned within a fixed-width unit, so the numbers (and the
 * names after them) line up in one column straight down the list whether or not
 * a row is a podium row; the trophy floats to the number's left without pushing
 * it. The solver's own row carries a "You" badge so they can spot their place,
 * whether it sits inside the displayed list or is the appended off-list row
 * below the separator. The two treatments compose: a non-podium viewer is blue
 * (row tint + ring and a blue badge); a top-three viewer is the place color
 * throughout (place row tint + ring, a place-colored badge, the place trophy),
 * with zero blue. rowRef is set on the viewer's row so the dialog can center it
 * on open.
 */
function Row({
  entry,
  isViewer,
  rank,
  rowRef,
}: {
  entry: LeaderboardEntry;
  isViewer: boolean;
  rank: number;
  rowRef?: React.Ref<HTMLLIElement>;
}) {
  const podium = PODIUM[rank];
  return (
    <li
      className={cn(
        // Every row carries the same padding so the rank/name/time columns line
        // up across plain, podium, and viewer rows; both highlights below are a
        // background + ring only, never extra padding, so a tinted row never
        // shifts its contents out of alignment with its neighbors.
        "flex items-center gap-3 rounded px-2 py-1 text-sm",
        // Row tint: a podium row wears its place color; otherwise the viewer's
        // own row wears the blue "You" highlight; a plain row stays untinted.
        podium
          ? cn("font-medium", podium.row)
          : isViewer && "bg-secondary/40 font-medium ring-1 ring-secondary",
      )}
      ref={rowRef}
    >
      {/* The rank unit: a fixed-width, right-aligned slot holding the trophy
          (podium rows only) immediately left of the number. Right-justifying
          inside a fixed width keeps every "{rank}." period in one column and
          the names starting at the same x, podium or not; the single-digit
          podium trophies line up with each other on the number's left. The
          width fits the trophy plus the largest rank that can occur (the
          appended off-list viewer row can run to four digits) without wrapping. */}
      <span className="flex w-16 shrink-0 items-center justify-end gap-1">
        {podium && (
          <Trophy
            aria-hidden="true"
            className={cn("size-4 shrink-0", podium.trophy)}
            data-testid="podium-trophy"
          />
        )}
        {/* One shared rank-number style for every row (podium and plain alike):
            muted, right-aligned, tabular figures, so the numbers form a single
            tidy column; only the trophy to its left changes for the podium. */}
        <span className="text-right text-muted-foreground tabular-nums">
          {rank}.
        </span>
      </span>
      {/* A visually hidden, labelled marker so a screen reader announces "Nth
          place" on podium rows (the trophy itself is decorative); non-podium
          rows have none. aria-label (not just text) keeps it reachable as an
          accessible name, the same hook the tests assert against. */}
      {podium && <span aria-label={podium.label} className="sr-only" />}
      <span className="flex min-w-0 flex-1 items-baseline gap-2">
        <span className="min-w-0 truncate font-medium">
          {entry.display_name}
        </span>
        {isViewer && (
          <span
            className={cn(
              // The "You" pill takes the place color on a top-three viewer (no
              // blue), or the blue secondary on a non-podium viewer.
              "shrink-0 rounded-full px-1.5 text-xs font-medium",
              podium ? podium.badge : "bg-secondary text-secondary-foreground",
            )}
          >
            You
          </span>
        )}
      </span>
      <span className="shrink-0 tabular-nums">
        {formatDuration(entry.elapsed_ms)}
      </span>
    </li>
  );
}
