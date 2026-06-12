// The post-solve dialog: final time, the difficulty the solve is recorded at
// (the easiest used, per the server), and the leaderboard opt-in. Declining
// is a first-class path; the page keeps a "Post your time" affordance around
// so a guest can change their mind later.

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
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ApiError } from "@/libraries/api";
import { formatDuration } from "@/libraries/format";

import { Difficulty, DIFFICULTY_LABELS } from "./puzzle";

const MAX_NAME_LENGTH = 50;

interface CompletionDialogProps {
  /** The difficulty the solve is recorded at (easiest used, server's view). */
  difficulty: Difficulty;
  elapsedMs: number;
  /** Whether a guest token is present (affects the helper copy only). */
  isSignedIn: boolean;
  onOpenChange: (open: boolean) => void;
  onPost: (displayName: string) => Promise<void>;
  onViewLeaderboard: () => void;
  open: boolean;
  /** Whether this solve is already on the leaderboard. */
  posted: boolean;
  /** Name to suggest for signed-in guests (from their RSVP record). */
  prefillName?: string;
  puzzleTitle: string;
}

export default function CompletionDialog({
  difficulty,
  elapsedMs,
  isSignedIn,
  onOpenChange,
  onPost,
  onViewLeaderboard,
  open,
  posted,
  prefillName,
  puzzleTitle,
}: CompletionDialogProps) {
  const [typedName, setTypedName] = useState("");
  const [touched, setTouched] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // The prefill arrives async (the guest's RSVP record loads when the dialog
  // opens), so the field shows it until the guest types anything themselves.
  const name = touched ? typedName : (prefillName ?? "");

  const trimmed = name.trim();
  const tooLong = trimmed.length > MAX_NAME_LENGTH;
  const valid = trimmed.length > 0 && !tooLong;

  const handlePost = async () => {
    if (!valid || submitting) {
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      await onPost(trimmed);
    } catch (err) {
      setError(
        err instanceof ApiError
          ? err.message
          : "We couldn't post your time right now. Please try again.",
      );
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Dialog onOpenChange={onOpenChange} open={open}>
      <DialogContent data-testid="crossword-completion-dialog">
        <DialogHeader>
          <DialogTitle>You solved it!</DialogTitle>
          <DialogDescription>
            You finished {puzzleTitle} in {formatDuration(elapsedMs)} with the{" "}
            {DIFFICULTY_LABELS[difficulty].toLowerCase()} clues.
          </DialogDescription>
        </DialogHeader>
        {posted ? (
          <>
            <DialogBody className="py-4">
              <p className="text-sm">
                Your time is on the leaderboard. See you on the dance floor!
              </p>
            </DialogBody>
            <DialogFooter>
              <Button
                onClick={() => onOpenChange(false)}
                type="button"
                variant="outline"
              >
                Close
              </Button>
              <Button onClick={onViewLeaderboard} type="button">
                View leaderboard
              </Button>
            </DialogFooter>
          </>
        ) : (
          <>
            <DialogBody className="space-y-3 py-4">
              <p className="text-sm">
                Want to post your time to the leaderboard?
              </p>
              <div className="space-y-1.5">
                <Label htmlFor="leaderboard-name">Display name</Label>
                <Input
                  id="leaderboard-name"
                  onChange={(e) => {
                    setTypedName(e.target.value);
                    setTouched(true);
                  }}
                  value={name}
                />
                <p className="text-xs text-muted-foreground">
                  {isSignedIn
                    ? "This is how your time will appear on the leaderboard."
                    : "This is how your time will appear on the leaderboard, and it helps us know whose solve to cheer for."}
                </p>
                {tooLong && (
                  <p className="text-xs text-destructive" role="alert">
                    Please keep your name under {MAX_NAME_LENGTH} characters.
                  </p>
                )}
              </div>
              {error && (
                <p className="text-sm text-destructive" role="alert">
                  {error}
                </p>
              )}
            </DialogBody>
            <DialogFooter>
              <Button
                onClick={() => onOpenChange(false)}
                type="button"
                variant="outline"
              >
                No thanks
              </Button>
              <Button
                disabled={!valid || submitting}
                onClick={handlePost}
                type="button"
              >
                Post my time
              </Button>
            </DialogFooter>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
