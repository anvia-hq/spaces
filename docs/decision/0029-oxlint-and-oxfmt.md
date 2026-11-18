# 0029 — One lint and format gate: oxlint and oxfmt, on one written rule set

- **Status:** accepted
- **Date:** 2026-11-16

## Context

Spaces has no linter and no formatter. TypeScript strict mode plus `bun test` is the whole gate, and
both are green while the repo carries: hand-wrapped imports in some files and single-line ones in
others, `{ ...prev, [key]: value }` accumulations, conditional spreads in response builders,
`d === undefined ? a : d` chains three ternaries deep in JSX, and one `as unknown as` assertion.

A sibling repository, maintained alongside this one and on the same shape of stack (Bun, TypeScript, a
React app and a Hono API), already runs `oxlint` + `oxfmt` with a custom plugin of fourteen rules, and
its CI enforces `lint`, `format:check`, typecheck and tests. Both are read by the same people and the
same agents; a file that would be rejected there should not pass here, and a reviewer should not have
to hold two style guides.

`oxlint` is a Rust linter that runs in tens of milliseconds and ships a JSON config with a JS plugin
API; `oxfmt` is its formatter, deliberately opinionated and non-configurable beyond ignores. Both are
dev dependencies with prebuilt binaries, so they add no runtime weight.

## Options

**A. Adopt that config verbatim — every rule, including `spaces/no-comments` and
`spaces/no-native-primitives`.** One convention across both repos, enforced by copy. Cost: 919 comment
lines in 63 TypeScript files would have to go (the rule bans them all), and ~30 native `<button>`,
`<input>` and `<label>` elements in the console would have to be rebuilt on Base UI wrappers. The
first destroys the rationale that sits next to the code it explains — spaces keeps its "why" inline
by choice, and 0028 cites those comments. The second is a UI refactor wearing a lint phase's clothes:
it changes markup, focus behaviour and pre-existing components from a phase whose brief says "fix all
lint errors without behaviour changes".

**B. Do nothing, or lint with defaults.** Free, and honest, but it leaves the exact sloppiness that
`no-conditional-spread`, `padded-if` and `no-nested-ternary` exist to catch, and CI keeps being
typecheck-and-tests only. It also leaves this repo drifting from the one the rules came from.

**C. Adopt the tooling, rules and CI shape exactly, minus two rules that presuppose code spaces does
not have, and defer the comment rule with a written plan.** Everything structural —
`spaces/no-barrel-file`, `no-conditional-spread`, `padded-if`, `no-chained-type-assertions`,
`no-unknown-type-aliases`, `no-module-mocking`, `no-array-filter-map`, `no-reduce-accumulator-copy`,
`no-reflect-*`, `oxc/no-accumulating-spread` — applies as it does there, with the same implementations
copied in so the two repositories cannot drift in meaning. The exceptions are named, recorded, and
each has an owner and a trigger.

## Decision

**C.** In detail:

- `oxlint` and `oxfmt` are root dev dependencies at the same versions (`^1.89.0`, `^0.74.0`), with
  `lint`, `lint:fix`, `format` and `format:check` scripts spelled the same way (`oxlint
  --no-error-on-unmatched-pattern`, `oxfmt --check`).
- `tooling/oxlint/spaces-plugin.mjs` and `tooling/oxlint/rules/*` are copied, with their tests, from the
  `staging` branch of the repository they were written in, so a rule's behaviour is identical in both
  and a fix lands in one place by porting it. The plugin is registered under the `spaces/` prefix and
  every rule keeps its implementation, its name and its tests: these are that repository's rules, not
  spaces-flavoured rewrites.
- `.oxlintrc.json` carries the same plugins, `correctness: error`, and rule list **minus**:
  - `spaces/no-comments` and `no-inline-comments` — deferred, see below;
  - `spaces/no-atom-import` — spaces has no jotai atoms; the rule would be dead code;
  - `spaces/no-native-primitives` — needs the UI refactor described in option A. It is the one rule
    whose "fix" is not a lint fix, and it goes with a future console pass.
- `spaces/no-base-ui-outside-ui` is ported and adapted: only `apps/web/src/components/ui/` (the vendored
  shadcn layer) may import `@base-ui/react`, which is what the rule means here.
- Ignore patterns mirror the source configuration's intent with this repo's vendored and generated
  paths: `node_modules`, `dist`, `**/routeTree.gen.ts`, `packages/db/drizzle`,
  `apps/web/src/components/ui`, and `deploy/guest` (Docker).
- CI: a GitHub Actions workflow runs typecheck, lint, `format:check`, tests and the console build on
  every pull request and on `main`. Nothing else in the repo gates a merge today, so the workflow is
  the gate; `deploy/` and `docs/` are not linted, only formatted-checked where they are code.
- The formatter lands as its own commit, before the lint fixes, so a reviewer can read the mechanical
  reflow separately from the semantic changes (`oxfmt` is not configurable beyond ignores, which is
  the point: no bikeshedding).

**The comment rule is deferred, not dropped.** Stripping 919 comment lines now, immediately before
Phase 3 rewrites the data layer, Phase 4 adds an audit table and Phase 5 threads spans through the
services, would delete rationale from files that are about to be edited three more times — and the
comments are exactly what makes those edits reviewable. The plan recorded here: after Phase 5, in a
pass with nothing else in it, move the load-bearing "why" into `docs/decision/` and `docs/internals.md`
per area, then turn `spaces/no-comments` and `no-inline-comments` on. `AGENTS.md` says so, so it is not
forgotten.

## Consequences

- The gate is fast (sub-second lint) and identical to the one the rules were written for, so a rule that
  is wrong for both repositories is fixed once and ported. Cross-repo differences are the three named
  exceptions, all in one file, all with a reason.
- Conditional spreads and nested ternaries get spelled out explicitly. That is a real readability cost
  in a few response builders (`if (x) { body.y = z }` instead of one spread) and pays for itself the
  first time a key is silently dropped by a falsy spread.
- The formatter's diff touches nearly every file. Reviewing it by `git blame` is painful for one
  commit and free afterwards; `--ignore-rev` is the escape hatch.
- Comments survive this phase, so the repo still reads as it did. When the rule does land, the diff
  will be a pure deletion, easy to review and easy to argue with.
- No `no-native-primitives` means the console can keep its pre-existing native elements until the UI
  pass that replaces them deliberately.

## Alternatives ruled out

- **Prettier + ESLint.** Two tools, two configs, an ESLint plugin stack and an order-of-plugins
  problem that the source repository already left behind; slower and heavier for the same result.
- **Biome.** One tool, but it would be a third convention across the two repositories, and the custom
  rules here (barrels, padded ifs, atom imports) do not exist in it.
- **Warn instead of error for the deferred rules.** A warning in CI output is noise that nobody reads;
  a rule is either enforced or absent, and this way the absence is documented in one place.
