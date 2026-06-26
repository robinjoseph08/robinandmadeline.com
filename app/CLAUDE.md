# Frontend conventions (app/)

The frontend is a React SPA (React Router, plain fetch). It consumes a Go API whose types are generated, not hand-written.

## API types

- API request and response types are generated from Go by tygo (ADR 0008). Import them from `app/types/generated`. Never hand-write a type that mirrors an API shape; if one is missing, add the Go struct and run `mise tygo`.
- Generated output is gitignored and is a build artifact. Run `mise tygo` to produce it (CI runs it before the JavaScript checks). Do not edit generated files.

## API access

- All API calls go through `apiRequest` in `app/libraries/api.ts`, which sends/parses JSON and throws `ApiError` carrying the backend's `code` (typed as the generated `ErrorCode` union) and `message` from the `{ error: { ... } }` envelope. Admin endpoints use `adminRequest` in `app/libraries/admin-api.ts`, which layers the stored admin bearer token and query-string serialization on top of `apiRequest`.
- List endpoints return `{ items, total }`; type list consumers off the generated `List{Entities}Response`.

## Page titles

- Every routed page sets the browser tab title with a hook from `app/hooks/usePageTitle.ts`. Segments are joined by a middot and the app name comes last: `usePageTitle("Schedule")` renders `Schedule · Robin & Madeline`. Call it once near the top of the page component.
- Guest-facing pages use `usePageTitle`. Admin pages use `useAdminPageTitle`, which inserts an `Admin` segment so back-office tabs are distinguishable: `useAdminPageTitle("Guests")` renders `Guests · Admin · Robin & Madeline`.
- List/content pages pass a static label (`"Schedule"`, `"Guests"`). Detail pages pass the entity name from their query data (`useAdminPageTitle(party?.name)`); pass `undefined` while it loads and the hook falls back to just the app name (or `Admin · Robin & Madeline`). Call the hook before any early return so it runs unconditionally.
- The home page calls `usePageTitle()` with no argument so its tab reads just `Robin & Madeline`.

### Link previews (server-side mirror)

- `usePageTitle` only updates the title after the JS runs, which link-preview crawlers (iMessage, Slack, Facebook) and search engines never do: they read the HTML the server returns. So for the public, shareable pages the title and an Open Graph/Twitter description are also injected server-side, per route, into the SPA shell. That table is `publicPageMeta` in `pkg/server/static.go`.
- This means a shareable page's title lives in two places: the `usePageTitle(...)` call here and the `publicPageMeta` entry in Go. When you add a shareable landing route or rename one of these labels, update both.
- The puzzle pages (`/games/:slug`) each get their own title server-side from the `puzzlePageTitles` table in `pkg/server/static.go`, mirroring the `PUZZLES_BY_SLUG` registry and the `usePageTitle(puzzle?.title)` call (`app/components/library/crossword/puzzles.ts`). They are gated by `RequireGamesAccess`, so for now they are served `noindex`; when that gate is removed and the games are public, drop the `addNoindex` in the puzzle branch of `injectMeta` so they are indexed like the `/games` landing. Add a row when you add a puzzle, and keep the titles in sync.
- Some routes are served `noindex` but still get a generic, guest-data-free title so a shared link previews sensibly: the per-guest token/UUID links (`/i/:token`, `/u/:guestId`, matched by prefix since their tail is opaque) and the RSVP flow steps (`/rsvp/form`, `/rsvp/confirmation`, matched exactly). Those titles live in `noindexTitlePrefixes` / `noindexTitleExact` in `pkg/server/static.go`, mirroring the pages' `usePageTitle(...)` labels (keep them in sync); they get a title only, no description.
- The login-gated admin routes are the exception that needs no Go entry: served `noindex` with the default title, since they are never shared and `useAdminPageTitle` handles the tab title client-side.
