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

import { Medal } from "lucide-react";
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
                    containment the clue lists use. */}
                <ol
                  className="max-h-[22rem] space-y-1.5 overflow-y-auto overscroll-contain pr-1"
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
 * The gold/silver/bronze styling for the top three ranks, keyed by rank. The
 * palette is warm metallics that sit on the cream surface without fighting the
 * wedding blues/pinks; rank 4+ returns undefined and renders plainly.
 */
const PODIUM: Record<number, { badge: string; label: string; medal: string }> =
  {
    1: {
      badge: "bg-amber-100 text-amber-900 ring-1 ring-amber-300",
      label: "1st place",
      medal: "text-amber-500",
    },
    2: {
      badge: "bg-slate-100 text-slate-700 ring-1 ring-slate-300",
      label: "2nd place",
      medal: "text-slate-400",
    },
    3: {
      badge: "bg-orange-100 text-orange-900 ring-1 ring-orange-300",
      label: "3rd place",
      medal: "text-orange-400",
    },
  };

/**
 * One leaderboard line. The fastest three get a colored medal and a metallic
 * rank badge (the podium); everyone else gets a plain muted number. The
 * solver's own row gets a "You" badge and an accent background so they can
 * spot their place, whether it sits inside the displayed list or is the
 * appended off-list row below the separator; that highlight composes with the
 * podium (a viewer in the top three reads as both). rowRef is set on the
 * viewer's row so the dialog can center it on open.
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
        // Every row carries the same padding so the rank/name/time columns
        // line up across plain, podium, and viewer rows; the viewer highlight
        // below is a background + ring only, never extra padding, so it never
        // shifts a row's contents out of alignment with its neighbors.
        "flex items-center gap-3 rounded px-2 py-1 text-sm",
        isViewer && "bg-secondary/40 font-medium ring-1 ring-secondary",
      )}
      ref={rowRef}
    >
      {podium ? (
        <span
          aria-label={podium.label}
          className={cn(
            // A clearly visible medal is the rank's marker; the number sits
            // beside it so the placing still reads at a glance. The pill shares
            // the plain number's width so the name column stays aligned.
            "flex w-11 shrink-0 items-center justify-center gap-1 rounded-full py-0.5 pl-1 pr-1.5 text-xs font-semibold tabular-nums",
            podium.badge,
          )}
        >
          <Medal aria-hidden="true" className={cn("h-5 w-5", podium.medal)} />
          {rank}
        </span>
      ) : (
        <span className="w-11 shrink-0 pr-1.5 text-right text-muted-foreground">
          {rank}.
        </span>
      )}
      <span className="flex min-w-0 flex-1 items-baseline gap-2">
        <span className="min-w-0 truncate font-medium">
          {entry.display_name}
        </span>
        {isViewer && (
          <span className="shrink-0 rounded-full bg-secondary px-1.5 text-xs font-medium text-secondary-foreground">
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
