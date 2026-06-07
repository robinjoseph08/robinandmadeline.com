import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

import type { Option } from "./options";

// Radix Select forbids an empty-string item value, so the "all" sentinel stands
// in for "no filter" in the control and maps back to undefined for the query.
const ALL_VALUE = "__all__";

interface FilterSelectProps<T extends string> {
  label: string;
  value: T | undefined;
  options: Option<T>[];
  onChange: (value: T | undefined) => void;
  /** Label for the clear/no-filter option. */
  allLabel?: string;
}

/**
 * A labeled enum filter dropdown with a leading "all" option that clears the
 * filter (value undefined). Used across the parties and guests list filter bars.
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
      <Select
        onValueChange={(next) =>
          onChange(next === ALL_VALUE ? undefined : (next as T))
        }
        value={value ?? ALL_VALUE}
      >
        <SelectTrigger aria-label={label} className="w-40">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value={ALL_VALUE}>{allLabel}</SelectItem>
          {options.map((option) => (
            <SelectItem key={option.value} value={option.value}>
              {option.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
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
