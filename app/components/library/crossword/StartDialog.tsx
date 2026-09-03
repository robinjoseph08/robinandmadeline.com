// The pre-solve dialog: pick a starting difficulty and whether to show the
// timer. Dismissing it without starting leaves the play area blurred behind
// a centered "Start solving" button (the page reopens this dialog from
// there), so the clock always starts exactly when the guest commits.

import { Heart } from "lucide-react";
import { useState } from "react";

import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogBody,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";

import { Difficulty, DIFFICULTY_LABELS, PuzzleDifficulties } from "./puzzle";

interface StartDialogProps {
  difficulties: PuzzleDifficulties;
  /**
   * Radix close-focus hook: the page uses it to put focus in the grid when
   * the dialog closes because the solve started.
   */
  onCloseAutoFocus: (event: Event) => void;
  onOpenChange: (open: boolean) => void;
  onShowTimerChange: (show: boolean) => void;
  onStart: (difficulty: Difficulty) => void;
  open: boolean;
  /** Lives in the shared settings, so it is the same value the gear menu edits. */
  showTimer: boolean;
  /** Show the mobile recommendation to use a desktop when possible. */
  showDesktopRecommendation: boolean;
}

export default function StartDialog({
  difficulties,
  onCloseAutoFocus,
  onOpenChange,
  onShowTimerChange,
  onStart,
  open,
  showDesktopRecommendation,
  showTimer,
}: StartDialogProps) {
  const [difficulty, setDifficulty] = useState<Difficulty>(difficulties[0]);

  return (
    <Dialog onOpenChange={onOpenChange} open={open}>
      <DialogContent
        data-testid="crossword-start-dialog"
        onCloseAutoFocus={onCloseAutoFocus}
      >
        <DialogHeader>
          <DialogTitle>Ready to solve?</DialogTitle>
          <DialogDescription>
            Pick the clues you want to start with. Every solve is timed, and
            when you finish you can post your time to the leaderboard.
          </DialogDescription>
        </DialogHeader>
        <DialogBody className="space-y-4 py-4">
          <div className="space-y-2">
            <p className="text-sm font-medium" id="start-difficulty-label">
              Difficulty
            </p>
            <div
              aria-labelledby="start-difficulty-label"
              className="flex flex-wrap gap-2"
              role="group"
            >
              {difficulties.map((level) => (
                <Button
                  aria-pressed={difficulty === level}
                  key={level}
                  onClick={() => setDifficulty(level)}
                  size="sm"
                  type="button"
                  variant={difficulty === level ? "default" : "outline"}
                >
                  {DIFFICULTY_LABELS[level]}
                </Button>
              ))}
            </div>
          </div>
          <div className="flex items-center gap-2">
            <Checkbox
              checked={showTimer}
              id="start-show-timer"
              onCheckedChange={(checked) => onShowTimerChange(checked === true)}
            />
            <Label htmlFor="start-show-timer">
              Show the timer while I solve
            </Label>
          </div>
          {difficulties.length > 1 && (
            <p className="text-sm text-muted-foreground">
              You can switch difficulty mid-solve, but your time is recorded at
              the easiest difficulty you use at any point.
            </p>
          )}
          <div className="flex gap-2 rounded-md border border-ink/10 bg-primary p-3 text-sm text-muted-foreground">
            <span aria-hidden="true" className="shrink-0 self-center p-1">
              🎉
            </span>
            <p>
              The goal of this is to have fun! If you're having trouble with a
              clue, use the "Check" button near the timer to check your work. If
              you're still stuck, feel free to Google the answer. Don't let a
              few hard ones prevent you from completing the puzzle. I want you
              to see the actual proposal at the end!{" "}
              <Heart
                aria-hidden
                className="relative -top-px inline size-3.5 fill-blue align-middle text-blue"
              />
            </p>
          </div>
          {showDesktopRecommendation && (
            <p className="rounded-md border border-secondary/30 bg-secondary/10 p-3 text-sm text-muted-foreground">
              This puzzle is doable on mobile, but the best and most accurate
              experience is on desktop.
            </p>
          )}
        </DialogBody>
        <DialogFooter>
          <Button onClick={() => onStart(difficulty)} type="button">
            Start solving
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
