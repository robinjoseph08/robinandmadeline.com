// One puzzle's leaderboard: fastest published solves first, with the
// difficulty each solve is recorded at (the easiest used). Fetched lazily
// when the dialog opens; the read is fully public.

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

import { DIFFICULTY_LABELS } from "./puzzle";

interface LeaderboardDialogProps {
  onOpenChange: (open: boolean) => void;
  open: boolean;
  puzzleId: string;
  puzzleTitle: string;
}

export default function LeaderboardDialog({
  onOpenChange,
  open,
  puzzleId,
  puzzleTitle,
}: LeaderboardDialogProps) {
  const { data, isError, isPending } = useLeaderboard(puzzleId, {
    enabled: open,
  });

  return (
    <Dialog onOpenChange={onOpenChange} open={open}>
      <DialogContent data-testid="crossword-leaderboard-dialog">
        <DialogHeader>
          <DialogTitle>Leaderboard</DialogTitle>
          <DialogDescription>
            {puzzleTitle}: the fastest posted solves.
          </DialogDescription>
        </DialogHeader>
        <DialogBody className="py-4">
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
              No times posted yet. Be the first!
            </p>
          ) : (
            <>
              <ol className="space-y-1.5">
                {data.items.map((entry, index) => (
                  <li
                    className="flex items-baseline gap-3 text-sm"
                    key={`${entry.display_name}:${entry.completed_at}`}
                  >
                    <span className="w-6 shrink-0 text-right text-muted-foreground">
                      {index + 1}.
                    </span>
                    <span className="min-w-0 flex-1 truncate font-medium">
                      {entry.display_name}
                    </span>
                    <span className="shrink-0 text-xs text-muted-foreground">
                      {DIFFICULTY_LABELS[entry.difficulty]}
                    </span>
                    <span className="shrink-0 tabular-nums">
                      {formatDuration(entry.elapsed_ms)}
                    </span>
                  </li>
                ))}
              </ol>
              {data.total > data.items.length && (
                <p className="mt-3 text-xs text-muted-foreground">
                  Showing the fastest {data.items.length} of {data.total} posted
                  solves.
                </p>
              )}
            </>
          )}
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
