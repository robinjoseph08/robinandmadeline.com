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

## Request validation (the binder)

- Handlers bind every request with a single `c.Bind(&payload)`. The custom binder in `pkg/binder` runs the whole pipeline: bind (JSON body, or query string for GET/DELETE) then mold modifiers (`mod` tags) then creasty defaults (`default` tags) then validator/v10 (`validate` tags). It is wired once via `e.Binder` in `pkg/server`.
- Struct tags are the spec. Validate with `validate` (`required`, `omitempty`, `oneof=...`, `min`/`max`, `email`, `dive`, the custom `date`/`url`); normalize with `mod` (`trim`, and `dive` to reach slice elements); fill with `default` (e.g. `default:"[]"` to make a nil slice store `'{}'`). Query filters add a `query:"..."` alias (gorilla/schema) and stay pointers so "absent" is distinguishable.
- A slice field needs `mod:"dive"` for any inner `mod` to fire, and `validate:"...,dive,..."` for any inner rule to run; the two are independent and both go on the same field. See `pkg/binder/binder_test.go`.
- Never hand-roll request validation (required/enum/trim/type checks) in handlers or services. On a bind failure a handler returns `errors.WithStack(err)`; the binder already produced the right errcode (422 `ValidationError`/`UnknownParameter`/`ValidationTypeError`, 400 `MalformedPayload`/`EmptyRequestBody`, 415 `UnsupportedMediaType`) and the shared handler renders it. Services assume the payload is already bound, modified, defaulted, and validated, and only enforce non-validation business rules (uniqueness 409s, the completion gate, the single-primary transaction).
- A model-level invariant that must hold regardless of code path (e.g. a NOT NULL `text[]` never NULL) belongs on the model via a bun `BeforeAppendModel` hook, not in handlers. `default:"[]"` covers the HTTP path; the hook covers direct service calls. See `models.Party`/`models.Guest`.

## Errors

- Return a `pkg/errcodes` constructor (`NotFound`, `BadRequest`, `ValidationError`, `Conflict`, `Unauthorized`, `Forbidden`, `Internal`, plus the binder's `UnknownParameter`, `ValidationTypeError`, `MalformedPayload`, `EmptyRequestBody`, `UnsupportedMediaType`). Never `echo.NewHTTPError`.
- Wrap infrastructure errors with `github.com/pkg/errors` (`errors.Wrap` / `errors.WithStack`) so a stack reaches the logs.
- The single `e.HTTPErrorHandler` renders the `{ "error": { code, message, status_code } }` envelope and logs only 5xx (with the request method, path, and stack). Do not log expected 4xx, and never put an internal error's text in a 500 response body.
- A Postgres unique violation becomes a 409 through `errcodes.ConflictOnUnique`.

## Migrations

- Register Go migrations in `pkg/migrations`. Apply them with `mise db:migrate` (the CLI is `cmd/migrations`).
- The server does not migrate at startup. Production migrates via the Fly release_command (ADR 0007); local dev migrates through `mise start`.
