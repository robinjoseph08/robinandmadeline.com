import { Check, Eye, EyeOff, Pencil, X } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";

import { Combobox, type ComboboxOption } from "@/components/library/Combobox";
import {
  DIFFICULTY_LABELS,
  MAX_DISPLAY_NAME_LENGTH,
} from "@/components/library/crossword/puzzle";
import { getPuzzleTitle } from "@/components/library/crossword/puzzles";
import {
  FROZEN_LAST_COL,
  FROZEN_LAST_COL_STATIC,
  FROZEN_ROW,
} from "@/components/pages/admin/grid/cells";
import { TooltipIconButton } from "@/components/pages/admin/grid/grid-buttons";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  useAdminGameSessions,
  useHideGameSession,
  useRenameGameSession,
  useSetGameSessionParty,
  useUnhideGameSession,
} from "@/hooks/queries/games";
import { useParties } from "@/hooks/queries/parties";
import { useAdminPageTitle } from "@/hooks/usePageTitle";
import { formatDateTime, formatDuration } from "@/libraries/format";
import type { AdminGameSessionResponse } from "@/types/generated/games";

/**
 * The parsed device, OS, and browser (e.g. "iPhone · iOS 18.1 · Safari 18"),
 * or "" when the server recognized none of them, so the caller can fall back
 * to the raw user agent.
 */
function describeClient(session: AdminGameSessionResponse) {
  return [session.client_device, session.client_os, session.client_browser]
    .filter(Boolean)
    .join(" · ");
}

/**
 * "City, Region" from whatever parts the IP lookup found.
 */
function describePlace(session: AdminGameSessionResponse) {
  return [session.ip_city, session.ip_region].filter(Boolean).join(", ");
}

/**
 * The country plus the network owner without its leading ASN, e.g. "US ·
 * Comcast Cable" for "AS7922 Comcast Cable". The full org stays in the
 * tooltip.
 */
function describeNetwork(session: AdminGameSessionResponse) {
  const org = session.ip_org.replace(/^AS\d+\s+/, "");
  return [session.ip_country, org].filter(Boolean).join(" · ");
}

// While some IP lookups are still pending, refetch on this interval so the
// Location column fills in without a manual reload. The resolver runs in the
// background and may be paused by ipinfo's rate limit, so polling stops a
// minute after the page is opened rather than running for as long as it stays
// open. The window restarts on each visit.
const GEO_POLL_INTERVAL_MS = 5000;
const GEO_POLL_WINDOW_MS = 60_000;

/**
 * Admin crossword solve times: every tracked solve session, newest first,
 * regardless of whether it was posted to the leaderboard or ever finished.
 * Unlike the guest-facing leaderboard this surfaces in-progress and abandoned
 * solves, opted-out completions, and the admin-only captured client details,
 * so a bad actor's public row can be hidden while retaining the solve for that
 * solver.
 * The backend already sorts newest-first and the data is wedding-bounded, so
 * v1 is a plain table with reversible leaderboard moderation, a per-row edit
 * mode (the pencil) for correcting a posted solve's name (never its time) and
 * which party any solve belongs to, and no paging, search, or sort. Rows stay
 * read-only until edited so the table stays compact.
 */
export default function AdminCrossword() {
  useAdminPageTitle("Crossword");
  const [openedAt] = useState(() => Date.now());
  const sessionsQuery = useAdminGameSessions({
    refetchInterval: (query) =>
      query.state.data?.items.some((session) => session.ip_geo_pending) &&
      Date.now() - openedAt < GEO_POLL_WINDOW_MS
        ? GEO_POLL_INTERVAL_MS
        : false,
  });
  const hideSession = useHideGameSession();
  const unhideSession = useUnhideGameSession();
  const renameSession = useRenameGameSession();
  const setSessionParty = useSetGameSessionParty();
  const partiesQuery = useParties({});
  const partyOptions = useMemo<ComboboxOption[]>(
    () =>
      (partiesQuery.data?.items ?? [])
        .map((party) => ({ value: party.id, label: party.name }))
        .sort((a, b) => a.label.localeCompare(b.label)),
    [partiesQuery.data],
  );

  // The session's own party is added when the parties list hasn't loaded (or
  // doesn't include it), so the picker always shows the current affiliation.
  const partyOptionsFor = (session: AdminGameSessionResponse) =>
    session.party_id &&
    session.party_name &&
    !partyOptions.some((option) => option.value === session.party_id)
      ? [
          { value: session.party_id, label: session.party_name },
          ...partyOptions,
        ]
      : partyOptions;
  const moderating = hideSession.isPending || unhideSession.isPending;

  // The row in edit mode (at most one) and its unsaved name and party.
  const [editing, setEditing] = useState<{
    sessionId: string;
    name: string;
    partyId?: string;
  } | null>(null);
  const saving = renameSession.isPending || setSessionParty.isPending;

  // Focus and select the name once when a row enters edit mode, so typing
  // replaces it. It's an effect keyed on the row rather than autoFocus or a
  // ref callback, so a re-render from picking a party never pulls focus back.
  const nameInputRef = useRef<HTMLInputElement>(null);
  const editingId = editing?.sessionId;
  useEffect(() => {
    if (editingId) nameInputRef.current?.select();
  }, [editingId]);

  const sessions = sessionsQuery.data?.items ?? [];

  // The solver's leaderboard name, or a fallback for solves that never opted in
  // (in-progress, abandoned, or completed-but-unposted all lack a display name).
  const solverName = (session: AdminGameSessionResponse) =>
    session.display_name ?? "Anonymous";

  const handleHide = async (session: AdminGameSessionResponse) => {
    if (
      !window.confirm(
        `Hide ${solverName(session)}'s time? They will still see it, but it will no longer appear for other users.`,
      )
    )
      return;
    try {
      await hideSession.mutateAsync({ sessionId: session.id });
      toast.success("Time hidden");
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "Failed to hide time",
      );
    }
  };

  const handleUnhide = async (session: AdminGameSessionResponse) => {
    if (
      !window.confirm(
        `Restore ${solverName(session)}'s time to the public leaderboard?`,
      )
    )
      return;
    try {
      await unhideSession.mutateAsync({ sessionId: session.id });
      toast.success("Time restored");
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "Failed to restore time",
      );
    }
  };

  // The API sends a missing party as null while the picker's clear yields
  // undefined, so the draft normalizes to undefined; otherwise picking a party
  // and clearing it again would read as a change and send a no-op write.
  const startEditing = (session: AdminGameSessionResponse) =>
    setEditing({
      sessionId: session.id,
      name: session.display_name ?? "",
      partyId: session.party_id ?? undefined,
    });

  // Saves only what changed, sending the party and name writes in parallel
  // (a name exists only on a posted solve). Nothing changed just leaves edit
  // mode. On any failure the row stays in edit mode with the draft, so the
  // admin can fix it and retry; a write that did succeed is reflected by the
  // refetch, so the retry only resends what is still different.
  const handleSave = async (session: AdminGameSessionResponse) => {
    if (!editing) return;
    const name = editing.name.trim();
    const renamed =
      Boolean(session.display_name) && name !== session.display_name;
    const partyChanged = editing.partyId !== (session.party_id ?? undefined);
    if (renamed && name === "") {
      toast.error("Name can't be blank");
      return;
    }
    if (!renamed && !partyChanged) {
      setEditing(null);
      return;
    }

    const results = await Promise.allSettled([
      partyChanged &&
        setSessionParty.mutateAsync({
          sessionId: session.id,
          partyId: editing.partyId,
        }),
      renamed &&
        renameSession.mutateAsync({
          sessionId: session.id,
          displayName: name,
        }),
    ]);
    const failure = results.find(
      (result): result is PromiseRejectedResult => result.status === "rejected",
    );
    if (failure) {
      toast.error(
        failure.reason instanceof Error
          ? failure.reason.message
          : "Failed to update solve",
      );
      return;
    }
    setEditing(null);
    toast.success("Solve updated");
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold">Crossword solve times</h1>
          <p className="text-sm text-muted-foreground">
            {sessionsQuery.data
              ? `${sessionsQuery.data.total} solve time${sessionsQuery.data.total === 1 ? "" : "s"}`
              : "Every tracked crossword solve, posted or not."}
          </p>
        </div>
      </div>

      {sessionsQuery.isLoading ? (
        <p className="text-muted-foreground">Loading solve times...</p>
      ) : sessionsQuery.isError ? (
        <p className="text-destructive">{sessionsQuery.error.message}</p>
      ) : sessions.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          No solve times yet. They appear here as guests play the crossword.
        </p>
      ) : (
        <div className="rounded-md border border-ink/10">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Solver</TableHead>
                <TableHead>Party</TableHead>
                <TableHead>Puzzle</TableHead>
                <TableHead>Difficulty</TableHead>
                <TableHead>Time</TableHead>
                <TableHead>Checks</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Date</TableHead>
                <TableHead>Client</TableHead>
                <TableHead>Location</TableHead>
                {/* The actions column is pinned to the right edge so the pencil
                    and the edit mode's save/cancel stay in reach on the wide
                    table, even when an edited row grows it. */}
                <TableHead className={`${FROZEN_LAST_COL_STATIC} w-20`} />
              </TableRow>
            </TableHeader>
            <TableBody>
              {sessions.map((session) => {
                // The draft is set only on the row in edit mode.
                const draft =
                  editing?.sessionId === session.id ? editing : null;
                return (
                  <TableRow className={FROZEN_ROW} key={session.id}>
                    <TableCell className="font-medium">
                      {draft && session.display_name ? (
                        <Input
                          aria-label={`Name for ${solverName(session)}'s solve`}
                          className="h-8 w-36"
                          disabled={saving}
                          maxLength={MAX_DISPLAY_NAME_LENGTH}
                          onChange={(e) =>
                            setEditing({ ...draft, name: e.target.value })
                          }
                          onKeyDown={(e) => {
                            // Leave the Enter that confirms an IME composition
                            // alone, so a half-typed name is never saved.
                            if (e.key === "Enter" && !e.nativeEvent.isComposing)
                              void handleSave(session);
                            if (e.key === "Escape") setEditing(null);
                          }}
                          ref={nameInputRef}
                          value={draft.name}
                        />
                      ) : (
                        (session.display_name ?? (
                          // No name submitted: render the placeholder lighter and
                          // italic so it reads as a derived fallback rather than a
                          // literal entered name. The muted-foreground token is the
                          // same ink as normal text in this theme, so opacity is
                          // what actually does the muting here.
                          <span
                            className="italic opacity-60"
                            title="No name submitted."
                          >
                            Anonymous
                          </span>
                        ))
                      )}
                    </TableCell>
                    <TableCell>
                      {draft ? (
                        <Combobox
                          ariaLabel={`Party for ${solverName(session)}'s solve`}
                          clearable
                          emptyText="No matching parties."
                          onChange={(partyId) =>
                            setEditing({ ...draft, partyId })
                          }
                          options={partyOptionsFor(session)}
                          placeholder="No party"
                          searchPlaceholder="Search parties..."
                          triggerClassName="h-8 w-40 rounded-md border border-input bg-transparent shadow-sm"
                          value={draft.partyId}
                        />
                      ) : (
                        (session.party_name ?? (
                          <span className="text-muted-foreground">-</span>
                        ))
                      )}
                    </TableCell>
                    <TableCell>{getPuzzleTitle(session.puzzle_id)}</TableCell>
                    <TableCell>
                      {DIFFICULTY_LABELS[session.difficulty]}
                    </TableCell>
                    <TableCell className="tabular-nums">
                      {formatDuration(session.elapsed_ms)}
                    </TableCell>
                    <TableCell>
                      {session.square_checks +
                        session.word_checks +
                        session.grid_checks ===
                      0 ? (
                        <span className="text-muted-foreground">-</span>
                      ) : (
                        <div className="space-y-0.5 whitespace-nowrap text-xs tabular-nums">
                          <div>Square: {session.square_checks}</div>
                          <div>Word: {session.word_checks}</div>
                          <div>Grid: {session.grid_checks}</div>
                        </div>
                      )}
                    </TableCell>
                    <TableCell>
                      {session.on_leaderboard ? (
                        <Badge variant="success">On leaderboard</Badge>
                      ) : session.hidden_at ? (
                        <Badge variant="outline">Hidden</Badge>
                      ) : session.completed_at ? (
                        <Badge variant="secondary">Completed</Badge>
                      ) : (
                        <Badge variant="outline">In progress</Badge>
                      )}
                    </TableCell>
                    <TableCell className="whitespace-nowrap text-muted-foreground">
                      {formatDateTime(
                        session.completed_at ?? session.created_at,
                      )}
                    </TableCell>
                    <TableCell className="text-muted-foreground">
                      <div className="max-w-64 space-y-1">
                        <div className="tabular-nums">
                          {session.ip_address || "-"}
                        </div>
                        <div
                          className="truncate text-xs"
                          title={
                            session.user_agent || "No user agent captured."
                          }
                        >
                          {describeClient(session) || session.user_agent || "-"}
                        </div>
                      </div>
                    </TableCell>
                    <TableCell className="text-muted-foreground">
                      {session.ip_geo_pending ? (
                        <span className="italic opacity-60">Looking up...</span>
                      ) : describePlace(session) || describeNetwork(session) ? (
                        <div className="max-w-48 space-y-1">
                          <div className="whitespace-nowrap">
                            {describePlace(session) || "-"}
                          </div>
                          {describeNetwork(session) ? (
                            <div
                              className="truncate text-xs"
                              title={session.ip_org || undefined}
                            >
                              {describeNetwork(session)}
                            </div>
                          ) : null}
                        </div>
                      ) : (
                        <span>-</span>
                      )}
                    </TableCell>
                    <TableCell className={FROZEN_LAST_COL}>
                      {/* Right-aligned with the pencil last, so it sits at
                          the right edge on every row and hide/restore appear
                          to its left only where they apply. */}
                      <div className="flex justify-end">
                        {draft ? (
                          <>
                            <TooltipIconButton
                              disabled={saving}
                              label={`Save ${solverName(session)}'s solve`}
                              onClick={() => void handleSave(session)}
                            >
                              <Check />
                            </TooltipIconButton>
                            <TooltipIconButton
                              disabled={saving}
                              label="Cancel editing"
                              onClick={() => setEditing(null)}
                            >
                              <X />
                            </TooltipIconButton>
                          </>
                        ) : (
                          <>
                            {session.on_leaderboard ? (
                              <TooltipIconButton
                                disabled={moderating}
                                label={`Hide ${solverName(session)}'s time`}
                                onClick={() => handleHide(session)}
                              >
                                <EyeOff />
                              </TooltipIconButton>
                            ) : session.hidden_at ? (
                              <TooltipIconButton
                                disabled={moderating}
                                label={`Restore ${solverName(session)}'s time`}
                                onClick={() => handleUnhide(session)}
                              >
                                <Eye />
                              </TooltipIconButton>
                            ) : null}
                            <TooltipIconButton
                              disabled={moderating || saving}
                              label={`Edit ${solverName(session)}'s solve`}
                              onClick={() => startEditing(session)}
                            >
                              <Pencil />
                            </TooltipIconButton>
                          </>
                        )}
                      </div>
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </div>
      )}
    </div>
  );
}
