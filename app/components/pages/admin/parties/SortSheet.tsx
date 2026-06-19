import {
  ArrowDown,
  ArrowDownUp,
  ArrowUp,
  ChevronDown,
  ChevronUp,
  Plus,
  RotateCcw,
  Save,
  X,
} from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "@/components/ui/sheet";
import type { SortLevel } from "@/libraries/sortSpec";

import type { SortFieldOption } from "./options";

interface SortSheetProps {
  /** The fields this list can sort by, in display order. */
  fields: SortFieldOption[];
  /** The active (effective) sort levels, in precedence order. */
  levels: readonly SortLevel[];
  /** Bubbles up the full new level list on any edit (the page owns the state). */
  onChange: (levels: SortLevel[]) => void;
  /** True when the active sort differs from the current default. */
  isDirty: boolean;
  /** Save the active sort as this browser's default for the list. */
  onSaveDefault: () => void;
  /** Drop the active sort back to the default. */
  onResetDefault: () => void;
}

interface SortLevelRowProps {
  fields: SortFieldOption[];
  usedFields: string[];
  level: SortLevel;
  index: number;
  count: number;
  onChangeField: (index: number, field: string) => void;
  onToggleDirection: (index: number) => void;
  onMove: (from: number, to: number) => void;
  onRemove: (index: number) => void;
}

function SortLevelRow({
  fields,
  usedFields,
  level,
  index,
  count,
  onChangeField,
  onToggleDirection,
  onMove,
  onRemove,
}: SortLevelRowProps) {
  // Offer fields not already used by another row, plus this row's own field.
  const available = fields.filter(
    (f) => f.field === level.field || !usedFields.includes(f.field),
  );
  const label =
    fields.find((f) => f.field === level.field)?.label ?? level.field;
  const isAsc = level.direction === "asc";

  return (
    <div className="flex items-center gap-1.5">
      <Select
        onValueChange={(value) => onChangeField(index, value)}
        value={level.field}
      >
        <SelectTrigger className="flex-1">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {available.map((f) => (
            <SelectItem key={f.field} value={f.field}>
              {f.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      <Button
        aria-label={`${label} direction: ${isAsc ? "ascending" : "descending"}. Click to toggle.`}
        onClick={() => onToggleDirection(index)}
        size="icon"
        variant="outline"
      >
        {isAsc ? <ArrowUp /> : <ArrowDown />}
      </Button>
      <Button
        aria-label={`Move ${label} earlier`}
        disabled={index === 0}
        onClick={() => onMove(index, index - 1)}
        size="icon"
        variant="ghost"
      >
        <ChevronUp />
      </Button>
      <Button
        aria-label={`Move ${label} later`}
        disabled={index === count - 1}
        onClick={() => onMove(index, index + 1)}
        size="icon"
        variant="ghost"
      >
        <ChevronDown />
      </Button>
      <Button
        aria-label={`Remove ${label} sort`}
        onClick={() => onRemove(index)}
        size="icon"
        variant="ghost"
      >
        <X />
      </Button>
    </div>
  );
}

/**
 * The list sort control: a "Sort" button (with a dot when the active sort differs
 * from the default) that opens a sheet holding the multi-level sort. Each row is
 * a field + direction; rows are ordered by precedence (the first is the primary
 * sort) and reordered with the up/down arrows. Add a field to sort by it next,
 * remove one to drop it. The active sort lives in the URL (the page owns it, so
 * it is shareable); "Save as default" persists it to this browser via
 * localStorage. Sheet-only (no drawer), matching FilterSheet.
 */
export function SortSheet({
  fields,
  levels,
  onChange,
  isDirty,
  onSaveDefault,
  onResetDefault,
}: SortSheetProps) {
  const usedFields = levels.map((l) => l.field);
  const unusedFields = fields.filter((f) => !usedFields.includes(f.field));

  const addLevel = (field: string) => {
    onChange([...levels, { field, direction: "asc" }]);
  };
  const changeField = (index: number, field: string) => {
    onChange(levels.map((l, i) => (i === index ? { ...l, field } : l)));
  };
  const toggleDirection = (index: number) => {
    onChange(
      levels.map((l, i) =>
        i === index
          ? { ...l, direction: l.direction === "asc" ? "desc" : "asc" }
          : l,
      ),
    );
  };
  const removeLevel = (index: number) => {
    onChange(levels.filter((_, i) => i !== index));
  };
  const moveLevel = (from: number, to: number) => {
    const next = [...levels];
    const [item] = next.splice(from, 1);
    next.splice(to, 0, item);
    onChange(next);
  };

  return (
    <Sheet>
      <SheetTrigger asChild>
        <Button className="relative cursor-pointer" variant="outline">
          <ArrowDownUp />
          Sort
          {isDirty ? (
            <span
              aria-label="Sort differs from default"
              className="absolute -right-1 -top-1 size-2 rounded-full bg-primary ring-2 ring-background"
            />
          ) : null}
        </Button>
      </SheetTrigger>
      <SheetContent>
        <SheetHeader>
          <SheetTitle>Sort</SheetTitle>
          <SheetDescription>
            Order the list by one or more fields. The first row is the primary
            sort; reorder with the arrows. Defaults are saved in this browser.
          </SheetDescription>
        </SheetHeader>

        <div className="flex flex-col gap-4">
          {levels.length > 0 ? (
            <div className="flex flex-col gap-2">
              {levels.map((level, index) => (
                <SortLevelRow
                  count={levels.length}
                  fields={fields}
                  index={index}
                  key={level.field}
                  level={level}
                  onChangeField={changeField}
                  onMove={moveLevel}
                  onRemove={removeLevel}
                  onToggleDirection={toggleDirection}
                  usedFields={usedFields}
                />
              ))}
            </div>
          ) : null}

          {unusedFields.length > 0 && levels.length < fields.length ? (
            <div className="flex flex-col gap-2">
              <span className="text-xs font-medium text-muted-foreground">
                {levels.length === 0 ? "Sort by" : "Then by"}
              </span>
              <div className="flex flex-wrap gap-2">
                {unusedFields.map((f) => (
                  <Button
                    key={f.field}
                    onClick={() => addLevel(f.field)}
                    size="sm"
                    variant="outline"
                  >
                    <Plus />
                    {f.label}
                  </Button>
                ))}
              </div>
            </div>
          ) : null}
        </div>

        {isDirty ? (
          <SheetFooter>
            <Button
              className="cursor-pointer"
              onClick={onResetDefault}
              variant="ghost"
            >
              <RotateCcw />
              Reset to default
            </Button>
            <Button
              className="cursor-pointer"
              onClick={onSaveDefault}
              variant="default"
            >
              <Save />
              Save as default
            </Button>
          </SheetFooter>
        ) : null}
      </SheetContent>
    </Sheet>
  );
}
