# 0045 — The operator's console: one Cluster page, and history the server keeps

- **Status:** accepted
- **Date:** 2026-11-18
- **Builds on:** 0034 (machine sizes are operator data), 0042 (control plane and runtimes), 0044 (one cluster is one team)

## Context

Decision 0044 made a cluster the unit of the product, and the console never caught up with the sentence. The operator's answers are scattered across five places: capacity is a per-row `committed/resources` pair on `Runtimes`, "is anything broken" is a three-second glance at a state badge, "who did what" is a separate page with its own filters, membership is another page behind an admin-only group, and machine sizes — operator-owned data since 0034 — have no console path at all, so a deployment changes its presets with `curl` or not at all.

Two of those are not navigation problems but honesty problems.

- The console draws `committed / resources`. The scheduler decides with `capacityOf(resources, SPACES_RUNTIME_OVERCOMMIT)`. With a factor above 1 the page says a machine is full while the scheduler would still place three `small` sandboxes on it; with a factor below 1 it says the opposite. The number on screen is not the number that governs.
- A runtime's agent `version` arrives in `hello`, is checked for protocol compatibility, and is then thrown away. An operator upgrading a cluster of five machines cannot see which have taken the new version, which is the one question an upgrade asks.

And the console has no memory: nothing samples capacity, so any chart would have to be invented at render time. Everything the operator needs to reason about "was it always like this" is either swept away (spans, after `SPACES_TRACE_RETENTION_DAYS`) or never written.

`Runtimes` is also in the main navigation for everyone, while registering, renaming, draining or deleting answers `403` to anyone who is not an operator. The nav promises a page whose buttons refuse.

## Decision

**One admin-only Cluster page owns the operator's questions, and the server keeps the history a dashboard needs.**

- **One page, owning `/runtimes`.** It moves into the Admin group beside Members, and a new page under Admin holds machine sizes. There is no separate admin home: a dashboard that duplicates the fleet is a second place for the same numbers to drift.
- **A verdict, then evidence.** The page states, in one line, whether the cluster is accepting work — runtimes online out of total, memory and vCPU committed, sandboxes running — and shows a warning banner only when something is off-nominal (a runtime offline while it holds sandboxes, a runtime draining with work on it, a version that differs). Below it: three series — memory committed %, vCPU committed %, sandboxes running — over 6 h, 24 h or 7 d, live counters on a 15 s poll, and a committed sparkline per runtime in the table.
- **History is stored, not imagined.** A `runtime_samples` table, one row per runtime per 30 s, written by a timer in the control plane next to the reaper and the span sweep, exposed as one endpoint over a window, and swept by the existing 10-minute timer after `SPACES_SAMPLE_RETENTION_DAYS` (default 7). One runtime is 2 880 rows a day; ten machines for a week is about 200k rows.
- **Capacity is shown as hardware, and labelled when it is not.** The table keeps `committed / resources` as the machine reports them, and carries a "scheduler ×1.5" badge on the row, only when the factor is not 1. `overcommit` joins the runtime payload so the console does not infer it. The refusal message, which already names the runtime and the free numbers, stays the authority on why a create was refused.
- **Agent version is stored and shown.** The `hello` frame's version is written to the runtime row on connect, shown in the table, and flagged when it differs from the control plane's own. Same for the protocol version, which is what the handshake already refuses on.
- **Presets live on the same page.** Machine sizes, their disk and the default flag are the other half of "can this cluster take this work", so a compact Presets section sits under the runtime table, with create and retire. The fuller Machine sizes page under Admin carries the same data with descriptions and the allowed ranges.
- **The last five changes are on the page.** Five audit entries, newest first, no filters, each linking into the full log. It is the one panel whose data already exists, and "what changed since I last looked" is the operator's question immediately after "is it up".
- **Seeing stays wider than operating.** The admin-only placement is a navigation decision, not a visibility one (0044): a member still reads any runtime through the API. What a member loses is the _page_ that explained a slow create; the mitigation is the refusal and queue messages, which name the runtime and the free numbers, and must keep doing so.

## Consequences

- The console gains a table, a migration, one endpoint, one timer and one retention sweep — the same shape as tracing (0032), which is the precedent that makes it a known cost rather than a new kind of thing.
- Two API additions, both additive: `overcommit` and the agent `version` on a runtime, plus `GET /runtimes/samples`. No status code and no existing field changes.
- A dashboard is a promise to keep it accurate. Every future driver or runtime feature that changes what "capacity" means has to be reflected here, or the page becomes the oldest lie in the product.
- The sampled history is coarse by construction: 30 s means a spike that lasts twenty seconds is invisible, and the page must not pretend otherwise. It answers "is this cluster filling up", not "what happened at 03:14:07".
- Charts need an empty state that is honest — no samples yet is a real answer in the first hour after a deploy.
- The `Runtimes` page disappears from a member's navigation, so support conversations move from "look at this page" to "read the error". That is a real cost of hiding it, and it is why the refusal copy is now load-bearing rather than nice.
- Machine sizes get a second place to live (inline presets and the fuller page). The rule that keeps them consistent: one hook, one mutation path, and the inline section is the page's section rendered in a compact form — not a copy.
- Nothing here changes the API contract for a client: the fleet page, the create dialog and the sandbox detail are untouched. This is the operator's surface only.

## Alternatives considered

- **A quiet page that says nothing until something is wrong.** Honest and cheap, but an operator who only sees the page broken never learns what normal looks like, and the page then has no reason to exist on a good day.
- **Client-side history: chart what the tab observed.** No storage and no API, and it is empty exactly when it is needed — the operator opens the page after an incident.
- **Charts derived from traces or the event log.** Capacity is a level, not a span or a transition; building it out of either would be a lie with extra steps.
- **Per-runtime small multiples, no cluster-level chart.** Answers "which machine" and not "is the cluster filling up", which is the question that makes someone add a machine.
- **A separate admin home dashboard.** A second surface duplicating the fleet, drifting from it, and answering nothing the fleet page could not.
- **Showing schedulable capacity as the number.** Truer to the scheduler and further from the machine: an operator comparing a row to `htop` on that host would find they disagree. The badge keeps both true without doubling every label.
- **Leaving machine sizes to `curl`.** What the last month was, and the reason a preset is operator data nobody edits.
- **Keeping `Runtimes` visible to everyone, read-only.** It answers a member's "why is my create slow", but a navigation entry whose every action refuses teaches the wrong thing about who owns the cluster; 0044 already puts seeing and operating in different places.
