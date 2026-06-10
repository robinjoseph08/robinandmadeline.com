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

import { Check, ChevronsUpDown, Plus } from "lucide-react";
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";

import { Combobox, type ComboboxOption } from "@/components/library/Combobox";
import { Checkbox } from "@/components/ui/checkbox";
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
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { cn } from "@/libraries/utils";

import { chipColorClass } from "./chips";
import { InfoHint } from "./grid-buttons";
import { focusCellBelow } from "./grid-nav";

// Shared borderless look: drop the control's own border/shadow/radius and show
// an inset focus ring so the focused cell reads as selected. Width is auto plus
// min-w-full so a text field's `size` can grow its column to fit the longest
// value (table-layout:auto reads the intrinsic width), while a short or empty
// field still fills the resolved column width so the whole cell stays clickable.
const GRID_CONTROL_CLASS =
  "h-8 w-auto min-w-full rounded-none border-0 bg-transparent px-3 shadow-none focus-visible:ring-1 focus-visible:ring-inset focus-visible:ring-ring";

// The save lifecycle of a single cell edit, surfaced as a brief background tint
// so you can see a change land: amber while the write is in flight, green on
// success, red on a failed write that rolled back.
type CellStatus = "idle" | "saving" | "saved" | "error";

function statusBgClass(status: CellStatus, show: boolean): string {
  if (!show) return "";
  switch (status) {
    case "saving":
      return "bg-amber-100/60";
    case "saved":
      return "bg-emerald-100/70";
    case "error":
      return "bg-destructive/10";
    default:
      return "";
  }
}

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

  // Re-sync the baseline only on a value-level change. Parents may pass a fresh
  // but equal object every render (the flags cell builds its value inline), and
  // re-syncing on reference alone would reset the baseline mid-flight, so a
  // quick toggle back to the old value would de-dup as a phantom no-op.
  const lastServer = useRef<T>(serverValue);
  useEffect(() => {
    if (isEqual(serverValue, lastServer.current)) return;
    lastServer.current = serverValue;
    committed.current = serverValue;
  }, [serverValue, isEqual]);

  const [status, setStatus] = useState<CellStatus>("idle");

  // Clear the transient "saved"/"error" tint after a moment so it reads as a
  // flash, not a stuck state. "saving" persists until the write settles.
  useEffect(() => {
    if (status !== "saved" && status !== "error") return;
    const timer = setTimeout(
      () => setStatus("idle"),
      status === "saved" ? 1400 : 3000,
    );
    return () => clearTimeout(timer);
  }, [status]);

  // Identifies the latest send, so a superseded write that settles late cannot
  // override the newer one's outcome.
  const sendSeq = useRef(0);

  // Send `next`, holding it optimistically and tracking the save status. If the
  // write rejects (the grid surfaces the toast), roll the cell back to the last
  // known-good value. Only the latest send may roll back or change the status:
  // a stale rejection arriving after a newer send would otherwise restore a
  // value older than what the server now holds.
  const send = (next: T) => {
    if (isEqual(next, committed.current)) return;
    const previous = committed.current;
    committed.current = next;
    const sendId = ++sendSeq.current;
    setStatus("saving");
    Promise.resolve(onCommit(next)).then(
      () => {
        if (sendId === sendSeq.current) setStatus("saved");
      },
      () => {
        if (sendId !== sendSeq.current) return;
        committed.current = previous;
        setValue(previous);
        setStatus("error");
      },
    );
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

  return { value, setValue, commit, commitValue, revert, status };
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
  /**
   * Add-row only: Escape handler. The add row wires this to exit add mode when
   * the row is still empty. Data cells ignore it and revert in place instead.
   */
  onEscape?: () => void;
  autoFocus?: boolean;
  className?: string;
  /** Normalize each typed value (e.g. force upper-case for RSVP codes). */
  transform?: (value: string) => string;
  /** Show the save-status tint (off for add-row draft cells, which do not save). */
  showStatus?: boolean;
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
  onEscape,
  autoFocus,
  className,
  transform,
  showStatus = true,
}: GridTextCellProps) {
  const cell = useCommittableValue(value, onCommit);

  // Drive the field's intrinsic width off the live (possibly uncommitted) value
  // so the column grows while you type, not only after a refetch (see
  // GRID_CONTROL_CLASS). The lower bound keeps an empty cell from collapsing
  // under its placeholder; the upper bound stops a freak long value from blowing
  // the column out (it scrolls within the field instead).
  const fieldSize = Math.min(
    Math.max(cell.value.length, placeholder?.length ?? 0, 2),
    40,
  );

  return (
    <TableCell
      className={cn(
        "p-0 transition-colors",
        statusBgClass(cell.status, showStatus),
      )}
    >
      <Input
        aria-label={ariaLabel}
        // The add row is opened by an explicit user action, so focusing its first
        // field is expected (not a surprise focus steal on page load).
        autoFocus={autoFocus}
        className={cn(GRID_CONTROL_CLASS, className)}
        onBlur={commitOnChange ? undefined : cell.commit}
        onChange={(e) => {
          const next = transform ? transform(e.target.value) : e.target.value;
          if (commitOnChange) {
            cell.commitValue(next);
          } else {
            cell.setValue(next);
          }
        }}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            e.preventDefault();
            // A held key auto-repeats Enter; one press means one commit (or
            // one create via onEnter), not a burst.
            if (e.repeat) return;
            if (onEnter) {
              onEnter();
            } else {
              cell.commit();
              focusCellBelow(e.currentTarget);
            }
          } else if (e.key === "Escape") {
            if (commitOnChange) {
              // Add row: nothing to revert (every keystroke is already in the
              // draft), so hand Escape to the parent, which exits add mode while
              // the row is still empty. A text cell can never have a dropdown
              // open at the same time, so this never competes with a popover's
              // own Escape-to-close.
              onEscape?.();
            } else {
              // Data rows: cancel the edit and keep the cell focused (like a
              // spreadsheet). Not blurring here is deliberate: a blur would fire a
              // commit with the not-yet-re-rendered value and undo the revert.
              cell.revert();
              e.currentTarget.select();
            }
          }
        }}
        placeholder={placeholder}
        size={fieldSize}
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
  /** Show the save-status tint (off for add-row draft cells, which do not save). */
  showStatus?: boolean;
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
  showStatus = true,
}: GridComboboxCellProps) {
  const cell = useCommittableValue<string | undefined>(value, (next) =>
    next === undefined ? undefined : onCommit(next),
  );

  return (
    <TableCell
      className={cn(
        "p-0 transition-colors",
        statusBgClass(cell.status, showStatus),
      )}
    >
      <Combobox
        ariaLabel={ariaLabel}
        onChange={(next) => {
          if (next !== undefined) cell.commitValue(next);
        }}
        options={options}
        placeholder={placeholder}
        triggerClassName="h-8 rounded-none"
        value={cell.value}
      />
    </TableCell>
  );
}

interface GridBoolCellProps {
  value: boolean;
  onCommit: (value: boolean) => void | Promise<void>;
  ariaLabel: string;
  /**
   * Render the checkbox non-interactive. The guest grid uses this on the current
   * primary so it cannot be unchecked (which would leave the party with none);
   * promoting another guest is how you move it.
   */
  disabled?: boolean;
  /** Explains why the box is set (e.g. a new party's forced-primary first guest). */
  tooltip?: string;
  /** Show the save-status tint (off for add-row draft cells, which do not save). */
  showStatus?: boolean;
}

/** A checkbox cell. Space toggles (native); Enter moves to the next row. */
export function GridBoolCell({
  value,
  onCommit,
  ariaLabel,
  disabled,
  tooltip,
  showStatus = true,
}: GridBoolCellProps) {
  const cell = useCommittableValue<boolean>(value, onCommit);

  const checkbox = (
    <Checkbox
      aria-label={ariaLabel}
      checked={cell.value}
      className={disabled ? undefined : "cursor-pointer"}
      disabled={disabled}
      onCheckedChange={(checked) => cell.commitValue(checked === true)}
      onKeyDown={(e) => {
        if (e.key === "Enter") {
          e.preventDefault();
          focusCellBelow(e.currentTarget);
        }
      }}
    />
  );

  return (
    <TableCell
      className={cn(
        "p-0 transition-colors",
        statusBgClass(cell.status, showStatus),
      )}
    >
      <div className="flex h-8 items-center justify-center">
        {tooltip ? (
          <Tooltip>
            {/* A disabled checkbox emits no pointer events, so wrap it in a
                focusable span so the tooltip still triggers on hover. The span
                is opted out of Enter-to-next-row traversal (data-grid-nav-skip):
                it is focusable for the tooltip, not an editable control. */}
            <TooltipTrigger asChild>
              <span className="inline-flex" data-grid-nav-skip tabIndex={0}>
                {checkbox}
              </span>
            </TooltipTrigger>
            <TooltipContent>{tooltip}</TooltipContent>
          </Tooltip>
        ) : (
          checkbox
        )}
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
  /** Show the save-status tint (off for add-row draft cells, which do not save). */
  showStatus?: boolean;
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
  showStatus = true,
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
  // them (so already-selected values always appear), de-duplicated case-insensitively.
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
    <TableCell
      className={cn(
        "p-0 transition-colors",
        statusBgClass(cell.status, showStatus),
      )}
    >
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
            // Fixed height + nowrap keeps rows uniformly compact; chips clip on
            // overflow, and the full set is shown in the popover.
            className="flex h-8 w-full cursor-pointer items-center overflow-hidden px-3 text-left outline-none focus-visible:ring-1 focus-visible:ring-inset focus-visible:ring-ring"
            type="button"
          >
            {cell.value.length === 0 ? (
              <span className="text-sm text-ink/40">{placeholder}</span>
            ) : (
              <span className="flex items-center gap-1">
                {cell.value.map((item) => (
                  <span
                    className={cn(
                      "inline-flex shrink-0 items-center whitespace-nowrap rounded-full px-2 py-0.5 text-xs font-medium",
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
                        "inline-flex shrink-0 items-center whitespace-nowrap rounded-full px-2 py-0.5 text-xs font-medium",
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

export interface FlagOption {
  /** The boolean field this chip toggles (e.g. "is_child"). */
  key: string;
  label: string;
  /** Tooltip text shown on the option's info icon. */
  hint: string;
}

interface GridFlagsCellProps {
  options: FlagOption[];
  value: Record<string, boolean>;
  onCommit: (value: Record<string, boolean>) => void | Promise<void>;
  ariaLabel: string;
  placeholder?: string;
  /** Show the save-status tint (off for add-row draft cells, which do not save). */
  showStatus?: boolean;
}

/**
 * A multi-select cell for a small fixed set of boolean flags (a guest's
 * child/drinking/placeholder), rendered as colored chips. The popover lists each
 * flag with a toggle and an info tooltip explaining it; toggles batch into one
 * commit when the popover closes. Collapsing several checkbox columns into a
 * single chip cell keeps each row compact.
 */
export function GridFlagsCell({
  options,
  value,
  onCommit,
  ariaLabel,
  placeholder = "None",
  showStatus = true,
}: GridFlagsCellProps) {
  const flagsEqual = (a: Record<string, boolean>, b: Record<string, boolean>) =>
    options.every(
      (option) => Boolean(a[option.key]) === Boolean(b[option.key]),
    );
  const cell = useCommittableValue<Record<string, boolean>>(
    value,
    onCommit,
    flagsEqual,
  );

  const toggle = (key: string) =>
    cell.setValue({ ...cell.value, [key]: !cell.value[key] });

  const selected = options.filter((option) => cell.value[option.key]);

  return (
    <TableCell
      className={cn(
        "p-0 transition-colors",
        statusBgClass(cell.status, showStatus),
      )}
    >
      <Popover
        onOpenChange={(open) => {
          // Commit the batch of toggles when the popover closes.
          if (!open) cell.commit();
        }}
      >
        <PopoverTrigger asChild>
          <button
            aria-label={ariaLabel}
            className="flex h-8 w-full cursor-pointer items-center overflow-hidden px-3 text-left outline-none focus-visible:ring-1 focus-visible:ring-inset focus-visible:ring-ring"
            type="button"
          >
            {selected.length === 0 ? (
              <span className="text-sm text-ink/40">{placeholder}</span>
            ) : (
              <span className="flex items-center gap-1">
                {selected.map((option) => (
                  <span
                    className={cn(
                      "inline-flex shrink-0 items-center whitespace-nowrap rounded-full px-2 py-0.5 text-xs font-medium",
                      chipColorClass(option.label),
                    )}
                    key={option.key}
                  >
                    {option.label}
                  </span>
                ))}
              </span>
            )}
          </button>
        </PopoverTrigger>
        <PopoverContent
          align="start"
          className="w-60 p-0"
          // Without a CommandInput to receive it, the popover's open-focus would
          // land on the first row's info icon, whose tooltip then springs open
          // (and lingers) every time the cell is opened. Keep focus on the
          // trigger so the flag tooltips only show on an actual hover of the icon.
          onOpenAutoFocus={(e) => e.preventDefault()}
        >
          <Command>
            <CommandList>
              <CommandGroup>
                {options.map((option) => (
                  <CommandItem
                    key={option.key}
                    onSelect={() => toggle(option.key)}
                    value={option.label}
                  >
                    <Check
                      className={cn(
                        "size-4 shrink-0",
                        cell.value[option.key] ? "opacity-100" : "opacity-0",
                      )}
                    />
                    <span
                      className={cn(
                        "inline-flex shrink-0 items-center whitespace-nowrap rounded-full px-2 py-0.5 text-xs font-medium",
                        chipColorClass(option.label),
                      )}
                    >
                      {option.label}
                    </span>
                    {/* Stop the info icon from toggling the flag; it only shows
                        the tooltip on hover. */}
                    <span
                      className="ml-auto"
                      onClick={(e) => e.stopPropagation()}
                      onPointerDown={(e) => e.stopPropagation()}
                    >
                      <InfoHint text={option.hint} />
                    </span>
                  </CommandItem>
                ))}
              </CommandGroup>
            </CommandList>
          </Command>
        </PopoverContent>
      </Popover>
    </TableCell>
  );
}

interface GridCreatablePartyCellProps {
  parties: { id: string; name: string }[];
  partyId?: string;
  newPartyName?: string;
  onSelectExisting: (id: string) => void;
  onCreateNew: (name: string) => void;
}

/**
 * The add row's party picker: a single-select combobox over existing parties
 * that is also creatable. Selecting a party assigns the new guest to it; typing a
 * new name and choosing "Create" starts a brand-new party (whose side/relation
 * cells then become editable in the add row). Used only in the flat guest list.
 */
export function GridCreatablePartyCell({
  parties,
  partyId,
  newPartyName,
  onSelectExisting,
  onCreateNew,
}: GridCreatablePartyCellProps) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const selectedName =
    newPartyName ?? parties.find((party) => party.id === partyId)?.name;

  const trimmed = query.trim();
  const filtered = parties.filter((party) =>
    party.name.toLowerCase().includes(trimmed.toLowerCase()),
  );
  const canCreate =
    trimmed !== "" &&
    !parties.some(
      (party) => party.name.toLowerCase() === trimmed.toLowerCase(),
    );

  return (
    <TableCell className="p-0">
      <Popover
        onOpenChange={(next) => {
          setOpen(next);
          if (!next) setQuery("");
        }}
        open={open}
      >
        <PopoverTrigger asChild>
          <button
            aria-label="New guest party"
            className={cn(
              "flex h-8 w-full cursor-pointer items-center justify-between gap-1 px-3 text-left text-sm outline-none focus-visible:ring-1 focus-visible:ring-inset focus-visible:ring-ring",
              !selectedName && "text-ink/40",
            )}
            role="combobox"
            type="button"
          >
            <span className="truncate">{selectedName ?? "Party..."}</span>
            <ChevronsUpDown className="size-4 shrink-0 opacity-50" />
          </button>
        </PopoverTrigger>
        <PopoverContent align="start" className="w-60 p-0">
          <Command shouldFilter={false}>
            <CommandInput
              onValueChange={setQuery}
              placeholder="Search or add..."
              value={query}
            />
            <CommandList>
              {filtered.length === 0 && !canCreate ? (
                <CommandEmpty>No match.</CommandEmpty>
              ) : null}
              <CommandGroup>
                {filtered.map((party) => (
                  <CommandItem
                    key={party.id}
                    onSelect={() => {
                      onSelectExisting(party.id);
                      setOpen(false);
                      setQuery("");
                    }}
                    value={party.name}
                  >
                    <Check
                      className={cn(
                        "size-4 shrink-0",
                        partyId === party.id ? "opacity-100" : "opacity-0",
                      )}
                    />
                    {party.name}
                  </CommandItem>
                ))}
                {canCreate ? (
                  <CommandItem
                    onSelect={() => {
                      onCreateNew(trimmed);
                      setOpen(false);
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
