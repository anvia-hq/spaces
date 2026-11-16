# 0023 — Console: local-first auth, one accent, inline confirmation

- **Status:** accepted, partly superseded by 0026 (primitive kit, token names, destructive confirmation)
- **Date:** 2026-11-15

## Context

The console's job is to make the whole API reachable without a terminal. It was rebuilt once the API had
grown from six routes to sixty, and the first version had already accumulated the usual problems: a
default font stack, six competing accent colours, bordered cards everywhere, no loading or empty states,
and a delete button that fired on first click with no confirmation.

## Decision

**Auth** — the key lives in `localStorage`, defaulting to `spk_local_dev` so a local install needs no
sign-in; a header control points it at another server and reloads. No sessions, no cookies (0022).

**Structure** — a top navigation bar (not a permanent sidebar) and a **tabbed sandbox workspace**:
Terminal, Files, Ports, SSH, Snapshots, Usage, Events. One tab per job, so a new capability gets a home
instead of growing a monolith page.

**Visual system** — self-hosted Instrument Sans and JetBrains Mono (no CDN request, works offline), one
accent colour, warm charcoal surfaces, state pills that tint only the dot, and tabular figures for
anything numeric. Design tokens live in `@theme` so no component invents a colour.

**Interaction** — destructive actions **arm inline** ("Delete? → Delete / Cancel", auto-disarming after
4 s) instead of firing immediately or opening a modal. Every panel has a written empty state and a
skeleton, never a blank box or the word "Loading…".

## Consequences

- The UI cannot lie about capability: each tab maps to endpoints that exist, and the Ports tab shows only
  ports someone actually published (0021).
- Keyboard and screen-reader basics are in place: a skip link, one focus ring, `aria-pressed` on
  toggles, labelled icon buttons, a real 404 page.
- Inline confirmation is cheaper than a modal and harder to click through by accident, but it cannot
  express consequences ("this deletes the disk"), which is why the destructive actions are worded
  explicitly.
- Dark only. A light theme would have to be threaded through the `@theme` tokens; it is deliberately not
  a toggle bolted on.
- Zero state-management dependency: `usePoll` keeps the last good value and marks it stale on failure,
  which is enough for an operator console and keeps the bundle at ~330 KB.

## Alternatives considered

- **A component library.** Rejected: 40+ bespoke states and a design language that has to match a
  terminal-heavy product.
- **Trusting one health endpoint for connectivity.** Tried, and it lied: `/health` was not in the Vite
  proxy, so it returned the SPA's HTML with a 200 and the header declared a healthy API dead. The
  indicator now falls back to an authenticated call before saying "unreachable".
