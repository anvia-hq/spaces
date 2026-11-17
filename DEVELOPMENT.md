# Developing spaces

How to build, test and change this repository. For what spaces is and how to run it, see the
[README](README.md). For why the code is shaped the way it is, see [docs/decision/](docs/decision/README.md),
and for how files, ports, SSH and commands actually work, see [docs/internals.md](docs/internals.md).

## Layout

```
apps/
  api/      Hono + Bun. REST surface over the driver, Drizzle-backed.
  web/      React + Vite + TanStack Router + Tailwind console (shadcn/ui + ReUI source).
packages/
  shared/   Zod contracts, error envelope, machine sizes.
  db/       Drizzle schema, Postgres migrations.
docs/
  api.md              Endpoint reference
  configuration.md    Environment, networking and guest-image settings
  internals.md        How files, ports, SSH and commands actually work
  decision/           Why the architecture is what it is (35 decision records)
deploy/
  spaces.service      systemd unit (KillMode=process keeps sandboxes alive on restart)
  spaces.env.example  Runtime configuration installed to /etc/spaces/spaces.env
scripts/
  deploy.sh           Deploy to a KVM host over SSH: install, build, systemd, verify
  install-msb.sh      Install the msb CLI locally or on a remote host
```

A feature is one module per domain on both sides — `apps/api/src/modules/<name>/` and
`apps/web/src/modules/<name>/`. [AGENTS.md](AGENTS.md) has the rules (Bun only, TypeScript strict, no
barrel files, types in `types.ts`, no comments in `.ts`/`.tsx`), and
[decision 0027](docs/decision/0027-module-layout.md) explains the layering.

## Commands

Run from the repo root.

```bash
bun install         # install every workspace
bun run dev:api     # API with watch
bun run dev:web     # console with HMR
bun run typecheck   # all workspaces
bun run build       # production build of the console
bun run lint        # oxlint (aven's rules)
bun run lint:fix    # autofix
bun run format      # oxfmt
bun run format:check
bun run test:rules  # the oxlint plugin's own tests
bun run test        # API tests against a real Postgres (mock driver)
bun run test:guest  # opt-in: needs a real microVM
bun run --cwd apps/api auth:schema   # regenerate the Better Auth tables
bun run db:migrate-from-sqlite <db>  # one-way move out of a SQLite deployment
```

`bun test` from the repo root does **not** pick up `apps/api/bunfig.toml`, so its preload never runs and
every request is rejected. Use `bun run test`.

## Database

A database is needed for development. One line with a local Postgres:

```bash
psql -c 'create database spaces'            # once
psql -c 'create database spaces_test'       # once, for the tests
```

`SPACES_DATABASE_URL` overrides both (`postgres://user:pass@host:5432/db`) and defaults to
`postgres://localhost:5432/spaces`. Migrations are applied when the API boots, so `bun run dev` on a
fresh database is enough. There is no SQLite or file fallback.

Changing the schema:

```bash
SPACES_DATABASE_URL=postgres://localhost:5432/spaces bun run --cwd packages/db generate
```

That writes a new migration into `packages/db/drizzle/` from `packages/db/src/schema.ts`. Migrations are
generated, never hand-written, and a shipped baseline is never regenerated.

## Tests

`bun run test` runs the API suite on the mock driver against `spaces_test`; it needs no hypervisor.
`bun run test:rules` covers the oxlint plugin in `tooling/`.

Guest-runtime tests need a hypervisor and are opt-in — they run against `msb`, locally or over SSH:

```bash
SPACES_IT=1 bun run test:guest                                     # this machine
SPACES_IT=1 SPACES_MSB_HOST=box bun run test:guest                 # another host
SPACES_IT=1 SPACES_MSB_HOST=box SPACES_MSB_IMAGE=spaces/guest:ubuntu SPACES_IT_READY=1 bun run test:guest
```

They cover what a mock cannot: commands running as `user`, file ownership, the detached-command timeout
and its `setsid` escape, and the tools the ready image ships.

## Guest image

The default `alpine` image is tiny and boots in ~250 ms, but it has no glibc, no `curl`, no `git` and no
`procps` — so `GET /processes` degrades to busybox `ps`, and anything expecting a normal Linux box needs
`apk add` on every create. For a session that starts useful, use the ready image:

```bash
docker build -t spaces/guest:ubuntu -f deploy/guest/Dockerfile .
docker save spaces/guest:ubuntu | msb load -t spaces/guest:ubuntu
SPACES_MSB_IMAGE=spaces/guest:ubuntu ./scripts/deploy.sh <host>
```

It is `ubuntu:24.04` plus `ca-certificates curl git tar procps sudo jq unzip`, with the `user` account
already in place. No registry is needed: locally built images are loaded into msb's cache. Measured on a
16-core AMD host: **ready in ~0.6 s**, with `curl`, `git`, `ps` and `pgrep` present on the first command.

Without Docker, the equivalent is one environment variable per deployment — it costs the install time on
**every** create:

```bash
SPACES_BOOTSTRAP='apt-get update -qq && apt-get install -y -qq ca-certificates curl git tar procps sudo'
```

The `user` account is not in that snippet: the API creates and owns it on every boot regardless.

`SPACES_BOOTSTRAP` runs as **root** (it installs packages); `setupScript` from the create request runs
as `user`.

### Starter image: the toolchain on first boot

For an agent or web session, the first command usually wants Node, bun, uv and a browser. Installing
them per sandbox costs minutes on **every** create. `deploy/guest/Dockerfile.starter` layers them onto
the ready image once:

```bash
docker build -t spaces/guest:ubuntu -f deploy/guest/Dockerfile .
docker build -t spaces/guest:starter -f deploy/guest/Dockerfile.starter .
docker save spaces/guest:starter | msb load -t spaces/guest:starter
SPACES_MSB_IMAGE=spaces/guest:starter ./scripts/deploy.sh <host>
```

It ships Node.js 26.13.1 through nvm (default alias, npm included), bun 1.4.4, uv/uvx 0.13.8, the
GitHub CLI 2.104.0 (a tool, no token: `gh auth login` or `GH_TOKEN` in the sandbox), Playwright 1.65.1
with Chromium and its libraries, `build-essential` and `python3` + venv. Measured: **879 MB** on disk,
**~150 s** for a cold build on an Apple-silicon Mac (both architectures), and the toolchain answers
through the API's own privilege drop with no extra boot step.

Prove an image before deploying it — the probe runs the API's `GUEST_INIT` and its `su` wrapper, so it
fails for the same reasons a request would:

```bash
msb create -n toolchain-check --replace spaces/guest:starter
msb copy deploy/guest/guest-toolchain-probe.sh toolchain-check:/tmp/probe.sh
msb exec toolchain-check -- sh /tmp/probe.sh \
  'command -v node bun uv uvx gh playwright; node -v; bun -v; uv --version; uvx --version; gh --version'
```

A Playwright launch is a separate check, because it needs the installed `playwright` package next to
the script — the browsers themselves ship in the image, under `/opt/ms-playwright`:

```bash
msb exec toolchain-check -- sh -c 'su user -s /bin/sh -c "
  cd /home/user && npm i --no-save playwright@1.65.1 >/dev/null 2>&1 &&
  cat > check.mjs <<'JS'
import { chromium } from \"playwright\";
const b = await chromium.launch();
const p = await b.newPage();
await p.setContent(\"<h1>hello from the guest</h1>\");
console.log(await p.textContent(\"h1\"), b.version());
await b.close();
JS
  node check.mjs"'
```

It prints `hello from the guest 159.0.8154.6` on this image.

What the image does **not** do, measured rather than assumed: microsandbox does not hand the image's
ENV to `msb exec`, and the API's wrapper is `su user -c`, which is a login shell that rebuilds PATH
from `/etc/environment` and `/etc/profile.d`. The image sets PATH in all three places. Running a plain
`docker run <image> sh -c 'node -v'` does not exercise any of them.

Why the image is shaped this way, and what was deliberately left out, is
[decision 0035](docs/decision/0035-starter-guest-image.md).

## GitHub sign-in

The console also signs people in with GitHub, when the deployment supplies an OAuth app. It is opt-in
and purely additive: with nothing set, the server registers no provider, the console draws no button,
and email + password is the only way in (decision 0036).

1. Create an OAuth app — GitHub → Settings → Developer settings → **OAuth Apps** → _New OAuth App_. A
   GitHub _App_ works too; register the same callback as its authorization callback URL.
2. **Authorization callback URL:** the API's own origin plus `/api/auth/callback/github`.

   | Where you are running | Callback URL to register                                           |
   | --------------------- | ------------------------------------------------------------------ |
   | `bun run dev`         | `http://localhost:8787/api/auth/callback/github`                   |
   | A deployment          | `https://<your-host>/api/auth/callback/github` (`SPACES_AUTH_URL`) |

   The callback always lands on the API, even when the sign-in starts on the Vite console at `:5173`:
   the dev proxy starts it, and GitHub returns to `SPACES_AUTH_URL`, which defaults to `:8787`.

3. Put the pair in the environment, or in `.env` for `bun run dev` (gitignored):

   ```bash
   SPACES_GITHUB_CLIENT_ID=Ov23li…
   SPACES_GITHUB_CLIENT_SECRET=…
   ```

4. Restart the API. `GET /api/v1/me` reports `"login": { "github": true }`, and the auth screen shows
   "Continue with GitHub".

A GitHub identity is the same kind of user as an email account: same `user` row, same ownership of
sandboxes, same audit entries. An existing password account is **not** linked by matching email — sign
in with the password and GitHub stays a separate account.

## Configuration

Every setting has a working default for local development. The full table, the guest network profiles
and the `SPACES_NET_RULES` grammar are in [docs/configuration.md](docs/configuration.md).

## Git hooks

`bun install` runs the `prepare` script, which lets husky point git at `.husky/`:

- **pre-commit** — `lint`, `format:check`, `typecheck`. A few seconds, no database needed.
- **pre-push** — the CI steps in CI order: `typecheck`, `lint`, `format:check`, `test:rules`, `test`,
  `build`. Needs the local Postgres described above.

Skip them deliberately with `SKIP_HOOKS=1 git commit …` or `git push --no-verify`.

## Before you open a pull request

Run what CI runs — `bun run typecheck`, `bun run lint`, `bun run format:check`, `bun run test:rules`,
`bun run test`, `bun run build` — and read [CONTRIBUTING.md](CONTRIBUTING.md) for the sign-off
requirement.
