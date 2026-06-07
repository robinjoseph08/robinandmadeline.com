# Backend conventions (pkg/)

The Go backend is Echo + Bun on Postgres. These conventions keep the API typed end to end (ADR 0008) and errors consistent. They mirror the shisho reference repo.

## Packages

- Persistent Bun models live in `pkg/models`, which imports no feature package so every feature can import it without a cycle. Domain enums and derived-state logic (for example the info-collection status state machine) live on the model in `pkg/models`, next to the data they read.
- Each feature package (for example `pkg/parties`) holds its service, handlers, routes, and a `types.go`.

## API types

- Define every request, response, and query type for a package in its `types.go`. Handlers never return anonymous structs, `echo.Map`, or `map[string]any`.
- A response is a named `{Entity}Response` that embeds its `*models.X` via `tstype:",extends"` and adds only derived fields. List endpoints return `List{Entities}Response`, a `{ items, total }` envelope (an empty list serializes `items` as `[]`, never `null`).
- Status codes: create returns 201, update 200, a pure acknowledgment (delete) returns 204 No Content.
- Closed enum value sets get consts plus a `//tygo:emit` union in `pkg/models`, and the field carries a `tstype` hint. Open-ended sets (guest roles) stay `[]string`.
- After changing a model or a `types.go`, regenerate the frontend types with `mise tygo`. The output is gitignored (ADR 0008).

## Errors

- Return a `pkg/errcodes` constructor (`NotFound`, `BadRequest`, `ValidationError`, `Conflict`, `Unauthorized`, `Forbidden`, `Internal`). Never `echo.NewHTTPError`.
- Wrap infrastructure errors with `github.com/pkg/errors` (`errors.Wrap` / `errors.WithStack`) so a stack reaches the logs.
- The single `e.HTTPErrorHandler` renders the `{ "error": { code, message, status_code } }` envelope and logs only 5xx (with the request method, path, and stack). Do not log expected 4xx, and never put an internal error's text in a 500 response body.
- A Postgres unique violation becomes a 409 through `errcodes.ConflictOnUnique`.

## Migrations

- Register Go migrations in `pkg/migrations`. Apply them with `mise db:migrate` (the CLI is `cmd/migrations`).
- The server does not migrate at startup. Production migrates via the Fly release_command (ADR 0007); local dev migrates through `mise start`.
