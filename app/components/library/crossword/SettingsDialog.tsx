// The gear-menu settings dialog, NYT-crossword style. Every change applies
// immediately and persists through the page's settings state (one global
// localStorage key, settings.ts). Opening it pauses the solve clock; the
// page wires that through useSolveSession.setUiPaused.

import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogBody,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";

import { CrosswordSettings } from "./settings";

interface SettingsDialogProps {
  /**
   * Radix close-focus hook: the page uses it to put focus back in the grid
   * so the guest can keep typing right after closing the dialog.
   */
  onCloseAutoFocus: (event: Event) => void;
  onOpenChange: (open: boolean) => void;
  onSettingsChange: (patch: Partial<CrosswordSettings>) => void;
  open: boolean;
  settings: CrosswordSettings;
}

export default function SettingsDialog({
  onCloseAutoFocus,
  onOpenChange,
  onSettingsChange,
  open,
  settings,
}: SettingsDialogProps) {
  return (
    <Dialog onOpenChange={onOpenChange} open={open}>
      <DialogContent
        data-testid="crossword-settings-dialog"
        onCloseAutoFocus={onCloseAutoFocus}
      >
        <DialogHeader>
          <DialogTitle>Settings</DialogTitle>
          <DialogDescription>
            Changes apply right away and stick for every puzzle. The timer
            pauses while this is open.
          </DialogDescription>
        </DialogHeader>
        <DialogBody className="space-y-5 py-4">
          <CheckboxRow
            checked={settings.showTimer}
            id="setting-show-timer"
            label="Show the timer while solving"
            onChange={(showTimer) => onSettingsChange({ showTimer })}
          />
          <CheckboxRow
            checked={settings.skipFilledSquares}
            id="setting-skip-filled"
            label="Skip over filled squares"
            onChange={(skipFilledSquares) =>
              onSettingsChange({ skipFilledSquares })
            }
          />
          <CheckboxRow
            checked={settings.backspaceIntoPreviousWord}
            id="setting-backspace-previous"
            label="Backspace can move into the previous word"
            onChange={(backspaceIntoPreviousWord) =>
              onSettingsChange({ backspaceIntoPreviousWord })
            }
          />
          <CheckboxRow
            checked={settings.jumpBackToFirstBlank}
            id="setting-jump-back"
            label="At the end of a word, jump back to its first blank square"
            onChange={(jumpBackToFirstBlank) =>
              onSettingsChange({ jumpBackToFirstBlank })
            }
          />
          <CheckboxRow
            checked={settings.jumpToNextClue}
            id="setting-jump-next"
            label="Jump to the next clue after finishing a word"
            onChange={(jumpToNextClue) => onSettingsChange({ jumpToNextClue })}
          />
          <ChoiceRow
            label="Space bar"
            onChange={(spacebarBehavior) =>
              onSettingsChange({ spacebarBehavior })
            }
            options={[
              { label: "Toggles across and down", value: "toggle" },
              { label: "Clears the square and moves on", value: "clear" },
            ]}
            value={settings.spacebarBehavior}
          />
          <ChoiceRow
            label="After changing direction with the arrow keys"
            onChange={(arrowKeyAfterDirectionChange) =>
              onSettingsChange({ arrowKeyAfterDirectionChange })
            }
            options={[
              { label: "Stay in the same square", value: "stay" },
              { label: "Move in the arrow's direction", value: "move" },
            ]}
            value={settings.arrowKeyAfterDirectionChange}
          />
        </DialogBody>
      </DialogContent>
    </Dialog>
  );
}

interface CheckboxRowProps {
  checked: boolean;
  id: string;
  label: string;
  onChange: (checked: boolean) => void;
}

function CheckboxRow({ checked, id, label, onChange }: CheckboxRowProps) {
  return (
    <div className="flex items-start gap-2">
      <Checkbox
        checked={checked}
        id={id}
        onCheckedChange={(value) => onChange(value === true)}
      />
      <Label className="leading-snug" htmlFor={id}>
        {label}
      </Label>
    </div>
  );
}

interface ChoiceRowProps<T extends string> {
  label: string;
  onChange: (value: T) => void;
  options: { label: string; value: T }[];
  value: T;
}

function ChoiceRow<T extends string>({
  label,
  onChange,
  options,
  value,
}: ChoiceRowProps<T>) {
  return (
    <fieldset>
      <legend className="text-sm font-medium leading-none">{label}</legend>
      <div className="mt-2 flex flex-wrap gap-2">
        {options.map((option) => (
          <Button
            aria-pressed={option.value === value}
            key={option.value}
            onClick={() => onChange(option.value)}
            size="sm"
            type="button"
            variant={option.value === value ? "default" : "outline"}
          >
            {option.label}
          </Button>
        ))}
      </div>
    </fieldset>
  );
}
