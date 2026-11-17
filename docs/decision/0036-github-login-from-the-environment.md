# 0036 — GitHub sign-in, configured from the environment

- **Status:** accepted
- **Date:** 2026-11-17

## Context

Decision 0028 gave the API people: Better Auth, email + password, and one `owner_id` per sandbox. It
also promised the shape would not be re-litigated per feature — a second way in must produce the same
user, the same scoping, the same audit rows.

Typing a password into a self-hosted tool is friction for the people it is for. Most of them already
have a GitHub account, and it is the account a tiny self-hosted simulator is most likely to care about:
it is where the repositories, the OAuth app and the CI job already live.

Two constraints decide most of the design:

- **Nothing may require configuration to boot.** A fresh clone runs `bun run dev` and signs up in ten
  seconds (README, decision 0028). If a GitHub client id were mandatory, that path is gone.
- **A deployment is one process with one env file** (`/etc/spaces/spaces.env`, decision 0025). There is
  no admin UI to configure an identity provider, and decision 0003 keeps the account surface that would
  host one out on purpose.

## Decision

**GitHub is a Better Auth social provider that exists only when the environment says so.**

- `config.auth.github` reads `SPACES_GITHUB_CLIENT_ID` and `SPACES_GITHUB_CLIENT_SECRET` as one group,
  next to the rest of the auth block, and derives `enabled`: both halves present and non-blank. One
  value owns the decision, so nothing else can disagree about whether GitHub is on.
- `modules/auth/service.ts` builds `socialProviders` from that flag: `{ github: { clientId,
  clientSecret } }` when enabled, `{}` when not. Better Auth only registers a provider it is given, so
  with the pair unset `/api/auth/sign-in/social` answers `404 provider not found`, email + password
  still works, and the server boots. A half-configured pair counts as unset — half a pair cannot
  complete a round trip, and registering it would only move the failure to the callback.
- **The callback URL is the API's own origin**, `SPACES_AUTH_URL` + `/api/auth/callback/github`, worked
  out by Better Auth from `baseURL` — verified, not assumed: the authorize URL carries
  `redirect_uri=http://<SPACES_AUTH_URL host>:<port>/api/auth/callback/github` for a request whose
  `Origin` was the API itself _and_ for one whose `Origin` was a Vite dev console proxying `/api`
  (the redirect goes wherever `baseURL` points, not to the caller). Which means:
  - **Development**: `SPACES_AUTH_URL` defaults to `http://localhost:8787`, so the GitHub OAuth app
    registers `http://localhost:8787/api/auth/callback/github`. The sign-in _starts_ on `:5173` through
    the Vite proxy and the _callback_ lands on `:8787` directly; both are same-site for
    `localhost`, so the `state` cookie survives, and Better Auth's `trustedOrigins`
    (already `[SPACES_AUTH_URL, http://localhost:5173, http://127.0.0.1:5173]`) accepts the
    `:5173` origin on the POST that starts it.
  - **Deployment**: `SPACES_AUTH_URL` is the public HTTPS origin and the console is served by the API
    (decision 0025), so both halves are that origin and there is nothing to register but one URL.
- **Availability reaches the console through `GET /api/v1/me`**, as a new `login: { github: boolean }`
  field: `{ "login": { "github": true } }`. `/me` is the one endpoint that already answers "who am I"
  for _every_ accepted credential, and it is what the signed-out console calls in the auth screen (with
  the operator key a local browser carries; an unauthenticated call still answers `401`, which the
  screen treats as "provider unknown" and renders no button). The alternative — a public, token-free
  `/api/v1/auth/providers` — adds a route to the contract, a decision, and an unauthenticated surface
  for one boolean; the alternatives considered below explain why neither was worth it.
- **The console asks, and offers nothing until answered.** `useLoginProviders` fetches `/me` once on the
  auth screen; a `true` renders "Continue with GitHub" (`signIn.social({ provider: "github",
  callbackURL: "/" })`, which redirects the whole page), styled as an outline `lg` button above the
  email form and separated by an "or" rule. `null` or `false` renders exactly the old screen. A button
  that the server would answer `404` on is worse than no button.

**Identity is not forked.** GitHub sign-in runs through the same `betterAuth` instance, the same
`user`/`session`/`account` tables and the same `databaseHooks`: a first GitHub sign-in creates a `user`
(so `auth.sign_up` is recorded), every sign-in creates a session (`auth.sign_in`), and the session
cookie is the credential `src/auth.ts` already resolves into a `userScope`. Sandboxes created under it
carry that user's `owner_id`, and `account.providerId = "github"` is just a second row pointing at the
same user. Nothing in `sandboxes`, `store` or `scope.ts` changed.

## Consequences

- A deployment with no GitHub app is byte-for-byte the product 0028 shipped: no provider, no button,
  email + password.
- **The console build is deployment-agnostic.** The flag is fetched, not compiled in, so one
  `apps/web/dist` (decision 0025) works for every host and the env file stays the only configuration.
- **An existing email + password account is not silently taken over.** Better Auth 1.7 links an OAuth
  identity to an existing user only when the local row is `emailVerified`, which a sign-up through
  `emailAndPassword` (no email verification configured here) never is. In that case GitHub sign-in is
  refused (`account not linked`), and the person signs in with their password. That is the honest
  outcome: GitHub proves an email, not that the person owns the local row.
- The `account` table starts carrying rows, and with them the provider's access token. Nothing here
  reads it; it is what Better Auth stores, and a GitHub sign-in without a token cannot happen.
- The provider set changed but the **generated schema did not**: `account` already had
  `providerId`/`accountId` and the rest of the OAuth columns, because regeneration with the
  email + API-key plugin set produced them. `bun run --cwd apps/api auth:schema` was re-run and the
  output is identical, so `packages/db/src/auth-schema.ts` and `packages/db/drizzle/` are untouched.
- **What was not verified here:** a real round trip to `github.com` needs a registered OAuth app and a
  browser with a GitHub session. The tests stop at the provider lookup (a `404` with none, a redirect
  with one), and the authorize URL's `redirect_uri` was checked against a live server on a spare port.
  The callback exchange, the `state` cookie across `:5173` → `:8787`, and GitHub's email scope are
  documented behaviour, not measured ones.

## Alternatives

- **A `login.github` row in a configuration table (an admin UI or a settings page).** Adds a table, a
  migration, a page and a mutation — a settings surface decision 0003 and 0025 deliberately do not
  have — so that a value could be changed by a person who can already edit `/etc/spaces/spaces.env`.
  The env file is the deployment's configuration in every other feature, and secret material belongs
  in a `0600` root-owned file, not a database column.
- **A build-time flag in the console (`VITE_GITHUB_ENABLED`).** The console is built once and shipped
  (decision 0025); a compiled-in flag means one build per deployment, and it drifts the moment the
  env file and the build disagree. It also cannot know about the secret half.
- **A public `GET /api/v1/auth/providers` without a credential.** Cleaner to call, but it is a new
  route in the contract (`docs/api.md`), a new decision, and an unauthenticated endpoint whose only
  job is a boolean that `/me` already answers for every credential that can reach it.
- **Registering GitHub unconditionally and failing at sign-in when unconfigured.** Better Auth logs a
  warning and builds a provider with an empty client id; the failure moves to a GitHub error page after
  a redirect. Unset means off is quieter and earlier.
- **Auto-linking GitHub to an existing password account by email.** Convenient, and a takeover path:
  anyone who controls an email address on GitHub would own every local account with that address.
  Better Auth's verified-local-email gate is the right default, so it was left alone.
