import { Check, ChevronsUpDown, X } from "lucide-react";
import { useState } from "react";

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

export interface ComboboxOption {
  value: string;
  label: string;
}

interface ComboboxProps {
  options: ComboboxOption[];
  value?: string;
  onChange: (value: string | undefined) => void;
  placeholder?: string;
  searchPlaceholder?: string;
  emptyText?: string;
  ariaLabel: string;
  /** When set, a "clear" affordance resets the value to undefined (filters). */
  clearable?: boolean;
  triggerClassName?: string;
  contentClassName?: string;
  align?: "start" | "center" | "end";
}

/**
 * A single-select combobox (Popover + cmdk Command): the trigger shows the
 * selected option or a placeholder, and the dropdown is a searchable list, so you
 * can type to filter and pick the right option. Used for the grid's enum cells
 * (borderless) and the list filters (bordered, clearable).
 *
 * The clear affordance is a real sibling button overlaid on the trigger's icon
 * slot (an interactive element nested inside the trigger button would be invalid
 * HTML and unreachable by keyboard); Backspace or Delete on the trigger clears
 * the selection too.
 */
export function Combobox({
  options,
  value,
  onChange,
  placeholder = "Select...",
  searchPlaceholder = "Search...",
  emptyText = "No match.",
  ariaLabel,
  clearable = false,
  triggerClassName,
  contentClassName,
  align = "start",
}: ComboboxProps) {
  const [open, setOpen] = useState(false);
  const selected = options.find((option) => option.value === value);
  const showClear = clearable && selected !== undefined;

  const trigger = (
    <PopoverTrigger asChild>
      <button
        aria-label={ariaLabel}
        className={cn(
          "flex h-9 w-full cursor-pointer items-center justify-between gap-1 whitespace-nowrap px-3 text-left text-sm outline-none focus-visible:ring-1 focus-visible:ring-inset focus-visible:ring-ring",
          !selected && "text-ink/40",
          triggerClassName,
        )}
        onKeyDown={(e) => {
          if (showClear && (e.key === "Backspace" || e.key === "Delete")) {
            e.preventDefault();
            onChange(undefined);
          }
        }}
        role="combobox"
        type="button"
      >
        <span className="truncate">
          {selected ? selected.label : placeholder}
        </span>
        {showClear ? (
          // Reserve the icon slot the overlaid clear button occupies, so the
          // label truncates exactly as it would against the chevron.
          <span aria-hidden="true" className="size-4 shrink-0" />
        ) : (
          <ChevronsUpDown className="size-4 shrink-0 opacity-50" />
        )}
      </button>
    </PopoverTrigger>
  );

  return (
    <Popover onOpenChange={setOpen} open={open}>
      {clearable ? (
        // w-fit shrink-wraps the trigger (the clearable filters give it a fixed
        // width), keeping the overlaid clear button anchored to its right edge.
        <div className="relative w-fit">
          {trigger}
          {showClear ? (
            <button
              aria-label={`Clear ${ariaLabel}`}
              className="absolute right-3 top-1/2 -translate-y-1/2 cursor-pointer rounded-sm opacity-50 outline-none hover:opacity-100 focus-visible:opacity-100 focus-visible:ring-1 focus-visible:ring-ring"
              onClick={() => onChange(undefined)}
              type="button"
            >
              <X className="size-4" />
            </button>
          ) : null}
        </div>
      ) : (
        trigger
      )}
      <PopoverContent
        align={align}
        className={cn("w-48 p-0", contentClassName)}
      >
        <Command>
          <CommandInput placeholder={searchPlaceholder} />
          <CommandList>
            <CommandEmpty>{emptyText}</CommandEmpty>
            <CommandGroup>
              {options.map((option) => (
                <CommandItem
                  key={option.value}
                  onSelect={() => {
                    onChange(option.value);
                    setOpen(false);
                  }}
                  value={option.label}
                >
                  <Check
                    className={cn(
                      "size-4",
                      value === option.value ? "opacity-100" : "opacity-0",
                    )}
                  />
                  {option.label}
                </CommandItem>
              ))}
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}
