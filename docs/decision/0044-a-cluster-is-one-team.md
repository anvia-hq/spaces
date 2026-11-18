# 0044 — A cluster is one team, and nothing here is held back

- **Status:** accepted
- **Date:** 2026-11-18

## Context

Decisions 0042 and 0043 built the machinery for many machines: a control plane that holds the store and the API, runtimes that dial out and join with one command, and a scheduler that places a sandbox on the runtime that fits and keeps its disk there. What they did not say is who all of that is for. The README still sold a single machine on your own laptop, and the API still scoped every row to the person who created it (decision 0028), so "a team runs a cluster" was not true of the code even though it was true of the plumbing.

That gap is the one that gets expensive to close later. Ownership is threaded through `db.ts` — every sandbox, snapshot, saved snapshot, port and usage row is filtered by `ownerId` — and new code written against that filter is code that has to be retrofitted.

There was a second, quieter contradiction: the repository is Apache-2.0 and whole, yet the plumbing it just gained is what a hosted offer would be built from. Leaving that unstated invites a later "core open, management tier reserved" split that contributors cannot see coming.

## Decision

**The unit of the product is a cluster, a cluster is one team's trust boundary, and everything in this repository is published whole.**

- **One cluster, one team.** Everyone who can sign in to a deployment sees every sandbox, snapshot, saved snapshot, published port, usage row, trace and audit entry on it. `ownerId` stays on every row, but as attribution — who made this — not as a filter. The operator key and the admin role keep their separate power (decision 0037): seeing is not operating, and `mayOperate` still gates runtimes and machine sizes on `Principal.admin`, not on visibility.
- **A cluster of one is a cluster.** One host running the control plane with its built-in runtime is the minimal case of the same story, not a second mode. Adding capacity is running the install command on another machine with that cluster's runtime token. The README says this in its first paragraph; there is one narrative, one install path and one set of bugs.
- **A cluster counts as built when** a second machine has joined, a sandbox created with no source was placed on it, and that sandbox was stopped and resumed with its disk still on the machine that holds it. Nothing less proves what 0042 promised, because a single-machine install proves none of it.
- **Whole and open.** No reserved tier, no enterprise edition, no hosted offer run from this repository. The Apache-2.0 tree is the product; a commercial layer, if one ever exists, is a different program in a different repository. The README no longer needs to hedge about it.
- **No other product is named here.** Not in the README, decisions, docs, code, identifiers, fixtures, or commit messages. This repository is a platform that anyone — including software the authors also ship — consumes over the API like any other client. The lint plugin namespace and its `aven/*` rule names are the one remaining exception and are renamed in a change of their own, so that mechanical churn never shares a diff with a behaviour change.

## Consequences

- **Sharing becomes total, and privacy becomes a feature request.** A teammate can see, stop and delete your sandbox. That is the intended shape of a single team's cluster, and it is the cost of not building team scoping before there is a second team. A deployment serving two departments will need scoping (a `team_id` on rows, and a filter that is membership rather than ownership), and this record is the one that says it is a breaking change, not a bug fix.
- The change itself is small because `Scope.admin` was overloaded: it meant both "sees every row" and, by confusion, "an operator". It is now `Scope.seesEveryRow`, true for anyone signed in, and operator capability lives where `mayOperate` already reads it. That is a rename in `scope.ts` and its two call sites in `auth.ts`; no route handler changes.
- The audit log and traces widen with everything else. A team that cannot read who stopped a sandbox, or what the slow request was, has a log it does not get value from — and the log stays append-only (decision 0031), which is what made it trustworthy in the first place.
- Every existing API test that asserts "someone else's sandbox is 404 for a second user" inverts. Those tests were the specification of decision 0028 and are now the specification of this one; they are rewritten deliberately, not deleted: sandboxes, saved snapshots, the audit log and traces.
- An API key inherits the visibility of the person who created it (decision 0037), so widening scope widens keys too. A key is that person's credential; nothing else changes.
- The audit log keeps recording the actor, which is now the only difference between two people who can do the same things.
- Metering has no payer: `modules/usage` computes a vCPU multiplier for a bill nobody sends. It stays, as a team's own view of what it consumed, and stops being a placeholder for a billing feature.
- Draining a runtime, cordoning it, and honouring an existing `draining` flag in operator comfort terms is the next slice, after the cluster-of-two proof. This record does not decide its shape.
- The public surface does not change: no new route, no new field, no new status code. What changes is who can see an existing one.

## Alternatives considered

- **Many teams per cluster, with private rows by default.** The safer permanent shape, rejected for now because it builds a permission model before a second team exists, and because a cluster is already one operator's hardware and one database. The honest sequencing is total sharing first, scoping when someone runs it for two departments.
- **Open core: Apache-2.0 runtime, reserved management tier.** Every project that takes this trade pays in forks and in contributors who cannot tell what they are allowed to build. The alternative here is cleaner: publish the whole thing and, if anything is ever sold, sell a different program.
- **Keep the single machine as its own story.** Two narratives, two support surfaces, two sets of install bugs, and a README that has to explain why the cluster exists separately from the thing it generalises.
- **Ship team scoping and the cluster proof together.** Couples a permissions rewrite to a scheduling proof, in one diff, in the area of the codebase with the most concurrency. Neither gets reviewed well.
- **Leave the lint namespace as it is.** The rule prefix surfaces in every lint error and every review, which is exactly where the blackout matters. Renaming it alone, later, costs less than explaining it forever.
