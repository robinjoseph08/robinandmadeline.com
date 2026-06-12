import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, render, screen, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";

import Schedule from "@/components/pages/Schedule";
import { GUEST_TOKEN_STORAGE_KEY } from "@/libraries/guest-api";
import type { ScheduleEvent } from "@/types/generated/events";
import type { PartyPhotoGroup } from "@/types/generated/photogroups";

function makeEvent(overrides: Partial<ScheduleEvent> = {}): ScheduleEvent {
  return {
    id: "e-reception",
    name: "Reception",
    description: undefined,
    location: undefined,
    date: "2026-10-17",
    start_time: undefined,
    end_time: undefined,
    is_public: true,
    created_at: "2026-01-01T00:00:00Z",
    updated_at: "2026-01-01T00:00:00Z",
    ...overrides,
  };
}

function makePhotoGroup(
  overrides: Partial<PartyPhotoGroup> = {},
): PartyPhotoGroup {
  return {
    id: "pg-1",
    name: "Family Photos",
    position: 1,
    total: 3,
    guest_names: ["Leon Smith", "Leslie Smith"],
    ...overrides,
  };
}

function renderSchedule() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  const view = render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={["/schedule"]}>
        <Schedule />
      </MemoryRouter>
    </QueryClientProvider>,
  );
  return { client, ...view };
}

/**
 * Mocks fetch with the page's two reads: GET /api/events returns the given
 * schedule and GET /api/guest/photo-groups (requested only when a guest token
 * is stored) returns the given party photo groups.
 */
function mockScheduleFetch(
  items: ScheduleEvent[],
  photoGroups: PartyPhotoGroup[] = [],
) {
  const fetchMock = vi.fn().mockImplementation((url: string) => {
    const body = url.startsWith("/api/guest/photo-groups")
      ? { items: photoGroups, total: photoGroups.length }
      : { items, total: items.length };
    return Promise.resolve(
      new Response(JSON.stringify(body), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
    );
  });
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

beforeEach(() => {
  localStorage.clear();
  vi.unstubAllGlobals();
});

describe("Schedule", () => {
  it("renders each event with its date, time, location, and description", async () => {
    mockScheduleFetch([
      makeEvent({
        start_time: "17:00",
        end_time: "22:00",
        location: "The Grand Hall",
        description: "Dinner and dancing.",
      }),
    ]);

    renderSchedule();

    const card = await screen.findByRole("article", { name: "Reception" });
    expect(
      within(card).getByText(
        "Saturday, October 17, 2026 · 5:00 PM to 10:00 PM",
      ),
    ).toBeInTheDocument();
    expect(within(card).getByText("The Grand Hall")).toBeInTheDocument();
    expect(within(card).getByText("Dinner and dancing.")).toBeInTheDocument();
  });

  it("renders events in the order the API returns (schedule order)", async () => {
    mockScheduleFetch([
      makeEvent({ id: "e-1", name: "Ceremony", date: "2026-10-17" }),
      makeEvent({ id: "e-2", name: "Reception", date: "2026-10-17" }),
      makeEvent({ id: "e-3", name: "Brunch", date: "2026-10-18" }),
    ]);

    renderSchedule();

    await screen.findByRole("article", { name: "Ceremony" });
    const names = screen
      .getAllByRole("article")
      .map((card) => within(card).getByRole("heading").textContent);
    expect(names).toEqual(["Ceremony", "Reception", "Brunch"]);
  });

  it("requests anonymously and prompts for the party code without a token", async () => {
    const fetchMock = mockScheduleFetch([makeEvent()]);

    renderSchedule();

    await screen.findByRole("article", { name: "Reception" });
    const [, init] = fetchMock.mock.calls[0];
    expect(init.headers ?? {}).not.toHaveProperty("Authorization");

    const prompt = screen.getByText(/enter your party code/i);
    expect(prompt).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /party code/i })).toHaveAttribute(
      "href",
      "/rsvp",
    );
  });

  it("treats a blank stored token as anonymous", async () => {
    // apiRequest only attaches truthy tokens, so a stored "" must take the
    // anonymous path: otherwise the server returns 200 to the tokenless
    // request and the page claims the authenticated view forever.
    localStorage.setItem(GUEST_TOKEN_STORAGE_KEY, "");
    const fetchMock = mockScheduleFetch([makeEvent()]);

    renderSchedule();

    await screen.findByRole("article", { name: "Reception" });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [, init] = fetchMock.mock.calls[0];
    expect(init.headers ?? {}).not.toHaveProperty("Authorization");
    expect(screen.getByText(/enter your party code/i)).toBeInTheDocument();
  });

  it("sends the stored guest token and marks private events", async () => {
    localStorage.setItem(GUEST_TOKEN_STORAGE_KEY, "a.guest.jwt");
    const fetchMock = mockScheduleFetch([
      makeEvent({
        id: "e-rehearsal",
        name: "Rehearsal Dinner",
        is_public: false,
      }),
      makeEvent(),
    ]);

    renderSchedule();

    const privateCard = await screen.findByRole("article", {
      name: "Rehearsal Dinner",
    });
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/events",
      expect.objectContaining({
        headers: expect.objectContaining({
          Authorization: "Bearer a.guest.jwt",
        }),
      }),
    );

    // The private event is visually marked; the public one is not, and the
    // authenticated view has no code prompt.
    expect(within(privateCard).getByText("You're invited")).toBeInTheDocument();
    const publicCard = screen.getByRole("article", { name: "Reception" });
    expect(
      within(publicCard).queryByText("You're invited"),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByText(/enter your party code/i),
    ).not.toBeInTheDocument();
  });

  it("clears a stale token, falls back to the public view, and prompts again", async () => {
    localStorage.setItem(GUEST_TOKEN_STORAGE_KEY, "expired.jwt");
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            error: {
              code: "unauthorized",
              message: "Invalid or expired token.",
              status_code: 401,
            },
          }),
          { status: 401, headers: { "Content-Type": "application/json" } },
        ),
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ items: [makeEvent()], total: 1 }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        }),
      );
    vi.stubGlobal("fetch", fetchMock);

    renderSchedule();

    await screen.findByRole("article", { name: "Reception" });
    expect(localStorage.getItem(GUEST_TOKEN_STORAGE_KEY)).toBeNull();
    expect(fetchMock).toHaveBeenCalledTimes(2);
    // The retry is genuinely anonymous: resending the stale token would just
    // 401 again against a real server.
    const [, retryInit] = fetchMock.mock.calls[1];
    expect(retryInit.headers ?? {}).not.toHaveProperty("Authorization");
    expect(screen.getByText(/enter your party code/i)).toBeInTheDocument();
  });

  it("keeps the stored token when the authenticated fetch fails with a non-401", async () => {
    localStorage.setItem(GUEST_TOKEN_STORAGE_KEY, "a.guest.jwt");
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          error: {
            code: "internal_server_error",
            message: "Something went wrong.",
            status_code: 500,
          },
        }),
        { status: 500, headers: { "Content-Type": "application/json" } },
      ),
    );
    vi.stubGlobal("fetch", fetchMock);

    renderSchedule();

    // A server blip surfaces as the error state; it must not log the guest
    // out (only a 401 means the token itself is stale) or retry anonymously.
    expect(await screen.findByRole("alert")).toHaveTextContent(
      /something went wrong loading the schedule/i,
    );
    expect(localStorage.getItem(GUEST_TOKEN_STORAGE_KEY)).toBe("a.guest.jwt");
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("offers an .ics download and a Google Calendar link per event", async () => {
    mockScheduleFetch([makeEvent({ start_time: "17:00", end_time: "22:00" })]);

    renderSchedule();

    const card = await screen.findByRole("article", { name: "Reception" });
    expect(
      within(card).getByRole("button", { name: /add to calendar/i }),
    ).toBeInTheDocument();
    const googleLink = within(card).getByRole("link", {
      name: /google calendar/i,
    });
    expect(googleLink).toHaveAttribute(
      "href",
      expect.stringContaining("https://calendar.google.com/calendar/render"),
    );
    expect(googleLink).toHaveAttribute(
      "href",
      expect.stringContaining("text=Reception"),
    );
  });

  it("explains an empty schedule instead of rendering nothing", async () => {
    mockScheduleFetch([]);

    renderSchedule();

    expect(
      await screen.findByText(/schedule is still coming together/i),
    ).toBeInTheDocument();
  });

  it("keeps showing the cached schedule when a background refetch fails", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ items: [makeEvent()], total: 1 }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        }),
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            error: {
              code: "internal_server_error",
              message: "Something went wrong.",
              status_code: 500,
            },
          }),
          { status: 500, headers: { "Content-Type": "application/json" } },
        ),
      );
    vi.stubGlobal("fetch", fetchMock);

    const { client } = renderSchedule();

    await screen.findByRole("article", { name: "Reception" });
    await act(async () => {
      await client.refetchQueries();
      // React Query batches observer notifications on a timer, so give the
      // error state a macrotask to reach the component before asserting.
      await new Promise((resolve) => setTimeout(resolve, 0));
    });

    // The refetch really failed and the component saw it...
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(client.getQueryCache().getAll()[0]?.state.status).toBe("error");
    // ...but the visitor keeps the schedule they were already reading; the
    // error page is only for having nothing to show.
    expect(
      screen.getByRole("article", { name: "Reception" }),
    ).toBeInTheDocument();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("shows an error message when the schedule fails to load", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          error: {
            code: "internal_server_error",
            message: "Something went wrong.",
            status_code: 500,
          },
        }),
        { status: 500, headers: { "Content-Type": "application/json" } },
      ),
    );
    vi.stubGlobal("fetch", fetchMock);

    renderSchedule();

    expect(await screen.findByRole("alert")).toHaveTextContent(
      /something went wrong loading the schedule/i,
    );
  });

  it("shows the photos section naming the party's guests per group", async () => {
    localStorage.setItem(GUEST_TOKEN_STORAGE_KEY, "a.guest.jwt");
    const fetchMock = mockScheduleFetch(
      [makeEvent()],
      [
        makePhotoGroup(),
        makePhotoGroup({
          id: "pg-2",
          name: "College Friends",
          position: 3,
          guest_names: ["Leslie Smith"],
        }),
      ],
    );

    renderSchedule();

    const section = await screen.findByRole("region", { name: "Group Photos" });
    // The static copy states when the photo session happens (domain truth:
    // one session between the ceremony and the reception).
    expect(
      within(section).getByText(
        /group photos after the ceremony, before the reception/i,
      ),
    ).toBeInTheDocument();
    // Group-major lines, first names only, with shooting-order positions.
    expect(
      within(section).getByText("Family Photos (group 1 of 3): Leon, Leslie"),
    ).toBeInTheDocument();
    expect(
      within(section).getByText("College Friends (group 3 of 3): Leslie"),
    ).toBeInTheDocument();
    // The photos read is the authenticated guest endpoint.
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/guest/photo-groups",
      expect.objectContaining({
        headers: expect.objectContaining({
          Authorization: "Bearer a.guest.jwt",
        }),
      }),
    );
  });

  it("hides the photos section when the party has no assignments", async () => {
    localStorage.setItem(GUEST_TOKEN_STORAGE_KEY, "a.guest.jwt");
    mockScheduleFetch([makeEvent()], []);

    renderSchedule();

    await screen.findByRole("article", { name: "Reception" });
    expect(
      screen.queryByRole("region", { name: "Group Photos" }),
    ).not.toBeInTheDocument();
  });

  it("keeps the schedule and hides the photos section when the photos fetch fails", async () => {
    localStorage.setItem(GUEST_TOKEN_STORAGE_KEY, "a.guest.jwt");
    const fetchMock = vi.fn().mockImplementation((url: string) => {
      if (url.startsWith("/api/guest/photo-groups")) {
        return Promise.resolve(
          new Response(
            JSON.stringify({
              error: {
                code: "internal_server_error",
                message: "Something went wrong.",
                status_code: 500,
              },
            }),
            { status: 500, headers: { "Content-Type": "application/json" } },
          ),
        );
      }
      return Promise.resolve(
        new Response(JSON.stringify({ items: [makeEvent()], total: 1 }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        }),
      );
    });
    vi.stubGlobal("fetch", fetchMock);

    renderSchedule();

    // The schedule itself is unaffected; the photos section just stays
    // hidden rather than disturbing the page with an error.
    await screen.findByRole("article", { name: "Reception" });
    expect(
      screen.queryByRole("region", { name: "Group Photos" }),
    ).not.toBeInTheDocument();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("never requests or shows the photos section in the anonymous view", async () => {
    // The photos data is per-party, so the anonymous view neither renders the
    // section nor calls the guest endpoint (which would just 401).
    const fetchMock = mockScheduleFetch([makeEvent()]);

    renderSchedule();

    await screen.findByRole("article", { name: "Reception" });
    expect(
      screen.queryByRole("region", { name: "Group Photos" }),
    ).not.toBeInTheDocument();
    const requested = fetchMock.mock.calls.map((call) => call[0] as string);
    expect(requested).toEqual(["/api/events"]);
  });

  it("never calls out private events in the anonymous view", async () => {
    // The API only sends private events to authenticated guests, but even if
    // one slipped through anonymously the badge stays tied to authentication.
    mockScheduleFetch([
      makeEvent({ id: "e-private", name: "Brunch", is_public: false }),
    ]);

    renderSchedule();

    await screen.findByRole("article", { name: "Brunch" });
    expect(screen.queryByText("You're invited")).not.toBeInTheDocument();
  });
});
