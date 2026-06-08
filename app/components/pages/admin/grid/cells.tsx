/**
 * Editable cell primitives for the admin spreadsheet grids.
 *
 * Each cell renders its own <td> (so the Enter-to-next-row DOM traversal in
 * grid-nav counts columns correctly) holding a borderless control that looks
 * like a spreadsheet cell and shows an inset focus ring. Cells carry their own
 * optimistic local state via useCommittableValue, so a keystroke or toggle shows
 * instantly and the value re-seeds when the server value changes after a refetch.
 *
 * Two commit modes share one set of components:
 *   - data rows (default): a text cell commits on blur or Enter (one PATCH per
 *     edited cell); selects, checkboxes, and the multi-select commit on change or
 *     on close.
 *   - the add row (commitOnChange / onEnter): every change updates the draft
 *     immediately and Enter submits the new row, so creation never needs a blur.
 */

import { ChevronDown } from "lucide-react";
import { useEffect, useRef, useState, type ReactNode } from "react";

import type { Option } from "@/components/pages/admin/parties/options";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { TableCell } from "@/components/ui/table";
import { cn } from "@/libraries/utils";

import { focusCellBelow } from "./grid-nav";

// Shared borderless look: fill the cell, drop the control's own border/shadow/
// radius, and show an inset focus ring so the focused cell reads as selected.
const GRID_CONTROL_CLASS =
  "h-9 w-full rounded-none border-0 bg-transparent px-3 shadow-none focus-visible:ring-1 focus-visible:ring-inset focus-visible:ring-ring";

function arraysEqual<T>(a: readonly T[], b: readonly T[]): boolean {
  return a.length === b.length && a.every((value, index) => value === b[index]);
}

/**
 * Holds a cell's optimistic local value, re-seeding it whenever the server value
 * changes (a refetch after a save, or another tab's edit), and de-duplicating
 * commits so an Enter (explicit commit) followed by the resulting blur does not
 * fire two writes. commit() writes only when the value actually changed since the
 * last commit; commitValue() is the immediate path the add row uses.
 */
function useCommittableValue<T>(
  serverValue: T,
  onCommit: (value: T) => void | Promise<void>,
  isEqual: (a: T, b: T) => boolean = Object.is,
) {
  const [value, setValue] = useState<T>(serverValue);
  // The de-dup baseline: the value the server is believed to hold. send() updates
  // it synchronously (so an Enter then the resulting blur don't double-write),
  // and the effect below re-syncs it to any external change (a refetch, the add
  // row clearing its draft, another tab). It is a ref, not state, so the
  // synchronous update works; the reset lives in an effect, not in render, both
  // to keep refs out of render and because skipping it would drop a re-toggle
  // back to a previously committed value as a phantom no-op.
  const committed = useRef<T>(serverValue);
  const [seen, setSeen] = useState<T>(serverValue);

  if (!isEqual(serverValue, seen)) {
    setSeen(serverValue);
    setValue(serverValue);
  }

  useEffect(() => {
    committed.current = serverValue;
  }, [serverValue]);

  // Send `next`, holding it optimistically. If the write rejects (the grid
  // surfaces the toast), roll the cell back to the last known-good value.
  const send = (next: T) => {
    if (isEqual(next, committed.current)) return;
    const previous = committed.current;
    committed.current = next;
    Promise.resolve(onCommit(next)).catch(() => {
      committed.current = previous;
      setValue(previous);
    });
  };

  const commit = () => send(value);

  const commitValue = (next: T) => {
    setValue(next);
    send(next);
  };

  const revert = () => {
    setValue(serverValue);
    committed.current = serverValue;
  };

  return { value, setValue, commit, commitValue, revert };
}

interface GridTextCellProps {
  value: string;
  onCommit: (value: string) => void | Promise<void>;
  ariaLabel: string;
  placeholder?: string;
  type?: "text" | "email";
  /** Add-row mode: commit every keystroke into the draft instead of on blur. */
  commitOnChange?: boolean;
  /** Overrides Enter: the add row passes its create handler here. */
  onEnter?: () => void;
  className?: string;
}

/** A text (or email) cell. Clearing it sends a blank value the API treats as "unset". */
export function GridTextCell({
  value,
  onCommit,
  ariaLabel,
  placeholder,
  type = "text",
  commitOnChange = false,
  onEnter,
  className,
}: GridTextCellProps) {
  const cell = useCommittableValue(value, onCommit);

  return (
    <TableCell className="p-0">
      <Input
        aria-label={ariaLabel}
        className={cn(GRID_CONTROL_CLASS, className)}
        onBlur={commitOnChange ? undefined : cell.commit}
        onChange={(e) =>
          commitOnChange
            ? cell.commitValue(e.target.value)
            : cell.setValue(e.target.value)
        }
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            e.preventDefault();
            if (onEnter) {
              onEnter();
            } else {
              cell.commit();
              focusCellBelow(e.currentTarget);
            }
          } else if (e.key === "Escape") {
            // Cancel the edit and keep the cell focused (like a spreadsheet).
            // Not blurring here is deliberate: a blur would fire a commit with
            // the not-yet-re-rendered value and undo the revert.
            cell.revert();
            e.currentTarget.select();
          }
        }}
        placeholder={placeholder}
        type={type}
        value={cell.value}
      />
    </TableCell>
  );
}

// roles is open-ended, so the cell edits a comma-separated list (like the dialog)
// and commits the parsed, trimmed, non-empty tags.
function parseRoles(text: string): string[] {
  return text
    .split(",")
    .map((role) => role.trim())
    .filter((role) => role.length > 0);
}

interface GridRolesCellProps {
  value: string[];
  onCommit: (roles: string[]) => void | Promise<void>;
  ariaLabel: string;
  placeholder?: string;
  commitOnChange?: boolean;
  onEnter?: () => void;
}

/** A comma-separated text cell that commits the parsed open-ended roles list. */
export function GridRolesCell({
  value,
  onCommit,
  ariaLabel,
  placeholder,
  commitOnChange = false,
  onEnter,
}: GridRolesCellProps) {
  // Drive the cell as text (the joined roles); commit parses back to an array.
  const cell = useCommittableValue(value.join(", "), (text) =>
    onCommit(parseRoles(text)),
  );

  return (
    <TableCell className="p-0">
      <Input
        aria-label={ariaLabel}
        className={GRID_CONTROL_CLASS}
        onBlur={commitOnChange ? undefined : cell.commit}
        onChange={(e) =>
          commitOnChange
            ? cell.commitValue(e.target.value)
            : cell.setValue(e.target.value)
        }
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            e.preventDefault();
            if (onEnter) {
              onEnter();
            } else {
              cell.commit();
              focusCellBelow(e.currentTarget);
            }
          } else if (e.key === "Escape") {
            // Cancel the edit and keep the cell focused (like a spreadsheet).
            // Not blurring here is deliberate: a blur would fire a commit with
            // the not-yet-re-rendered value and undo the revert.
            cell.revert();
            e.currentTarget.select();
          }
        }}
        placeholder={placeholder}
        value={cell.value}
      />
    </TableCell>
  );
}

interface GridEnumCellProps<T extends string> {
  value: T;
  options: Option<T>[];
  onCommit: (value: T) => void | Promise<void>;
  ariaLabel: string;
}

/** An enum cell backed by the shared Select; commits the chosen value immediately. */
export function GridEnumCell<T extends string>({
  value,
  options,
  onCommit,
  ariaLabel,
}: GridEnumCellProps<T>) {
  const cell = useCommittableValue<T>(value, onCommit);

  return (
    <TableCell className="p-0">
      <Select
        onValueChange={(next) => cell.commitValue(next as T)}
        value={cell.value}
      >
        <SelectTrigger aria-label={ariaLabel} className={GRID_CONTROL_CLASS}>
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {options.map((option) => (
            <SelectItem key={option.value} value={option.value}>
              {option.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </TableCell>
  );
}

interface GridBoolCellProps {
  value: boolean;
  onCommit: (value: boolean) => void | Promise<void>;
  ariaLabel: string;
}

/** A checkbox cell. Space toggles (native); Enter moves to the next row. */
export function GridBoolCell({
  value,
  onCommit,
  ariaLabel,
}: GridBoolCellProps) {
  const cell = useCommittableValue<boolean>(value, onCommit);

  return (
    <TableCell className="p-0">
      <div className="flex h-9 items-center justify-center">
        <Checkbox
          aria-label={ariaLabel}
          checked={cell.value}
          onCheckedChange={(checked) => cell.commitValue(checked === true)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              focusCellBelow(e.currentTarget);
            }
          }}
        />
      </div>
    </TableCell>
  );
}

interface GridMultiSelectCellProps<T extends string> {
  value: T[];
  options: Option<T>[];
  onCommit: (value: T[]) => void | Promise<void>;
  ariaLabel: string;
  placeholder?: string;
}

/**
 * A multi-select cell (the party circle): a trigger summarizing the selected
 * options that opens a checkbox list. Edits batch into one commit when the popover
 * closes, so toggling three circles is a single PATCH.
 */
export function GridMultiSelectCell<T extends string>({
  value,
  options,
  onCommit,
  ariaLabel,
  placeholder = "None",
}: GridMultiSelectCellProps<T>) {
  const cell = useCommittableValue<T[]>(value, onCommit, arraysEqual);

  const toggle = (option: T, checked: boolean) =>
    cell.setValue(
      checked
        ? [...cell.value, option]
        : cell.value.filter((item) => item !== option),
    );

  const summary =
    cell.value.length > 0
      ? options
          .filter((option) => cell.value.includes(option.value))
          .map((option) => option.label)
          .join(", ")
      : placeholder;

  return (
    <TableCell className="p-0">
      <Popover
        onOpenChange={(open) => {
          // Commit the batch of toggles when the popover closes.
          if (!open) cell.commit();
        }}
      >
        <PopoverTrigger asChild>
          <button
            aria-label={ariaLabel}
            className={cn(
              "flex h-9 w-full cursor-pointer items-center justify-between gap-1 whitespace-nowrap bg-transparent px-3 text-left text-sm outline-none focus-visible:ring-1 focus-visible:ring-inset focus-visible:ring-ring",
              cell.value.length === 0 && "text-ink/40",
            )}
            type="button"
          >
            <span className="truncate">{summary}</span>
            <ChevronDown className="size-4 shrink-0 opacity-50" />
          </button>
        </PopoverTrigger>
        <PopoverContent align="start" className="w-56 p-2">
          <div className="space-y-0.5">
            {options.map((option) => (
              <label
                className="flex cursor-pointer items-center gap-2 rounded px-1.5 py-1 text-sm hover:bg-accent"
                key={option.value}
              >
                <Checkbox
                  checked={cell.value.includes(option.value)}
                  onCheckedChange={(checked) =>
                    toggle(option.value, checked === true)
                  }
                />
                {option.label}
              </label>
            ))}
          </div>
        </PopoverContent>
      </Popover>
    </TableCell>
  );
}

/** A non-editable cell (derived status, counts, the party-name link, row actions). */
export function GridReadOnlyCell({
  children,
  className,
}: {
  children?: ReactNode;
  className?: string;
}) {
  return <TableCell className={className}>{children}</TableCell>;
}
