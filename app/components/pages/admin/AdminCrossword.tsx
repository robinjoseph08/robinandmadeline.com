import { Trash2 } from "lucide-react";
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
  useDeleteGameSession,
} from "@/hooks/queries/games";
import { formatDateTime, formatDuration } from "@/libraries/format";
import type { AdminGameSessionResponse } from "@/types/generated/games";

/**
 * Admin crossword solve times: every tracked solve session, newest first,
 * regardless of whether it was posted to the leaderboard or ever finished.
 * Unlike the guest-facing leaderboard this surfaces in-progress and abandoned
 * solves, opted-out completions, and the admin-only captured IP, so a bad
 * actor's rows can be found and deleted without touching the database. The
 * backend already sorts newest-first and the data is wedding-bounded, so v1 is
 * a plain table with row delete and no paging, search, or sort.
 */
export default function AdminCrossword() {
  const sessionsQuery = useAdminGameSessions();
  const deleteSession = useDeleteGameSession();

  const sessions = sessionsQuery.data?.items ?? [];

  // The solver's leaderboard name, or a fallback for solves that never opted in
  // (in-progress, abandoned, or completed-but-unposted all lack a display name).
  const solverName = (session: AdminGameSessionResponse) =>
    session.display_name ?? "Anonymous";

  const handleDelete = async (session: AdminGameSessionResponse) => {
    if (
      !window.confirm(
        `Delete ${solverName(session)}'s time? This removes the solve session for good.`,
      )
    )
      return;
    try {
      await deleteSession.mutateAsync({ sessionId: session.id });
      toast.success("Time deleted");
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "Failed to delete time",
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
                <TableHead>IP address</TableHead>
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
                    ) : session.completed_at ? (
                      <Badge variant="secondary">Completed</Badge>
                    ) : (
                      <Badge variant="outline">In progress</Badge>
                    )}
                  </TableCell>
                  <TableCell className="whitespace-nowrap text-muted-foreground">
                    {formatDateTime(session.completed_at ?? session.created_at)}
                  </TableCell>
                  <TableCell className="tabular-nums text-muted-foreground">
                    {session.ip_address || (
                      <span className="text-muted-foreground">-</span>
                    )}
                  </TableCell>
                  <TableCell>
                    <div className="flex justify-end">
                      <TooltipIconButton
                        disabled={deleteSession.isPending}
                        label={`Delete ${solverName(session)}'s time`}
                        onClick={() => handleDelete(session)}
                      >
                        <Trash2 />
                      </TooltipIconButton>
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
