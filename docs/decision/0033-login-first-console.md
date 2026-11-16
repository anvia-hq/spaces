# 0033 — Login-first, one sidebar: the console's shape

- **Status:** accepted
- **Date:** 2026-11-16
- **Supersedes (partly):** 0023, 0026

## Context

The console grew a page at a time, and the frame grew with it. A signed-out visitor saw the whole
product before being asked anything: a top navigation bar, a status strip, a connection chip and an
"API key required" banner all rendered around empty tables. Every one of those elements was a
reasonable local decision and a poor global one — there was no single moment that said "you are not
signed in yet".

The same drift showed up in the layout: five of six pages were `gap-7` and two were `gap-6`; the
sandbox detail header was 26px where every other page header was 28px; and each page carried its own
container width, so content shifted horizontally between routes.

## Decision

**Gate at the root.** `__root.tsx` resolves auth once and renders exactly one of three things:
a boot frame while the session is resolving, the auth screen, or the shell. No route renders before
that decision, so no page can forget the check and there is no "sign in to see this" state to design.

**Session-only.** A session is the only way in. An earlier draft offered a "Use an operator key
instead" disclosure on the auth screen, for local development where no account exists yet; it was
removed. Two credentials that both mean "signed in" is a question the UI then has to answer
everywhere — which account, which resources, which actions — and it left a stored key able to bypass
the gate entirely. Signing up locally is one extra step and removes the ambiguity.

The console also seeds no credential and sends no bearer: requests carry the session cookie and
nothing else. The operator key remains a server-side credential for API clients; it is simply not
this UI's business.

**One sidebar, one column.** A 248px fixed sidebar holds the brand, two nav groups (Workspace:
Sandboxes, Snapshots, API keys · Observability: Traces, Audit log), a connection line and the account
block. Below `lg` it becomes a sheet behind a menu button. The content column is a single
`max-w-[1180px]` with consistent padding, and pages own their headers — no global top bar competing
with a per-page header.

**Consistency by making it measurable.** All pages use `gap-6`; `PageHeader` (28px/1.1, eyebrow,
description, actions) is the only page-level heading, including the sandbox detail; empty, loading and
error states come from the shared `EmptyState`/`Skeleton`/`Notice` primitives. Anything that duplicated
the frame — `KeyBanner`, `KeyDialog`, `StatusStrip`, `AccountChip`, `ConnectionChip`, the standalone
`/login` route — was deleted rather than restyled.

## Consequences

- The first screen is a decision, not a tour: one card, one primary action, and a status line that says
  whether the API is even reachable, so a failed sign-in is diagnosable.
- Sign-out is always one click away in a fixed place, and it clears both the session and any stored key.
- Visual verification is impossible in this environment (no browser), so the design leans on
  conventional, boring patterns — sidebar navigation, one column, one accent — rather than novel
  layout. The risk of an unconventional idea failing unseen is not worth it.
- A browser that stored an operator key from an earlier console is now simply signed out: nothing
  reads that key, so the gate cannot be bypassed by stale state.
- The console now requires the API's auth surface to answer. If `/api/auth` is unreachable the gate
  cannot resolve and shows the boot frame; the auth screen's status line is what tells you why.
- Removing the `/login` route is safe because signed-out state is no longer a route. A bookmark to it
  falls through to the gate.

## Alternatives considered

- **Per-route guards** (`beforeLoad` redirects). Rejected: seven places to get right, and a new page
  could ship without one. The root gate is one decision.
- **Keep the top navigation, add a login page.** Rejected: it is the shape that produced the problem —
  the product visible before sign-in.
- **A marketing landing page for signed-out visitors.** Rejected: this is a self-hosted operator tool;
  the only useful next action is signing in.
- **Modal sign-in over the shell.** Rejected: it renders the very thing that should not exist yet.
- **Operator key on the auth screen.** Tried and removed: it made "signed in" mean two different
  things, and a stored key silently skipped the gate.
