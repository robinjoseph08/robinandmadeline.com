# Backend conventions (pkg/)

The Go backend is Echo + Bun on Postgres. These conventions keep the API typed end to end (ADR 0008) and errors consistent. They mirror the shisho reference repo.

## Packages

- Persistent Bun models live in `pkg/models`, which imports no feature package so every feature can import it without a cycle. Domain enums and derived-state logic (for example the info-collection status state machine) live on the model in `pkg/models`, next to the data they read.
- Each feature package (for example `pkg/parties`) holds its service, handlers, routes, and a `types.go`.

## API types

- Define every request, response, and query type for a package in its `types.go`. Handlers never return anonymous structs, `echo.Map`, or `map[string]any`.
- A response is a named `{Entity}Response` that embeds its `models.X` by value via `tstype:",extends"` (a pointer embed would make tygo emit `extends Partial<models.X>`, turning every model field optional on the client) and adds only derived fields. List endpoints return `List{Entities}Response`, a `{ items, total }` envelope (an empty list serializes `items` as `[]`, never `null`).
- Status codes: create returns 201, update 200, a pure acknowledgment (delete) returns 204 No Content.
- Closed enum value sets get consts plus a `//tygo:emit` union in `pkg/models`, and the field carries a `tstype` hint. Open-ended sets (guest tags) stay `[]string`.
- After changing a model or a `types.go`, regenerate the frontend types with `mise tygo`. The output is gitignored (ADR 0008).

## Request validation (the binder)

- Handlers bind every request with a single `c.Bind(&payload)`. The custom binder in `pkg/binder` runs the whole pipeline: bind (JSON body, or query string for GET/DELETE) then mold modifiers (`mod` tags) then creasty defaults (`default` tags) then validator/v10 (`validate` tags). It is wired once via `e.Binder` in `pkg/server`.
- Struct tags are the spec. Validate with `validate` (`required`, `omitempty`, `oneof=...`, `min`/`max`, `email`, `dive`, the custom `date`/`url`/`emailblank`/`phone`); normalize with `mod` (`trim`, and `dive` to reach slice elements); fill with `default` (e.g. `default:"[]"` to make a nil slice store `'{}'`). Query filters add a `query:"..."` alias (gorilla/schema) and stay pointers so "absent" is distinguishable.
- A slice field needs `mod:"dive"` for any inner `mod` to fire, and `validate:"...,dive,..."` for any inner rule to run; the two are independent and both go on the same field. See `pkg/binder/binder_test.go`.
- Never hand-roll request validation (required/enum/trim/type checks) in handlers or services. On a bind failure a handler returns `errors.WithStack(err)`; the binder already produced the right errcode (422 `ValidationError`/`UnknownParameter`/`ValidationTypeError`, 400 `MalformedPayload`/`EmptyRequestBody`, 415 `UnsupportedMediaType`) and the shared handler renders it. Services assume the payload is already bound, modified, defaulted, and validated, and only enforce non-validation business rules (uniqueness 409s, the completion gate, the single-primary transaction).
- A model-level invariant that must hold regardless of code path (e.g. a NOT NULL `text[]` never NULL) belongs on the model via a bun `BeforeAppendModel` hook, not in handlers. `default:"[]"` covers the HTTP path; the hook covers direct service calls. See `models.Party`/`models.Guest`.

## Errors

- Return a `pkg/errcodes` constructor (`NotFound`, `BadRequest`, `ValidationError`, `Conflict`, `Unauthorized`, `Forbidden`, `Internal`, plus the binder's `UnknownParameter`, `ValidationTypeError`, `MalformedPayload`, `EmptyRequestBody`, `UnsupportedMediaType`). Never `echo.NewHTTPError`.
- Wrap infrastructure errors with `github.com/pkg/errors` (`errors.Wrap` / `errors.WithStack`) so a stack reaches the logs.
- The single `e.HTTPErrorHandler` (`errcodes.NewHandler().Handle`) renders the `{ "error": { code, message, status_code } }` envelope and logs only 5xx, through the request-scoped logger (the request method/path/route ride on it, and `.Err(err)` attaches the stack). Do not log expected 4xx, and never put an internal error's text in a 500 response body. Client-disconnect and `context.Canceled` errors are dropped via `golib/errutils.IsIgnorableErr`.
- A Postgres unique violation becomes a 409 through `errcodes.ConflictOnUnique`.

## Migrations

- Register Go migrations in `pkg/migrations`. Apply them with `mise db:migrate` (the CLI is `cmd/migrations`).
- The server does not migrate at startup. Production migrates via the Fly release_command (ADR 0007); local dev migrates through `mise start`.

## Logging and runtime

These adopt `github.com/robinjoseph08/golib`, mirroring the shisho reference repo, in place of stdlib slog and our hand-rolled equivalents.

- Logging is `golib/logger` (zerolog under the hood). Construct a base logger with `logger.New()` (it reads `LOG_LEVEL`/`LOG_FORMAT` from the environment); emit with `.Info`/`.Warn`/`.Error`/`.Debug`/`.Fatal`, chaining `.Err(err)` for the error and stack and `.Data(logger.Data{...})` for structured fields.
- Inside a request, use the request-scoped logger, not a fresh `logger.New()`: `logger.FromEchoContext(c)` (or `logger.FromContext(ctx)`) returns the logger that `logger.Middleware()` injected, already tagged with a request ID and the request method/path/route. Outside a request (or where no `echo.Context` is in scope), `logger.FromContext` falls back to a default `logger.New()`.
- The server wires middleware in this order: `logger.Middleware()` (request-scoped logger + request logging), `recovery.Middleware()` (funnels panics into the error handler as 500s), then echo's `middleware.CORS()`. The first two are golib's; CORS stays echo's.
- Graceful shutdown uses `golib/signals.Setup()`, which returns a channel closed on the first SIGINT/SIGTERM and `os.Exit(1)`s on the second.
- Build optional-field and test-fixture pointers with `golib/pointerutil` (`String`/`Int`/`Bool`/`Float64`/`Time`, plus `EmptyString`/`Equal`/`EqualSlices`). Always prefer a `pointerutil` constructor over writing a new pointer helper or using inline `&v`; if you need one it does not have, add it to `golib` rather than rolling a local helper.
- Two write conventions for optional text differ deliberately, by HTTP verb. The full-state create/update (`POST`/`PUT`) payloads store an optional text field as bound: a present-but-blank value persists as `""` (the status logic treats blank as absent), and `rsvp_code` relies instead on explicit JSON null plus `min=1` so a blank code is a 422 and "no code" arrives as null. The partial-update (`PATCH`) payloads, which back the spreadsheet grid, treat a provided blank as the "clear this cell" gesture and store SQL NULL via `pointerutil.EmptyString` for every nullable text field. This is what lets a cleared `rsvp_code` cell leave the partial unique index (`WHERE rsvp_code IS NOT NULL`) instead of colliding on `""`; for the other fields NULL and `""` are status-equivalent, and in practice the dialog omits blank fields so both paths converge on NULL. A create with no `rsvp_code` auto-generates one (5 uppercase letters from an unambiguous, no-vowel alphabet), so NULL codes arise only from the PATCH clear and a cleared code stays NULL, never regenerated.
