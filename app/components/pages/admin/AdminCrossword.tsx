import { Eye, EyeOff } from "lucide-react";
import { toast } from "sonner";

import { DIFFICULTY_LABELS } from "@/components/library/crossword/puzzle";
import { getPuzzleTitle } from "@/components/library/crossword/puzzles";
import { TooltipIconButton } from "@/components/pages/admin/grid/grid-buttons";
import { Badge } from "@/components/ui/badge";
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
  useUnhideGameSession,
} from "@/hooks/queries/games";
import { useAdminPageTitle } from "@/hooks/usePageTitle";
import { formatDateTime, formatDuration } from "@/libraries/format";
import type { AdminGameSessionResponse } from "@/types/generated/games";

/**
 * Admin crossword solve times: every tracked solve session, newest first,
 * regardless of whether it was posted to the leaderboard or ever finished.
 * Unlike the guest-facing leaderboard this surfaces in-progress and abandoned
 * solves, opted-out completions, and the admin-only captured client details,
 * so a bad actor's public row can be hidden while retaining the solve for that
 * solver.
 * The backend already sorts newest-first and the data is wedding-bounded, so
 * v1 is a plain table with reversible leaderboard moderation and no paging,
 * search, or sort.
 */
export default function AdminCrossword() {
  useAdminPageTitle("Crossword");
  const sessionsQuery = useAdminGameSessions();
  const hideSession = useHideGameSession();
  const unhideSession = useUnhideGameSession();

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
                <TableHead>Status</TableHead>
                <TableHead>Date</TableHead>
                <TableHead>Client</TableHead>
                <TableHead className="w-12" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {sessions.map((session) => (
                <TableRow key={session.id}>
                  <TableCell className="font-medium">
                    {session.display_name ?? (
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
                    )}
                  </TableCell>
                  <TableCell>
                    {session.party_name ?? (
                      <span className="text-muted-foreground">-</span>
                    )}
                  </TableCell>
                  <TableCell>{getPuzzleTitle(session.puzzle_id)}</TableCell>
                  <TableCell>{DIFFICULTY_LABELS[session.difficulty]}</TableCell>
                  <TableCell className="tabular-nums">
                    {formatDuration(session.elapsed_ms)}
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
                    {formatDateTime(session.completed_at ?? session.created_at)}
                  </TableCell>
                  <TableCell className="text-muted-foreground">
                    <div className="max-w-64 space-y-1">
                      <div className="tabular-nums">
                        {session.ip_address || "-"}
                      </div>
                      <div
                        className="truncate text-xs"
                        title={session.user_agent || "No user agent captured."}
                      >
                        {session.user_agent || "-"}
                      </div>
                    </div>
                  </TableCell>
                  <TableCell>
                    <div className="flex justify-end">
                      {session.on_leaderboard ? (
                        <TooltipIconButton
                          disabled={
                            hideSession.isPending || unhideSession.isPending
                          }
                          label={`Hide ${solverName(session)}'s time`}
                          onClick={() => handleHide(session)}
                        >
                          <EyeOff />
                        </TooltipIconButton>
                      ) : session.hidden_at ? (
                        <TooltipIconButton
                          disabled={
                            hideSession.isPending || unhideSession.isPending
                          }
                          label={`Restore ${solverName(session)}'s time`}
                          onClick={() => handleUnhide(session)}
                        >
                          <Eye />
                        </TooltipIconButton>
                      ) : null}
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}
    </div>
  );
}
