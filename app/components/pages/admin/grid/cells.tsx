/**
 * Editable cell primitives for the admin spreadsheet grids.
 *
 * Each cell renders its own <td> (so the Enter-to-next-row DOM traversal in
 * grid-nav counts columns correctly) holding a borderless control that looks
 * like a spreadsheet cell and shows an inset focus ring. Cells carry their own
 * optimistic local state via useCommittableValue, so a keystroke or toggle shows
 * instantly and the value re-seeds when the server value changes after a refetch,
 * rolling back if the write fails.
 *
 * Two commit modes share the text cells:
 *   - data rows (default): commit on blur or Enter (one PATCH per edited cell).
 *   - the add row (commitOnChange / onEnter): every change updates the draft
 *     immediately and Enter submits the new row, so creation never needs a blur.
 * The combobox, checkbox, and chips cells commit on change or on popover close.
 */

import { Check, Plus } from "lucide-react";
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";

import { Checkbox } from "@/components/ui/checkbox";
import { Combobox, type ComboboxOption } from "@/components/ui/combobox";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import { Input } from "@/components/ui/input";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { TableCell } from "@/components/ui/table";
import { cn } from "@/libraries/utils";

import { chipColorClass } from "./chips";
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
 * changes (a refetch after a save, or another tab), and de-duplicating commits so
 * an Enter (explicit commit) followed by the resulting blur does not fire two
 * writes. A failed write rolls the value back to the last known-good one.
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
  autoFocus?: boolean;
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
  autoFocus,
  className,
}: GridTextCellProps) {
  const cell = useCommittableValue(value, onCommit);

  return (
    <TableCell className="p-0">
      <Input
        aria-label={ariaLabel}
        // The add row is opened by an explicit user action, so focusing its first
        // field is expected (not a surprise focus steal on page load).
        autoFocus={autoFocus}
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

interface GridComboboxCellProps {
  value?: string;
  options: ComboboxOption[];
  onCommit: (value: string) => void | Promise<void>;
  ariaLabel: string;
  placeholder?: string;
}

/**
 * An enum cell backed by the searchable Combobox: type to filter the options and
 * pick one. The value may be unset (the add row starts blank), and picking
 * commits immediately.
 */
export function GridComboboxCell({
  value,
  options,
  onCommit,
  ariaLabel,
  placeholder = "Select...",
}: GridComboboxCellProps) {
  const cell = useCommittableValue<string | undefined>(value, (next) =>
    next === undefined ? undefined : onCommit(next),
  );

  return (
    <TableCell className="p-0">
      <Combobox
        ariaLabel={ariaLabel}
        onChange={(next) => {
          if (next !== undefined) cell.commitValue(next);
        }}
        options={options}
        placeholder={placeholder}
        triggerClassName="rounded-none"
        value={cell.value}
      />
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

interface GridChipsCellProps {
  value: string[];
  onCommit: (value: string[]) => void | Promise<void>;
  ariaLabel: string;
  /** Known options to suggest. For a closed set (circle) these are the only ones. */
  options: string[];
  /** Allow creating a new value from the search query (tags). */
  creatable?: boolean;
  placeholder?: string;
}

/**
 * A multi-select cell rendering its selection as colored chips. The popover is a
 * searchable list of toggleable options; with `creatable` (tags) a "Create" item
 * adds whatever you typed. Edits batch into one commit when the popover closes,
 * so toggling three values is a single PATCH.
 */
export function GridChipsCell({
  value,
  onCommit,
  ariaLabel,
  options,
  creatable = false,
  placeholder = "None",
}: GridChipsCellProps) {
  const cell = useCommittableValue<string[]>(value, onCommit, arraysEqual);
  const [query, setQuery] = useState("");

  const toggle = (item: string) =>
    cell.setValue(
      cell.value.includes(item)
        ? cell.value.filter((existing) => existing !== item)
        : [...cell.value, item],
    );

  // Suggestions: the known options plus any already-selected values not among
  // them (so existing tags always appear), de-duplicated case-insensitively.
  const allOptions = useMemo(() => {
    const seen = new Set<string>();
    const merged: string[] = [];
    for (const option of [...options, ...cell.value]) {
      const key = option.toLowerCase();
      if (!seen.has(key)) {
        seen.add(key);
        merged.push(option);
      }
    }
    return merged;
  }, [options, cell.value]);

  const trimmed = query.trim();
  const filtered = allOptions.filter((option) =>
    option.toLowerCase().includes(trimmed.toLowerCase()),
  );
  const canCreate =
    creatable &&
    trimmed !== "" &&
    !allOptions.some(
      (option) => option.toLowerCase() === trimmed.toLowerCase(),
    );

  return (
    <TableCell className="p-0">
      <Popover
        onOpenChange={(open) => {
          // Commit the batch of toggles when the popover closes.
          if (!open) {
            cell.commit();
            setQuery("");
          }
        }}
      >
        <PopoverTrigger asChild>
          <button
            aria-label={ariaLabel}
            // min-h (not fixed h) so the chips wrap onto more lines and the row
            // grows to show them all, rather than clipping a tag mid-word.
            className="flex min-h-9 w-full items-center px-3 py-1 text-left outline-none focus-visible:ring-1 focus-visible:ring-inset focus-visible:ring-ring"
            type="button"
          >
            {cell.value.length === 0 ? (
              <span className="text-sm text-ink/40">{placeholder}</span>
            ) : (
              <span className="flex flex-wrap items-center gap-1">
                {cell.value.map((item) => (
                  <span
                    className={cn(
                      "inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium",
                      chipColorClass(item),
                    )}
                    key={item}
                  >
                    {item}
                  </span>
                ))}
              </span>
            )}
          </button>
        </PopoverTrigger>
        <PopoverContent align="start" className="w-60 p-0">
          <Command shouldFilter={false}>
            <CommandInput
              onValueChange={setQuery}
              placeholder={creatable ? "Search or add..." : "Search..."}
              value={query}
            />
            <CommandList>
              {filtered.length === 0 && !canCreate ? (
                <CommandEmpty>No match.</CommandEmpty>
              ) : null}
              <CommandGroup>
                {filtered.map((option) => (
                  <CommandItem
                    key={option}
                    onSelect={() => toggle(option)}
                    value={option}
                  >
                    <Check
                      className={cn(
                        "size-4 shrink-0",
                        cell.value.includes(option)
                          ? "opacity-100"
                          : "opacity-0",
                      )}
                    />
                    <span
                      className={cn(
                        "inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium",
                        chipColorClass(option),
                      )}
                    >
                      {option}
                    </span>
                  </CommandItem>
                ))}
                {canCreate ? (
                  <CommandItem
                    onSelect={() => {
                      toggle(trimmed);
                      setQuery("");
                    }}
                    value={`__create__${trimmed}`}
                  >
                    <Plus className="size-4 shrink-0" />
                    Create &quot;{trimmed}&quot;
                  </CommandItem>
                ) : null}
              </CommandGroup>
            </CommandList>
          </Command>
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
