# Go is the single source of truth for API types

Every request and response that crosses the API boundary is a named, exported Go struct, and tygo generates the TypeScript the frontend imports. The frontend never hand-writes a type that mirrors an API shape. Generated output is not committed; it is regenerated on demand.

Go already owns the persistence models and the request validation, so making it own the wire types too means a backend shape change surfaces as a TypeScript compile error instead of drifting silently into a runtime bug.

## Considered Options

- **Hand-written TypeScript mirroring the Go types**: rejected. The two sides drift the moment someone changes one and forgets the other, and the failure is silent until it reaches a user (the shisho repo hit exactly this, where a relation typed as objects on the frontend was actually returned as strings).
- **A shared schema (OpenAPI or JSON Schema) with codegen on both sides**: rejected as heavier machinery than a Go-first app with a single coupled SPA needs.
- **tygo from the Go structs** (chosen): a thin generator that projects the existing Go types to TypeScript, with no second schema to maintain.

## Conventions

These are enforced in `pkg/CLAUDE.md` and `app/CLAUDE.md`:

- Handlers never return anonymous structs, `echo.Map`, or `map[string]any`. Every payload is a named type in the package's `types.go`.
- A response struct embeds its `*models.X` via `tstype:",extends"`; a relation the response reshapes is hidden from the model's generated TypeScript with `tstype:"-"`.
- List endpoints return a uniform `{ items, total }` envelope.
- Enum fields carry a `tstype` hint pointing at a `//tygo:emit` union; those unions live beside the model in `pkg/models`.
- Pure-acknowledgment endpoints return `204 No Content` rather than a cosmetic body.
- Response types are named `{Entity}Response`, `List{Entities}Response`, and `{Entity}ListItem` for a divergent list row.

## Consequences

- Generated output (`app/types/generated/`) is a build artifact: gitignored, produced by `mise tygo`, and regenerated in CI before the JavaScript checks. Committing it would invite stale diffs and review noise.
- Errors cross the boundary the same way. `pkg/errcodes` defines the HTTP error codes and a `//tygo:emit ErrorCode` union, so the frontend can branch on `error.code` exhaustively.
- A new API type is added once, in Go. The frontend imports it; it never redefines it.
