import { useRef } from "react";

import { usePhoneFormatting } from "@/components/library/use-phone-formatting";
import { Input } from "@/components/ui/input";

interface PhoneFieldProps {
  id: string;
  onChange: (value: string) => void;
  placeholder: string;
  value: string;
}

/**
 * A controlled phone input that formats US numbers as the user types, with the
 * caret kept beside the digit being edited (see usePhoneFormatting). The backend
 * still normalizes to E.164 on save, so seed this with a display-formatted value
 * (formatPhone) and submit whatever it holds.
 */
export function PhoneField({
  id,
  onChange,
  placeholder,
  value,
}: PhoneFieldProps) {
  const ref = useRef<HTMLInputElement>(null);
  const handleChange = usePhoneFormatting(ref, onChange);
  return (
    <Input
      id={id}
      onChange={handleChange}
      placeholder={placeholder}
      ref={ref}
      type="tel"
      value={value}
    />
  );
}
