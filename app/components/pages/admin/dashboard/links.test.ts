import { describe, expect, it } from "vitest";

import { guestsLink, partiesLink } from "./links";

describe("dashboard list links", () => {
  it("builds the guests list URL with the count's filters", () => {
    expect(guestsLink({ attendance: "declined" })).toBe(
      "/admin/guests?attendance=declined",
    );
    expect(guestsLink({ event_id: "ev1", rsvp_status: "pending" })).toBe(
      "/admin/guests?event_id=ev1&rsvp_status=pending",
    );
  });

  it("writes booleans the way the list parses them, false included", () => {
    expect(guestsLink({ is_child: false })).toBe(
      "/admin/guests?is_child=false",
    );
    expect(guestsLink({ is_drinking: true })).toBe(
      "/admin/guests?is_drinking=true",
    );
  });

  it("skips unset filters", () => {
    expect(guestsLink({ side: undefined })).toBe("/admin/guests");
    expect(partiesLink({ rsvp_progress: "not_responded" })).toBe(
      "/admin/parties?rsvp_progress=not_responded",
    );
  });
});
