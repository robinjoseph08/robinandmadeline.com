import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import type { SendStats } from "@/types/generated/emails";
import type { EmailRecipientStatus } from "@/types/generated/models";

import { SendStatsSummary, StatusBadge } from "./status";

function makeStats(overrides: Partial<SendStats>): SendStats {
  return {
    queued: 0,
    sending: 0,
    sent: 0,
    delivered: 0,
    bounced: 0,
    failed: 0,
    total: 0,
    ...overrides,
  };
}

describe("StatusBadge", () => {
  // Each delivery status renders its human-readable label. Pairing the status
  // with its expected copy catches a label map entry being dropped or mislabeled
  // (the component is otherwise never rendered by the page tests).
  const cases: [EmailRecipientStatus, string][] = [
    ["queued", "Queued"],
    ["sending", "Sending"],
    ["sent", "Sent"],
    ["delivered", "Delivered"],
    ["bounced", "Bounced"],
    ["failed", "Failed"],
  ];

  it.each(cases)("renders the %s status as its label", (status, label) => {
    render(<StatusBadge status={status} />);
    expect(screen.getByText(label)).toBeInTheDocument();
  });
});

describe("SendStatsSummary", () => {
  it("renders the empty branch when the send has no recipients", () => {
    render(<SendStatsSummary stats={makeStats({ total: 0 })} />);
    expect(screen.getByText("No recipients")).toBeInTheDocument();
  });

  it("lists only the statuses that occur, with the recipient total", () => {
    render(
      <SendStatsSummary
        stats={makeStats({ delivered: 3, bounced: 1, total: 4 })}
      />,
    );
    expect(screen.getByText(/3 delivered, 1 bounced/)).toBeInTheDocument();
    expect(screen.getByText(/of 4 recipients/)).toBeInTheDocument();
  });

  it("uses the singular recipient noun for a single recipient", () => {
    render(<SendStatsSummary stats={makeStats({ sent: 1, total: 1 })} />);
    expect(screen.getByText(/of 1 recipient$/)).toBeInTheDocument();
  });
});
