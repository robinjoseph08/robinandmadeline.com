import { X } from "lucide-react";
import { useState } from "react";

interface ChipsInputProps {
  /** The current values, rendered as removable chips. */
  value: string[];
  onChange: (value: string[]) => void;
  /** id for the inner text field, so a Label htmlFor can target it. */
  id?: string;
  /** Shown while there are no chips and nothing typed. */
  placeholder?: string;
}

/**
 * A free-form multi-value input rendered as removable chips inside an
 * Input-styled frame. Enter adds the typed value as a chip and Backspace in the
 * empty field removes the last one; nothing is ever split on a separator
 * character, so a value containing commas survives untouched (guest tags are
 * open-ended strings, and the grid can create comma-containing ones).
 */
export function ChipsInput({
  value,
  onChange,
  id,
  placeholder,
}: ChipsInputProps) {
  const [draft, setDraft] = useState("");

  // Commits the typed draft as a chip; duplicates (case-insensitive, matching
  // the grid's suggestion de-dup) are dropped rather than added twice.
  const addDraft = () => {
    const trimmed = draft.trim();
    if (
      trimmed !== "" &&
      !value.some((v) => v.toLowerCase() === trimmed.toLowerCase())
    ) {
      onChange([...value, trimmed]);
    }
    setDraft("");
  };

  return (
    <div className="flex min-h-9 w-full flex-wrap items-center gap-1 rounded-md border border-input bg-transparent px-3 py-1 shadow-sm transition-colors focus-within:ring-1 focus-within:ring-ring">
      {value.map((item) => (
        <span
          className="inline-flex items-center gap-1 whitespace-nowrap rounded-full bg-secondary px-2 py-0.5 text-xs font-medium text-secondary-foreground"
          key={item}
        >
          {item}
          <button
            aria-label={`Remove ${item}`}
            className="cursor-pointer rounded-full opacity-50 outline-none hover:opacity-100 focus-visible:opacity-100 focus-visible:ring-1 focus-visible:ring-ring"
            onClick={() => onChange(value.filter((v) => v !== item))}
            type="button"
          >
            <X className="size-3" />
          </button>
        </span>
      ))}
      <input
        className="min-w-24 flex-1 bg-transparent text-base outline-none placeholder:text-ink/40 md:text-sm"
        id={id}
        // Commit on blur too, so a tag typed right before clicking Save is not
        // silently dropped for lack of an Enter.
        onBlur={addDraft}
        onChange={(e) => setDraft(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            e.preventDefault();
            addDraft();
          } else if (
            e.key === "Backspace" &&
            draft === "" &&
            value.length > 0
          ) {
            e.preventDefault();
            onChange(value.slice(0, -1));
          }
        }}
        placeholder={value.length === 0 ? placeholder : undefined}
        value={draft}
      />
    </div>
  );
}
