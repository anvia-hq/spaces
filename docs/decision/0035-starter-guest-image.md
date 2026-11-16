# 0035 — A starter guest image with the toolchain baked in

- **Status:** accepted
- **Date:** 2026-11-17

## Context

Decision 0016 rejected publishing a custom image and converged stock images at boot instead. That was
right for "a sandbox that is a Linux box": the tools there are `curl`, `git`, `ps`, and `apk add` costs
seconds. It is wrong for the case that now dominates — an agent or web session whose first command is
`node`, `bun`, `uv`, or a headless browser. Each of those is a download on **every** create: Node via
nvm is ~45 MB plus a toolchain, Chromium is ~440 MB with its shared libraries, and the first command
waits for all of it.

`deploy/guest/Dockerfile` already proved the "build once, load into msb" path works without a registry
(decision 0016's registry objection is about _publishing_, not building). What was missing was a layer
that makes a fresh sandbox useful in its first command.

## Decision

**A second Dockerfile, not a stage in the base.** `deploy/guest/Dockerfile.starter` is
`FROM ${BASE_IMAGE}` (default `spaces/guest:ubuntu`) and adds the toolchain. The base stays the thin,
documented "ready image" it is: `docker build -f deploy/guest/Dockerfile` does not silently hand you
0.9 GB, and a machine that wants curl/git/ps does not pay for Node and Chromium. An `ARG BASE_IMAGE`
keeps the pairing visible in one line and lets a deployment point at its own base build.

**Baked, not bootstrapped.** `SPACES_BOOTSTRAP` is the per-deployment escape hatch (0016) and stays.
It is the wrong tool for a toolchain every sandbox wants: the cost is per boot, its failure is
non-fatal by design, and it needs network access at create time — precisely the thing a network
profile may restrict. An image is downloaded once per host, shared by every sandbox booted from it, and
its content is fixed before a sandbox exists. For something a session depends on, "sometimes installed"
is the bug this image removes.

**Node through nvm, not apt and not a tarball.**

- **apt (`nodejs`)** on Ubuntu 24.04 is Node 18, and it is not upgradable per project. An agent that
  wants Node 26 has to replace it anyway, and a second, user-level Node next to an apt one is exactly
  the "which node am I running" confusion this image exists to prevent.
- **A tarball into `/usr/local`** works and is the smallest layer, but it makes every version switch a
  root operation and leaves no `nvm`. Agents and people reach for `nvm use 22`; shipping `~/.nvm` with a
  default alias makes that a command that already works instead of a download plus a shell-config edit.
- **nvm** costs one thing: it installs itself from a git clone of nvm-sh/nvm, not from a release
  tarball. The installer is pinned by version _and_ verified against its published SHA-256 before it
  runs, and the clone is what makes `nvm install` of another version cheap later.

nvm 0.41 does not create `~/.nvm/current` unless `NVM_SYMLINK_CURRENT=true`, and it can only create it
after a `nvm use` — `nvm alias default` alone does not move it. Both are set explicitly (`nvm use
default` in the build, the variable persisted in the profile). This was found by running the image, not
by reading nvm's docs.

**The PATH problem, which is the whole feature.** A PATH that only works in an interactive shell is a
bug, and the obvious fixes do not work here:

1. Image `ENV PATH` is **not** forwarded to `msb exec`. Measured: `msb exec` runs the command from a
   guest agent whose environment has no PATH at all; only the image's `ENV` lines that microsandbox
   models (HOME, BUN_INSTALL, PLAYWRIGHT_BROWSERS_PATH, …) reach anything, and the command-level PATH
   does not. `docker run -u` _does_ inherit `ENV`, so it proves nothing about msb.
2. The API's privilege drop is `su user -s /bin/sh -c "$s"` — **`su` without `-`, with a default login
   shell, is a login shell**. It rebuilds PATH from `/etc/environment` and runs `/etc/profile`, which
   loops over `/etc/profile.d/*.sh`. It never reads `~/.profile` (that is bash's, and the shell is dash).

So the image writes the same directories three times — the image `ENV`, `/etc/environment`, and
`/etc/profile.d/nvm.sh` (also appended to `~/.bashrc`, with `~/.bash_profile` a copy of it, for a bash
login) — and asserts them in the build, plus `dash -lc 'command -v node'`, which is the _same
mechanism_ `su -c` uses. `~/.nvm/current/bin` is the entry rather than the versioned directory, so
`nvm use 22` moves the whole PATH entry instead of leaving a stale version in front of it.

**Playwright: browsers shared, package per project.** The browser binaries go to
`/opt/ms-playwright` (chowned to the sandbox user, `PLAYWRIGHT_BROWSERS_PATH` set), so root and `user`
read one copy and a `/home/user` snapshot does not carry 440 MB of browser twice. The `playwright`
package is installed globally so `playwright` is a command; a project still gets its own copy with
`npm i playwright`, because Node resolves modules from the cwd and will not magically find a global
`playwright` when a script lives in a project directory. That is Node's behaviour, not something an
image should paper over. `playwright install --with-deps chromium` installs the browser _and_ runs the
apt list for the Ubuntu 24.04 `t64` transition; the Dockerfile also names that list, and the build
asserts `playwright install-deps --dry-run chromium` prints "All system dependencies are installed."

**gh is a tool, not a credential.** Installed from the release tarball against cli/cli's own checksums
(no apt keyring or source list in the image). No token, no auth, no `gh auth setup-git`: a session runs
`gh auth login`, or gets `GH_TOKEN`/`GITHUB_TOKEN` from its own env. Baking a credential into an image
would hand it to every sandbox booted from it.

**Build order is a cache decision.** OS packages first (they move when the base moves), then gh (one
binary), then nvm/Node (network, pinned by version), then bun and uv, then the Playwright browsers last
(the layer that changes most often, ~440 MB). Changing the Playwright version then costs one browser
download and not a Node reinstall.

## Measured

Apple M4, OrbStack, Docker 29.8.2, image pinned by tool versions above:

|                                    |                                                          |
| ---------------------------------- | -------------------------------------------------------- |
| Built size, `docker image ls`      | **879 MB**                                               |
| Archive size, `docker save`        | **838 MB** (amd64), **876 MB** (arm64)                   |
| `msb load` from `docker save`      | 4–14 s                                                   |
| `msb create` from the loaded image | **0.4 s** (warm image cache)                             |
| Cold build, `--no-cache`           | **135 s** and **143 s** (two runs, amd64, network-bound) |
| Cold build, `--no-cache`, arm64    | **106 s**; the base alone is ~20 s                       |
| base image, for scale              | 58 MB built / 21 s                                       |

Where the 879 MB goes (`docker history` plus `du` inside the image; the compressed archive is smaller
because the browsers and Node compress):

| Layer                                                                   | On disk (in the runner) | Layer size (`docker history`) |
| ----------------------------------------------------------------------- | ----------------------- | ----------------------------- |
| base `spaces/guest:ubuntu`                                              | 58 MB                   | 58 MB (its own build)         |
| apt: build-essential, python3-dev, Chromium's shared libraries          |                         | 107 MB                        |
| gh                                                                      | 40 MB                   | 8 kB                          |
| Node 26.13.1 + npm and the nvm checkout                                 | 281 MB                  | 275 MB                        |
| profile / `/etc/environment` / build gate                               |                         | 24 kB                         |
| bun                                                                     | 103 MB                  | 38 MB                         |
| uv + uvx                                                                | 37 MB                   | 25 kB                         |
| Playwright package, Chromium 414 MB, headless shell 282 MB, ffmpeg 5 MB | 701 MB + package        | 627 MB                        |
| final `su` / profile check                                              |                         | 8 kB                          |

Sizes differ between `du` in the running image and the layer record because of block rounding.

Skipping the full Chromium (a headless-only launch needs `chromium-headless-shell`) would cut roughly
400 MB of the 879; that is a decision for a deployment that never renders a page, not for a starter
image.

Versions printed by the image as `user`, through the API's own wrapper, not quoted from a registry:
`node v26.13.1`, `npm 11.20.0`, `bun 1.4.4`, `uv 0.13.8`, `uvx 0.13.8`, `gh 2.104.0`, `playwright
1.65.1`, and Chromium `159.0.8154.6` launching headless from `/opt/ms-playwright` and returning
rendered text — on a sandbox created from the image with `msb create`, not only under `docker run`.

Two caveats on that verification, stated rather than glossed:

- That sandbox had `/home/user` ownership from the image itself, not from the API's `GUEST_INIT` (which
  chowns `/home/user`), because the API was not in the loop. The probe runs the driver's `GUEST_INIT`
  and its `su` wrapper verbatim, so the PATH result is the API's; the ownership step is not.
- The Playwright launch needed `npm i --no-save playwright@1.65.1` in the project directory first. The
  browsers are the image's; Node resolves `import "playwright"` from the cwd, so a bare script does not
  find the global package. That is deliberate — see the Playwright paragraph above.

What could be deferred to first boot instead, and why it is not: a second Node version (`nvm install`
is one command and the clone is already there), Firefox/WebKit (another ~350–450 MB for a browser most
sessions never launch), Docker (needs `--storage-driver=vfs` in a guest and root, so it stays a
bootstrap concern), and the browsers themselves if a deployment's sessions never render pages.

## Consequences

- The deploy template points at `spaces/guest:starter`; the API default stays `alpine`. The default is
  a 4 MB, 250 ms boot that works with no image build at all — the right default for a machine that just
  wants a sandbox, and the reason 0.9 GB is not silently forced on every deployment. A deployment that
  wants the toolchain says so once, in `SPACES_MSB_IMAGE`, and `SPACES_BOOTSTRAP` remains for the rest.
- The image is a per-release artefact: pinned versions rot. Everything is pinned in one place at the
  top of the Dockerfile (`NODE_VERSION`, `NVM_VERSION` + checksum, `GH_VERSION`), bun/uv/Playwright are
  whatever their installers ship that day, so a rebuild is reproducible only to that granularity.
  Rebuilding is cheap (~2.5 min) and the image is loaded, not published — but it _is_ an image to
  rebuild when a base CVE lands, which is the cost 0016 named. It is now paid by people who choose the
  feature, not by everyone.
- Every sandbox from this image starts with ~150 MB of Node toolchain and ~440 MB of browser on disk,
  and they are not free at snapshot time either (~1 GB of snapshot, dominated by browser blobs). The
  disk snapshot cost is what a session pays for a first command that does not install anything.
- The image holds no secrets and no auth, so a snapshot or fork of a sandbox is not an image problem —
  credentials a session creates at run time are the session's.
- `microsandbox`'s exec PATH behaviour (no ENV forwarding) is now load-bearing for this image: the
  profile-based PATH is what makes it work, and it would break silently if a future microsandbox changed
  how `su -c` or login shells are handled. The build's `dash -lc` check and the probe script exist to
  catch that once, per image, instead of per session.

## Alternatives considered

- **One Dockerfile with a named stage** (`--target starter`). Rejected: the base's build line is
  documented everywhere and must stay a one-liner; a multi-stage file forces every reader to learn the
  stage names to use the base.
- **Publish the image to a registry.** Rejected: 0016's objection stands (tag policy, CVE treadmill,
  auth for pull). `docker save | msb load` is two commands and is what the deploy script already does.
- **Install everything under `/usr/local` as root.** Rejected: `npm -g`, `nvm` and `uv` all want a
  user; putting them in root's tree leaves the sandbox user read-only against its own toolchain and
  makes `npm install -g` fail in a session.
- **chromium from Ubuntu's apt** (`chromium-browser`). Rejected: it is a snap transitional package on
  Ubuntu 24.04, and snapd does not work in a microVM.
- **Bootstrap the toolchain with a bootstrap snippet** (0016). Rejected: per-boot cost, fatal-or-not by
  design, and it needs egress at create time — the three properties a first command must not depend on.
- **Put the toolchain on `/usr/local/bin` symlinks to versioned paths.** Rejected: it hardcodes the
  version into system paths and makes `nvm use` a lie; one `.nvm/current` link is what nvm already
  maintains.
