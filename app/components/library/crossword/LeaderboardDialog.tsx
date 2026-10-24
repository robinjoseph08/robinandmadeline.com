// One puzzle's leaderboard, split into one tab per difficulty: fastest
// published solves first within the difficulty each solve is recorded at
// (the easiest used). Fetched lazily per tab when the dialog opens; the read
// is fully public. The dialog is only reachable after solving, so it opens
// on the tab of the guest's own recorded difficulty.
//
// The population is small and bounded (the wedding's guests), so the board
// shows EVERYONE rather than a top-N: every returned row renders inside the
// list's own scrollable region, which flexes to fill the dialog's remaining
// height so the dialog stays within the viewport while the list scrolls. The
// backend cap (500) is a defensive ceiling well above any real board, so at
// wedding scale this is literally everyone. The fastest three get a
// gold/silver/bronze podium so the winners still get their moment even though
// all are shown.
//
// The list is the dialog's ONE scroller. The tabs stay fixed at the top and
// the list fills the rest of the dialog body (a flex column), so the list
// grows on a tall viewport and shrinks on a short one, but its last row is
// always reachable: there is no second, fixed-height scroller nested inside
// the body to clip the list's tail (the cause of an earlier bug where the
// final rank fell below the body's edge and could not be scrolled into view).
//
// When given the solver's own session id, the read also returns that solver's
// ranked row (the backend's viewer), so the dialog always shows them their
// place: highlighted in the list when they are within the (capped) items, and
// appended as a separated row with its true rank when they fall past it. On
// open, the list scrolls that highlighted row into view within its own
// scroll region (centered), so a guest who placed, say, 80th lands on
// themselves and can scroll up to who beat them and down to who is chasing.
// The viewer comes back only on the solver's own recorded-difficulty tab, so
// no per-tab special-casing is needed here.
//
// When the parent passes onRename (the solve has been posted), the solver's
// own row carries a pencil that swaps the name for an inline field. Only the
// name is editable; the time stays as the server recorded it.

import { Check, LifeBuoy, Pencil, Trophy, X } from "lucide-react";
import { useEffect, useLayoutEffect, useRef, useState } from "react";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogBody,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { useLeaderboard } from "@/hooks/queries/games";
import { formatDuration } from "@/libraries/format";
import { cn } from "@/libraries/utils";
import type { LeaderboardEntry } from "@/types/generated/games";

import {
  Difficulty,
  DIFFICULTY_LABELS,
  MAX_DISPLAY_NAME_LENGTH,
  PuzzleDifficulties,
} from "./puzzle";

interface LeaderboardDialogProps {
  difficulties: PuzzleDifficulties;
  /**
   * The tab to open on: the difficulty the guest's solve was recorded at.
   * Falls back to this puzzle's easiest available difficulty.
   */
  defaultDifficulty?: Difficulty;
  onOpenChange: (open: boolean) => void;
  /**
   * Rename the solver's posted entry. Present only once the solve is posted;
   * it resolves after the board refetches and rejects with a guest-facing
   * Error the row shows inline.
   */
  onRename?: (displayName: string) => Promise<void>;
  open: boolean;
  puzzleId: string;
  puzzleTitle: string;
  /**
   * The solver's own session id, when known. Passed to the read so the
   * backend returns the solver's own ranked row; the dialog then highlights
   * it in the list or appends it (with its true rank) when it falls past the
   * displayed items (only possible beyond the 500 cap). The viewer is returned
   * only on the solver's own recorded-difficulty tab, so other tabs render
   * plainly.
   */
  sessionId?: string;
}

export default function LeaderboardDialog({
  defaultDifficulty,
  difficulties,
  onOpenChange,
  onRename,
  open,
  puzzleId,
  puzzleTitle,
  sessionId,
}: LeaderboardDialogProps) {
  const anchoredDifficulty =
    defaultDifficulty && difficulties.includes(defaultDifficulty)
      ? defaultDifficulty
      : difficulties[0];
  const [difficulty, setDifficulty] = useState<Difficulty>(anchoredDifficulty);

  // Re-anchor to the solve's own difficulty each time the dialog opens, so a
  // tab explored on a previous open doesn't stick (the render-time adjustment
  // pattern from the React docs, same as CompletionDialog's error reset).
  const [wasOpen, setWasOpen] = useState(open);
  if (open !== wasOpen) {
    setWasOpen(open);
    if (open) {
      setDifficulty(anchoredDifficulty);
    }
  }

  const { data, isError, isPending } = useLeaderboard(
    puzzleId,
    difficulty,
    { enabled: open },
    sessionId,
  );

  // The backend sends viewer as null when there is no eligible solver (a
  // tab that is not the solver's, an anonymous read). A hidden solve appears
  // only in the personalized response carrying its exact session bearer.
  const viewer = data?.viewer;

  // The list's own scroll container and the viewer's row within it, for the
  // open-time auto-scroll. listRef is on the flex-fill wrapper that actually
  // scrolls (not the <ol>, which is now natural height inside it). The row ref
  // is set whether the viewer's row sits inside the displayed items or is the
  // appended off-list row, so either path centers the same way.
  const listRef = useRef<HTMLDivElement>(null);
  const viewerRowRef = useRef<HTMLLIElement>(null);

  // On open (and once the viewer's data arrives, and on a return to the
  // solver's own tab), bring the viewer's highlighted row into view within
  // the list's OWN scroll container. The list and the viewer's rank are the
  // dependencies: a tab switch swaps both, and the data arriving flips
  // items/viewer from undefined.
  const viewerRank = viewer?.rank;
  useEffect(() => {
    if (!open || viewerRank === undefined) {
      return;
    }
    // Measure and scroll on the next frame, not synchronously in the effect:
    // the dialog content is a Radix portal that remounts on each open, so on a
    // reopen the list/row nodes attach (and lay out) a beat after this effect
    // runs. Measuring now would read a not-yet-mounted scroll container and
    // silently no-op (the bug that left a reopened dialog stuck at the top);
    // the frame delay lets the fresh list lay out so the geometry is real.
    const frame = requestAnimationFrame(() => {
      const list = listRef.current;
      const row = viewerRowRef.current;
      if (!list || !row) {
        return;
      }
      // Scroll the list's own container, never row.scrollIntoView(): on the
      // single-column mobile layout scrollIntoView walks every scrollable
      // ancestor and would yank the dialog or the page, the same trap the clue
      // list hit. Only the list itself may move, and only when the row is not
      // already fully inside it (a podium finisher near the top is left put).
      const listRect = list.getBoundingClientRect();
      const rowRect = row.getBoundingClientRect();
      const fullyVisible =
        rowRect.top >= listRect.top && rowRect.bottom <= listRect.bottom;
      if (fullyVisible) {
        return;
      }
      // Center the row in the container: move its middle to the container's
      // middle. The browser clamps scrollTo to the scrollable range on its
      // own, so a row near either end lands as close to centered as it can.
      const rowCenter = rowRect.top + rowRect.height / 2;
      const listCenter = listRect.top + listRect.height / 2;
      list.scrollTo({
        behavior: "auto",
        top: list.scrollTop + (rowCenter - listCenter),
      });
    });
    return () => cancelAnimationFrame(frame);
  }, [open, viewerRank, data?.items]);

  return (
    <Dialog onOpenChange={onOpenChange} open={open}>
      <DialogContent
        data-testid="crossword-leaderboard-dialog"
        onEscapeKeyDown={(e) => {
          // Escape inside the rename field cancels the edit (the field's own
          // handler) instead of closing the dialog. Radix catches Escape at the
          // document before the field sees it, so the dismissal is vetoed here.
          if (
            e.target instanceof Element &&
            e.target.closest("[data-leaderboard-rename]")
          ) {
            e.preventDefault();
          }
        }}
      >
        <DialogHeader>
          <DialogTitle>Leaderboard</DialogTitle>
          <DialogDescription>
            {puzzleTitle}: the fastest posted solves at each difficulty.
          </DialogDescription>
        </DialogHeader>
        {/* The body is a flex column for this dialog so the tabs stay fixed
            at the top and the list below fills the remaining height as the
            single scroller (its base already has min-h-0 overflow-y-auto px-6,
            so with flex-col and children that fit, the body itself never
            overflows and its scroll is a no-op). This keeps one effective
            scroll container: a fixed-height list nested inside the body's own
            scroller used to clip the list's last row below the body's edge on a
            short viewport, leaving the final rank unreachable. */}
        <DialogBody className="flex flex-col py-4">
          {/* Styled as tabs, exposed as a pressed-button group: the same
              idiom as the other difficulty pickers (StartDialog, the
              more-menu), which keeps plain Tab/Enter operation honest
              instead of half-promising the ARIA tabs keyboard contract.
              shrink-0 keeps the tabs at their natural height, fixed above the
              flexing list. */}
          <div
            aria-label="Leaderboard difficulty"
            className="flex shrink-0 gap-1 rounded-md bg-secondary/20 p-1"
            role="group"
          >
            {difficulties.map((level) => (
              <button
                aria-pressed={difficulty === level}
                className={cn(
                  "flex-1 cursor-pointer rounded px-2 py-1 text-sm transition-colors",
                  difficulty === level
                    ? "bg-cream font-medium shadow-sm"
                    : "text-muted-foreground hover:text-ink",
                )}
                key={level}
                onClick={() => setDifficulty(level)}
                type="button"
              >
                {DIFFICULTY_LABELS[level]}
              </button>
            ))}
          </div>
          {isPending ? (
            <p className="mt-4 text-sm text-muted-foreground">
              Loading the fastest solvers...
            </p>
          ) : isError ? (
            <p className="mt-4 text-sm text-muted-foreground" role="alert">
              We couldn't load the leaderboard. Please try again in a bit.
            </p>
          ) : data.items.length === 0 && !viewer ? (
            <p className="mt-4 text-sm text-muted-foreground">
              No {DIFFICULTY_LABELS[difficulty].toLowerCase()} times posted yet.
              Be the first!
            </p>
          ) : (
            // The single scroll container: it flex-fills the height left under
            // the fixed tabs (min-h-0 lets it shrink below its content so it,
            // not the dialog body, owns the scroll) and holds the whole board,
            // the truncation note, and the appended off-list viewer row, so
            // everything scrolls together and the auto-scroll can center the
            // viewer whether it sits in the list or is the appended row. The
            // symmetric px-1 keeps a tinted row's 1px ring off the left/right
            // overflow edge, and py-1.5 gives the first and last rows the same
            // breathing room: without it the last row (and its ring) sits flush
            // against the overflow boundary and its time reads as clipped at the
            // bottom. The padding lands inside the scroll range, so scrolling to
            // the end reveals the last row in full.
            <div
              className="mt-4 min-h-0 flex-1 overflow-y-auto overscroll-contain px-1 py-1.5"
              data-testid="crossword-leaderboard-list"
              ref={listRef}
            >
              <ol className="space-y-1.5">
                {data.items.map((entry, index) => {
                  // The viewer (the solver's own row) is in the list when its
                  // rank falls within the displayed items; highlight that row
                  // rather than appending a duplicate below.
                  const isViewer =
                    Boolean(viewer) &&
                    viewer!.in_items &&
                    viewer!.rank === index + 1;
                  return (
                    // Other rows are keyed by rank: entries can share a name
                    // and a completion timestamp (the backend dedupes
                    // neither), and the list is replaced wholesale on refetch.
                    // The viewer's row gets a fixed key instead, so it stays
                    // the same mounted row across a rename (focus can return to
                    // its pencil) and an in-progress edit follows the viewer if
                    // a refetch moves their rank, rather than staying on
                    // whoever now holds the old position.
                    <Row
                      entry={entry}
                      isViewer={isViewer}
                      key={isViewer ? "viewer" : index}
                      onRename={isViewer ? onRename : undefined}
                      rank={index + 1}
                      rowRef={isViewer ? viewerRowRef : undefined}
                    />
                  );
                })}
              </ol>
              {data.total > data.items.length && (
                <p className="mt-3 text-xs text-muted-foreground">
                  Showing the fastest {data.items.length} of {data.total} posted
                  solves.
                </p>
              )}
              {/* The solver's rank is past the displayed items: show their own
                  row anyway, separated, with its true number. (Only reachable
                  past the 500 cap, i.e. never at wedding scale.) */}
              {viewer &&
                (viewer.in_items === false ||
                  viewer.rank > data.items.length) && (
                  <>
                    <div className="my-3 border-t border-dashed" />
                    <ol className="space-y-1.5">
                      <Row
                        entry={viewer.entry}
                        isViewer
                        onRename={onRename}
                        rank={viewer.rank}
                        rowRef={viewerRowRef}
                      />
                    </ol>
                  </>
                )}
            </div>
          )}
        </DialogBody>
        <DialogFooter>
          <Button
            onClick={() => onOpenChange(false)}
            type="button"
            variant="outline"
          >
            Close
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/**
 * The gold/silver/bronze treatment for the top three ranks, keyed by rank.
 * Each place tints the WHOLE ROW the way the blue "You" highlight does, just in
 * its metal: a filled background plus a ring at the same intensity as the
 * viewer's `bg-secondary/40` + `ring-secondary`, so a podium row reads as a
 * place-colored sibling of the "You" row rather than a separate widget. The
 * `badge` recolors the "You" pill to the place (so a top-three viewer's badge
 * is gold/silver/bronze, never blue), and `trophy` tints the small trophy that
 * hugs the rank number. The tones are saturated enough to register as their
 * metal at a glance (a washed-out pastel reads as neither gold nor silver)
 * while staying warm next to the cream/ink wedding palette: amber for gold,
 * slate for silver, and orange for bronze (kept distinct from gold's amber).
 */
const PODIUM: Record<
  number,
  { badge: string; label: string; row: string; trophy: string }
> = {
  1: {
    // Gold: a warm amber wash with a deeper amber ring; the badge is a solid
    // amber pill with near-black text, and the trophy a mid amber.
    badge: "bg-amber-400 text-amber-950",
    label: "1st place",
    row: "bg-amber-300/45 ring-1 ring-amber-400",
    trophy: "text-amber-600",
  },
  2: {
    // Silver: a cool slate wash kept dark enough to read as metal on cream (the
    // usual silver-on-light trap is too pale a gray), ring and trophy to match.
    badge: "bg-slate-400 text-slate-950",
    label: "2nd place",
    row: "bg-slate-300/55 ring-1 ring-slate-400",
    trophy: "text-slate-600",
  },
  3: {
    // Bronze: a copper-orange wash, distinct from gold's amber so the two warm
    // metals don't blur together, with a deeper orange ring and trophy.
    badge: "bg-orange-400 text-orange-950",
    label: "3rd place",
    row: "bg-orange-300/45 ring-1 ring-orange-400",
    trophy: "text-orange-700",
  },
};

/**
 * One leaderboard line, laid out as: rank unit (trophy + number), name, time.
 * The fastest three tint the whole row gold/silver/bronze the same way the
 * viewer's "You" row tints blue (a background + ring), and a small trophy hugs
 * the left of the rank number. The rank number itself is the same muted "{rank}."
 * on every row, right-aligned within a fixed-width unit, so the numbers (and the
 * names after them) line up in one column straight down the list whether or not
 * a row is a podium row; the trophy floats to the number's left without pushing
 * it. The solver's own row carries a "You" badge so they can spot their place,
 * whether it sits inside the displayed list or is the appended off-list row
 * below the separator. The two treatments compose: a non-podium viewer is blue
 * (row tint + ring and a blue badge); a top-three viewer is the place color
 * throughout (place row tint + ring, a place-colored badge, the place trophy),
 * with zero blue. rowRef is set on the viewer's row so the dialog can center it
 * on open. onRename (the viewer's posted row only) adds the pencil that edits
 * the name in place.
 */
function Row({
  entry,
  isViewer,
  onRename,
  rank,
  rowRef,
}: {
  entry: LeaderboardEntry;
  isViewer: boolean;
  onRename?: (displayName: string) => Promise<void>;
  rank: number;
  rowRef?: React.Ref<HTMLLIElement>;
}) {
  const podium = PODIUM[rank];
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Leaving the edit (save or cancel) unmounts the field that held focus, so
  // hand focus back to the pencil instead of letting it fall to <body>.
  const pencilRef = useRef<HTMLButtonElement>(null);
  const wasEditing = useRef(false);
  useLayoutEffect(() => {
    if (wasEditing.current && !editing) {
      pencilRef.current?.focus();
    }
    wasEditing.current = editing;
  }, [editing]);

  const trimmed = draft.trim();
  const tooLong = trimmed.length > MAX_DISPLAY_NAME_LENGTH;
  const valid = trimmed.length > 0 && !tooLong;

  const startEditing = () => {
    setDraft(entry.display_name);
    setError(null);
    setEditing(true);
  };

  const save = async () => {
    if (!onRename || !valid || saving) {
      return;
    }
    if (trimmed === entry.display_name) {
      setEditing(false);
      return;
    }
    setSaving(true);
    setError(null);
    try {
      await onRename(trimmed);
      setEditing(false);
    } catch (err) {
      setError(
        err instanceof Error && err.message
          ? err.message
          : "We couldn't change your name right now. Please try again.",
      );
    } finally {
      setSaving(false);
    }
  };

  return (
    <li
      className={cn(
        // Every row carries the same padding so the rank/name/time columns line
        // up across plain, podium, and viewer rows; both highlights below are a
        // background + ring only, never extra padding, so a tinted row never
        // shifts its contents out of alignment with its neighbors.
        "flex items-center gap-3 rounded px-2 py-1 text-sm",
        // Row tint: a podium row wears its place color; otherwise the viewer's
        // own row wears the blue "You" highlight; a plain row stays untinted.
        podium
          ? cn("font-medium", podium.row)
          : isViewer && "bg-secondary/40 font-medium ring-1 ring-secondary",
      )}
      ref={rowRef}
    >
      {/* The rank unit: a fixed-width, right-aligned slot holding the trophy
          (podium rows only) immediately left of the number. Right-justifying
          inside a fixed width keeps every "{rank}." period in one column and
          the names starting at the same x, podium or not; the single-digit
          podium trophies line up with each other on the number's left. The
          width fits the trophy plus the largest rank that can occur (the
          appended off-list viewer row can run to four digits) without wrapping. */}
      <span className="flex w-16 shrink-0 items-center justify-end gap-1">
        {podium && (
          <Trophy
            aria-hidden="true"
            className={cn("size-4 shrink-0", podium.trophy)}
            data-testid="podium-trophy"
          />
        )}
        {/* One shared rank-number style for every row (podium and plain alike):
            muted, right-aligned, tabular figures, so the numbers form a single
            tidy column; only the trophy to its left changes for the podium. */}
        <span className="text-right text-muted-foreground tabular-nums">
          {rank}.
        </span>
      </span>
      {/* A visually hidden, labelled marker so a screen reader announces "Nth
          place" on podium rows (the trophy itself is decorative); non-podium
          rows have none. aria-label (not just text) keeps it reachable as an
          accessible name, the same hook the tests assert against. */}
      {podium && <span aria-label={podium.label} className="sr-only" />}
      {editing ? (
        // The field and its buttons are 24px, the same height as the resting
        // row's pencil, so the row keeps its height while editing and the rows
        // below don't shift.
        <form
          className="flex min-w-0 flex-1 flex-col gap-1"
          data-leaderboard-rename
          onSubmit={(e) => {
            e.preventDefault();
            void save();
          }}
        >
          <span className="flex items-center gap-1">
            <Input
              aria-label="Display name"
              autoFocus
              // Only the height and padding are trimmed: the base font size
              // stays 16px on mobile so iOS doesn't zoom in on focus.
              className="h-6 min-w-0 flex-1 px-2 py-0"
              disabled={saving}
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={(e) => {
                // The dialog vetoes its own Escape dismissal for this form (see
                // onEscapeKeyDown above), so Escape only cancels the edit.
                if (e.key === "Escape") {
                  setEditing(false);
                }
              }}
              value={draft}
            />
            <button
              aria-label="Save name"
              className="flex size-6 shrink-0 cursor-pointer items-center justify-center rounded text-ink hover:bg-rose/20 disabled:cursor-not-allowed disabled:opacity-50"
              disabled={!valid || saving}
              type="submit"
            >
              <Check aria-hidden className="size-4" />
            </button>
            <button
              aria-label="Cancel renaming"
              className="flex size-6 shrink-0 cursor-pointer items-center justify-center rounded text-muted-foreground hover:bg-rose/20 hover:text-ink"
              disabled={saving}
              onClick={() => setEditing(false)}
              type="button"
            >
              <X aria-hidden className="size-4" />
            </button>
          </span>
          {(tooLong || error) && (
            <span className="text-xs font-normal text-destructive" role="alert">
              {tooLong
                ? `Please keep your name under ${MAX_DISPLAY_NAME_LENGTH} characters.`
                : error}
            </span>
          )}
        </form>
      ) : (
        <span className="flex min-w-0 flex-1 items-center gap-2">
          <span className="min-w-0 truncate font-medium">
            {entry.display_name}
          </span>
          {entry.used_checks && (
            <span
              aria-label="Used checks"
              className="flex shrink-0 items-center text-blue"
              title="Used checks"
            >
              <LifeBuoy aria-hidden className="size-3.5" />
            </span>
          )}
          {isViewer && (
            <span
              className={cn(
                // The "You" pill takes the place color on a top-three viewer (no
                // blue), or the blue secondary on a non-podium viewer.
                "shrink-0 rounded-full px-1.5 text-xs font-medium",
                podium
                  ? podium.badge
                  : "bg-secondary text-secondary-foreground",
              )}
            >
              You
            </span>
          )}
          {onRename && (
            <button
              aria-label="Change your name"
              className="flex size-6 shrink-0 cursor-pointer items-center justify-center rounded text-muted-foreground hover:bg-rose/20 hover:text-ink"
              onClick={startEditing}
              ref={pencilRef}
              title="Change your name"
              type="button"
            >
              <Pencil aria-hidden className="size-3.5" />
            </button>
          )}
        </span>
      )}
      {/* While editing on a narrow screen the time yields its width to the
          name field; the edit never touches the time, and it returns on save. */}
      <span
        className={cn("shrink-0 tabular-nums", editing && "hidden sm:inline")}
      >
        {formatDuration(entry.elapsed_ms)}
      </span>
    </li>
  );
}
