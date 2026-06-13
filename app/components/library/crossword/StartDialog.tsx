// The pre-solve dialog: pick a starting difficulty and whether to show the
// timer. Dismissing it without starting leaves the play area blurred behind
// a centered "Start solving" button (the page reopens this dialog from
// there), so the clock always starts exactly when the guest commits.

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

import { DIFFICULTIES, Difficulty, DIFFICULTY_LABELS } from "./puzzle";

interface StartDialogProps {
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
}

export default function StartDialog({
  onCloseAutoFocus,
  onOpenChange,
  onShowTimerChange,
  onStart,
  open,
  showTimer,
}: StartDialogProps) {
  const [difficulty, setDifficulty] = useState<Difficulty>("easy");

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
          <div
            aria-label="Difficulty"
            className="flex flex-wrap gap-2"
            role="group"
          >
            {DIFFICULTIES.map((level) => (
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
          <p className="text-sm text-muted-foreground">
            You can switch difficulty mid-solve, but your time is recorded at
            the easiest difficulty you use at any point.
          </p>
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
