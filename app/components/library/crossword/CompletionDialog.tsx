// The post-solve dialog: final time, the difficulty the solve is recorded at
// (the easiest used, per the server), and the leaderboard opt-in. A successful
// post hands off to the parent, which closes this dialog and opens the
// leaderboard on the solver's row; this dialog has no post-success state of
// its own. Declining is a first-class path; the page keeps a "Post your time"
// affordance around so a guest can change their mind later.

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
  /**
   * Publish the solve. Resolves on success (the parent then closes this
   * dialog and opens the leaderboard) and rejects with a guest-facing Error
   * the dialog surfaces inline.
   */
  onPost: (displayName: string) => Promise<void>;
  open: boolean;
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
  open,
  prefillName,
  puzzleTitle,
}: CompletionDialogProps) {
  const [typedName, setTypedName] = useState("");
  const [touched, setTouched] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // A failure from an earlier attempt must not greet the guest when the
  // dialog reopens (for example via "Post your time"), so clear it whenever
  // open flips to true. This is the render-time adjustment pattern from the
  // React docs, which avoids an extra effect-driven render pass.
  const [wasOpen, setWasOpen] = useState(open);
  if (open !== wasOpen) {
    setWasOpen(open);
    if (open) {
      setError(null);
    }
  }

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
      // Any thrown Error carries a message written for the guest: ApiError
      // holds the backend's, and useSolveSession crafts a friendly one for
      // offline failures. The generic copy is only for non-Error throws.
      setError(
        err instanceof Error && err.message
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
        <DialogBody className="space-y-3 py-4">
          <p className="text-sm">Want to post your time to the leaderboard?</p>
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
      </DialogContent>
    </Dialog>
  );
}
