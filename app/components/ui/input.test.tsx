import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { Input } from "@/components/ui/input";

describe("Input", () => {
  it("opts out of 1Password by default", () => {
    render(<Input aria-label="Email" type="email" />);
    expect(screen.getByLabelText("Email")).toHaveAttribute("data-1p-ignore");
  });

  it("opts out of 1Password when autocomplete is off", () => {
    render(<Input aria-label="Code" autoComplete="off" />);
    expect(screen.getByLabelText("Code")).toHaveAttribute("data-1p-ignore");
  });

  it("allows autofill when the field names an autocomplete token", () => {
    render(<Input aria-label="Email" autoComplete="email" />);
    expect(screen.getByLabelText("Email")).not.toHaveAttribute(
      "data-1p-ignore",
    );
  });
});
