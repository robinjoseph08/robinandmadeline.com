# Frontend conventions (app/)

The frontend is a React SPA (React Router, plain fetch). It consumes a Go API whose types are generated, not hand-written.

## API types

- API request and response types are generated from Go by tygo (ADR 0008). Import them from `app/types/generated`. Never hand-write a type that mirrors an API shape; if one is missing, add the Go struct and run `mise tygo`.
- Generated output is gitignored and is a build artifact. Run `mise tygo` to produce it (CI runs it before the JavaScript checks). Do not edit generated files.

## API access

- All API calls go through `apiRequest` in `app/libraries/api.ts`, which attaches the admin bearer token and throws `ApiError` carrying the backend's `code` and `message` from the `{ error: { ... } }` envelope.
- List endpoints return `{ items, total }`; type list consumers off the generated `List{Entities}Response`.
