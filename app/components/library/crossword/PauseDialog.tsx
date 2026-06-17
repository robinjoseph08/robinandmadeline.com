// The pause dialog, centered over the page while the play area behind it is
// blurred and inert (the page owns that overlay). Closing the dialog by any
// means (the Resume button, the X, Escape, an outside click) resumes the
// clock, so "paused" and "this dialog is open" are always the same state; the
// page's onCloseAutoFocus then puts focus back in the grid.

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

interface PauseDialogProps {
  /** The elapsed readout to show, or null when the guest hid the timer. */
  elapsed: string | null;
  onCloseAutoFocus: (event: Event) => void;
  onResume: () => void;
  open: boolean;
}

export default function PauseDialog({
  elapsed,
  onCloseAutoFocus,
  onResume,
  open,
}: PauseDialogProps) {
  return (
    <Dialog
      onOpenChange={(value) => {
        if (!value) {
          onResume();
        }
      }}
      open={open}
    >
      <DialogContent
        data-testid="crossword-pause-dialog"
        onCloseAutoFocus={onCloseAutoFocus}
      >
        <DialogHeader>
          <DialogTitle>Paused</DialogTitle>
          <DialogDescription>
            The clock is stopped and your letters are saved.
          </DialogDescription>
        </DialogHeader>
        <DialogBody className="py-4">
          {elapsed !== null && (
            <p
              className="text-center text-3xl font-semibold tabular-nums"
              data-testid="crossword-pause-elapsed"
            >
              {elapsed}
            </p>
          )}
        </DialogBody>
        <DialogFooter>
          <Button onClick={onResume} type="button">
            Resume
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
