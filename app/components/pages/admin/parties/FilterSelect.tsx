import { Combobox } from "@/components/ui/combobox";

import type { Option } from "./options";

interface FilterSelectProps<T extends string> {
  label: string;
  value: T | undefined;
  options: Option<T>[];
  onChange: (value: T | undefined) => void;
  /** Label shown when nothing is selected (the no-filter state). */
  allLabel?: string;
}

/**
 * A labeled enum filter built on the searchable Combobox: type to filter the
 * options, pick one, or clear it back to "no filter" (the X affordance). Used
 * across the parties and guests list filter bars.
 */
export function FilterSelect<T extends string>({
  label,
  value,
  options,
  onChange,
  allLabel = "All",
}: FilterSelectProps<T>) {
  return (
    <div className="flex flex-col gap-1 text-sm">
      <span className="font-medium">{label}</span>
      <Combobox
        ariaLabel={label}
        clearable
        onChange={(next) => onChange(next as T | undefined)}
        options={options}
        placeholder={allLabel}
        triggerClassName="w-40 rounded-md border border-input bg-transparent shadow-sm"
        value={value}
      />
    </div>
  );
}

// A tri-state boolean filter (Any / Yes / No) backed by the same select shell.
const BOOL_OPTIONS: Option<"true" | "false">[] = [
  { value: "true", label: "Yes" },
  { value: "false", label: "No" },
];

interface BoolFilterSelectProps {
  label: string;
  value: boolean | undefined;
  onChange: (value: boolean | undefined) => void;
}

/** A labeled Any/Yes/No dropdown for the boolean guest and party filters. */
export function BoolFilterSelect({
  label,
  value,
  onChange,
}: BoolFilterSelectProps) {
  const stringValue =
    value === undefined ? undefined : value ? "true" : "false";

  return (
    <FilterSelect
      allLabel="Any"
      label={label}
      onChange={(next) =>
        onChange(next === undefined ? undefined : next === "true")
      }
      options={BOOL_OPTIONS}
      value={stringValue}
    />
  );
}
