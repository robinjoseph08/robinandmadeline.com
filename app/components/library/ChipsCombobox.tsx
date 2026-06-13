import { Check, ChevronsUpDown, X } from "lucide-react";
import { useMemo, useState } from "react";

import { chipColorClass } from "@/components/pages/admin/grid/chips";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { cn } from "@/libraries/utils";

interface ChipsComboboxProps {
  /** The selected values, rendered as colored chips. */
  value: string[];
  onChange: (value: string[]) => void;
  /** Known options to toggle. This combobox is non-creatable: only these (plus
   * any already-selected values) appear. */
  options: string[];
  ariaLabel: string;
  /** Shown on the trigger when nothing is selected. */
  placeholder?: string;
  triggerClassName?: string;
}

/**
 * A reusable multi-select chips combobox for filter bars: the trigger shows the
 * selected values as colored chips (via the grid's shared chipColorClass) and a
 * clear affordance, and the dropdown is a searchable list of toggleable options.
 * Modeled on the grid's GridChipsCell popover but standalone (no TableCell, no
 * save-status) and non-creatable, since a filter only narrows by values that
 * exist. Use it wherever a single FilterSelect is too narrow because a guest can
 * match ANY of several values (the tag filter, with OR semantics on the API).
 */
export function ChipsCombobox({
  value,
  onChange,
  options,
  ariaLabel,
  placeholder = "Any",
  triggerClassName,
}: ChipsComboboxProps) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");

  const toggle = (item: string) =>
    onChange(
      value.includes(item)
        ? value.filter((existing) => existing !== item)
        : [...value, item],
    );

  // Suggestions: the known options plus any already-selected values not among
  // them (so a selected value is always listed and untoggleable), de-duplicated
  // case-insensitively, the selected casing winning a collision (so its
  // checkmark matches).
  const allOptions = useMemo(() => {
    const selectedByKey = new Map(
      value.map((item) => [item.toLowerCase(), item]),
    );
    const seen = new Set<string>();
    const merged: string[] = [];
    for (const option of [...options, ...value]) {
      const key = option.toLowerCase();
      if (!seen.has(key)) {
        seen.add(key);
        merged.push(selectedByKey.get(key) ?? option);
      }
    }
    return merged;
  }, [options, value]);

  const trimmed = query.trim();
  const filtered = allOptions.filter((option) =>
    option.toLowerCase().includes(trimmed.toLowerCase()),
  );

  return (
    <Popover
      onOpenChange={(next) => {
        setOpen(next);
        if (!next) setQuery("");
      }}
      open={open}
    >
      <PopoverTrigger asChild>
        <button
          aria-label={ariaLabel}
          className={cn(
            "flex min-h-9 w-40 cursor-pointer items-center justify-between gap-1 rounded-md border border-input bg-transparent px-3 py-1 text-left text-sm shadow-sm outline-none focus-visible:ring-1 focus-visible:ring-ring",
            triggerClassName,
          )}
          role="combobox"
          type="button"
        >
          {value.length === 0 ? (
            <span className="text-ink/40">{placeholder}</span>
          ) : (
            <span className="flex flex-wrap items-center gap-1">
              {value.map((item) => (
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
          {value.length > 0 ? (
            // A real sibling element (not a nested button, which would be
            // invalid inside the trigger button) that clears the whole
            // selection; it stops propagation so it does not also open the
            // popover.
            <span
              aria-label={`Clear ${ariaLabel}`}
              className="ml-auto shrink-0 rounded-full opacity-50 hover:opacity-100"
              onClick={(e) => {
                e.stopPropagation();
                onChange([]);
              }}
              onPointerDown={(e) => e.stopPropagation()}
              role="button"
              tabIndex={-1}
            >
              <X className="size-4" />
            </span>
          ) : (
            <ChevronsUpDown className="ml-auto size-4 shrink-0 opacity-50" />
          )}
        </button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-60 p-0">
        <Command shouldFilter={false}>
          <CommandInput
            onValueChange={setQuery}
            placeholder="Search..."
            value={query}
          />
          <CommandList>
            {filtered.length === 0 ? (
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
                      value.includes(option) ? "opacity-100" : "opacity-0",
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
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}
