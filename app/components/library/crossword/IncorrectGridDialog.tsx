import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

interface IncorrectGridDialogProps {
  onCloseAutoFocus: (event: Event) => void;
  onOpenChange: (open: boolean) => void;
  open: boolean;
}

/**
 * Interrupts the solve only when an incorrect grid first becomes full. The
 * page owns the transition latch and timer pause so this component stays a
 * simple controlled dialog.
 */
export default function IncorrectGridDialog({
  onCloseAutoFocus,
  onOpenChange,
  open,
}: IncorrectGridDialogProps) {
  return (
    <Dialog onOpenChange={onOpenChange} open={open}>
      <DialogContent
        data-testid="crossword-incorrect-dialog"
        onCloseAutoFocus={onCloseAutoFocus}
      >
        <DialogHeader>
          <DialogTitle>Not quite yet</DialogTitle>
          <DialogDescription>
            The grid is full, but something is not quite right. Check your
            letters and keep tweaking.
          </DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button onClick={() => onOpenChange(false)} type="button">
            Keep trying
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
