// One puzzle's leaderboard, split into one tab per difficulty: fastest
// published solves first within the difficulty each solve is recorded at
// (the easiest used). Fetched lazily per tab when the dialog opens; the read
// is fully public. The dialog is only reachable after solving, so it opens
// on the tab of the guest's own recorded difficulty.

import { useState } from "react";

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
}

export default function LeaderboardDialog({
  defaultDifficulty = "easy",
  onOpenChange,
  open,
  puzzleId,
  puzzleTitle,
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

  const { data, isError, isPending } = useLeaderboard(puzzleId, difficulty, {
    enabled: open,
  });

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
                <ol className="space-y-1.5">
                  {data.items.map((entry, index) => (
                    // The index disambiguates entries that share a name and a
                    // completion timestamp (the backend dedupes neither); the
                    // list is replaced wholesale on refetch, so an index key
                    // cannot go stale.
                    <li
                      className="flex items-baseline gap-3 text-sm"
                      key={`${index}:${entry.display_name}`}
                    >
                      <span className="w-6 shrink-0 text-right text-muted-foreground">
                        {index + 1}.
                      </span>
                      <span className="min-w-0 flex-1 truncate font-medium">
                        {entry.display_name}
                      </span>
                      <span className="shrink-0 tabular-nums">
                        {formatDuration(entry.elapsed_ms)}
                      </span>
                    </li>
                  ))}
                </ol>
                {data.total > data.items.length && (
                  <p className="mt-3 text-xs text-muted-foreground">
                    Showing the fastest {data.items.length} of {data.total}{" "}
                    posted solves.
                  </p>
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
