# 0005 — Validate everything with Zod, answer in one error envelope

- **Status:** accepted
- **Date:** 2026-11-15

## Context

An HTTP surface has to decide what to do with unknown fields, malformed queries and invalid paths.
Hono's default is a plain `400` with no body, which is useless to a client and invisible in a UI.

## Decision

Every route validates through `@hono/zod-validator` with schemas from `@spaces/shared`, using
`.strict()` so unknown keys are rejected rather than ignored. A single `validate()` wrapper converts
failures into the `ErrorEnvelope` from `@spaces/shared`, choosing the code from the failure rather than
always saying `invalid_body`:

| Situation                          | Code                                      |
| ---------------------------------- | ----------------------------------------- |
| unknown key in a query             | `400 invalid_query` (names the parameter) |
| unknown key or bad type in a body  | `400 invalid_body`                        |
| path escapes the sandbox roots     | `400 invalid_path`                        |
| sandbox is not in a runnable state | `409 sandbox_not_ready`                   |

## Consequences

- A typo'd query parameter produces `invalid_query` naming it, instead of a silently ignored field
  that makes the client believe it asked for something.
- The same schemas feed `CreateSandboxRequest` in the UI, so client-side and server-side rules agree.
- Adding a field means touching `packages/shared` first; the compiler then points at every call site.
- Strictness is a small compatibility risk: a client that sends a field the schema does not name gets
  a `400` until the schema learns it. Accepted — every tolerated field is named on purpose (0021), so
  drift surfaces immediately instead of hiding.

## Alternatives considered

- **Loose schemas (`passthrough`)** — rejected: silently accepting a misspelled filter is how clients
  ship bugs.
- **Per-route hand-written validation** — rejected: 40+ shapes, one source of truth is the only way
  they stay consistent with the web app.
