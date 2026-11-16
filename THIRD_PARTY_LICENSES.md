# Third-party licenses

spaces itself is licensed under the [Apache License 2.0](LICENSE). This file lists the
third-party components it uses and the terms they are distributed under.

Generated on 2026-11-16 from the resolved dependency tree in this repository (`bun.lock`, every package
under `node_modules/.bun`), cross-checked against `license-checker` run per workspace. Regenerate after a
dependency change.

## Runtime dependency

| Component                                                                   | Version                | License    | How it is used                                                                                                                                                      |
| --------------------------------------------------------------------------- | ---------------------- | ---------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [microsandbox](https://github.com/superradcompany/microsandbox) (`msb` CLI) | latest at install time | Apache-2.0 | **Not distributed.** `scripts/install-msb.sh` downloads the CLI from `install.microsandbox.dev` on the host; the API shells out to it. Copyright Super Rad Company. |

### Inside the runtime (not distributed by this repository)

| Component                                            | License                                                                          | Notes                                                                                                |
| ---------------------------------------------------- | -------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------- |
| [libkrun](https://github.com/containers/libkrun)     | Apache-2.0                                                                       | microsandbox links it through `msb_krun` 0.1.45, a fork published without a license field            |
| [libkrunfw](https://github.com/containers/libkrunfw) | LGPL-2.1-only (library code); GPL-2.0-only (bundled Linux kernel and `patches/`) | vendored into microsandbox through the `vendor/libkrunfw` submodule and linked into the `msb` binary |
| [smoltcp](https://github.com/smoltcp-rs/smoltcp)     | 0BSD                                                                             | microsandbox uses `msb_smoltcp` 0.14.0, a fork published without a license field                     |

None of these ship with spaces: `msb` is installed on the host, not redistributed here, so this
Apache-2.0 distribution is unaffected by their terms. **If the CLI is ever bundled into a release,
revisit this section first** — LGPL-2.1-only relinking and source-offer obligations would apply, and the
GPL-2.0-only kernel and patch files inside libkrunfw would need their own analysis.

No microsandbox source, binary or image is vendored into this repository. The guest image this project
builds is `ubuntu:24.04` plus distribution packages (`deploy/guest/Dockerfile`).

## Installed packages

231 packages · MIT 166 · Apache-2.0 33 · BSD-3-Clause 13 · ISC 7 · OFL-1.1 5 · MPL-2.0 2 · 0BSD 2 · CC-BY-4.0 1 · BlueOak-1.0.0 1 · Unlicense 1

| Package                                    | Version       | License       | Relationship        |
| ------------------------------------------ | ------------- | ------------- | ------------------- |
| `@babel/code-frame`                        | 7.29.7        | MIT           | transitive          |
| `@babel/compat-data`                       | 7.29.7        | MIT           | transitive          |
| `@babel/core`                              | 7.29.13       | MIT           | transitive          |
| `@babel/generator`                         | 7.29.14       | MIT           | transitive          |
| `@babel/helper-compilation-targets`        | 7.29.13       | MIT           | transitive          |
| `@babel/helper-globals`                    | 7.29.7        | MIT           | transitive          |
| `@babel/helper-module-imports`             | 7.29.7        | MIT           | transitive          |
| `@babel/helper-module-transforms`          | 7.29.14       | MIT           | transitive          |
| `@babel/helper-plugin-utils`               | 7.29.7        | MIT           | transitive          |
| `@babel/helper-string-parser`              | 7.29.14       | MIT           | transitive          |
| `@babel/helper-validator-identifier`       | 7.29.7        | MIT           | transitive          |
| `@babel/helper-validator-option`           | 7.29.7        | MIT           | transitive          |
| `@babel/helpers`                           | 7.29.14       | MIT           | transitive          |
| `@babel/parser`                            | 7.29.14       | MIT           | transitive          |
| `@babel/plugin-transform-react-jsx-self`   | 7.29.7        | MIT           | transitive          |
| `@babel/plugin-transform-react-jsx-source` | 7.29.7        | MIT           | transitive          |
| `@babel/runtime`                           | 8.1.2         | MIT           | transitive          |
| `@babel/template`                          | 7.29.7        | MIT           | transitive          |
| `@babel/traverse`                          | 7.29.14       | MIT           | transitive          |
| `@babel/types`                             | 7.29.14       | MIT           | transitive          |
| `@base-ui/react`                           | 1.9.0         | MIT           | direct, runtime     |
| `@base-ui/utils`                           | 0.5.0         | MIT           | transitive          |
| `@better-auth/api-key`                     | 1.7.25        | MIT           | direct, runtime     |
| `@better-auth/core`                        | 1.7.25        | MIT           | transitive          |
| `@better-auth/drizzle-adapter`             | 1.7.25        | MIT           | transitive          |
| `@better-auth/kysely-adapter`              | 1.7.25        | MIT           | transitive          |
| `@better-auth/memory-adapter`              | 1.7.25        | MIT           | transitive          |
| `@better-auth/mongo-adapter`               | 1.7.25        | MIT           | transitive          |
| `@better-auth/prisma-adapter`              | 1.7.25        | MIT           | transitive          |
| `@better-auth/telemetry`                   | 1.7.25        | MIT           | transitive          |
| `@better-auth/utils`                       | 0.5.1         | MIT           | transitive          |
| `@better-fetch/fetch`                      | 1.3.3         | MIT           | transitive          |
| `@dnd-kit/accessibility`                   | 3.1.1         | MIT           | transitive          |
| `@dnd-kit/core`                            | 6.3.1         | MIT           | direct, runtime     |
| `@dnd-kit/modifiers`                       | 9.0.0         | MIT           | direct, runtime     |
| `@dnd-kit/sortable`                        | 10.0.0        | MIT           | direct, runtime     |
| `@dnd-kit/utilities`                       | 3.2.2         | MIT           | direct, runtime     |
| `@drizzle-team/brocli`                     | 0.10.2        | Apache-2.0    | transitive          |
| `@emnapi/core`                             | 1.11.3        | MIT           | transitive          |
| `@emnapi/runtime`                          | 1.11.3        | MIT           | transitive          |
| `@emnapi/wasi-threads`                     | 1.2.3         | MIT           | transitive          |
| `@esbuild-kit/core-utils`                  | 3.3.2         | MIT           | transitive          |
| `@esbuild-kit/esm-loader`                  | 2.6.5         | MIT           | transitive          |
| `@esbuild/darwin-arm64`                    | 0.18.20       | MIT           | transitive          |
| `@esbuild/darwin-arm64`                    | 0.25.12       | MIT           | transitive          |
| `@esbuild/darwin-arm64`                    | 0.28.2        | MIT           | transitive          |
| `@floating-ui/core`                        | 1.8.0         | MIT           | transitive          |
| `@floating-ui/dom`                         | 1.8.0         | MIT           | transitive          |
| `@floating-ui/react-dom`                   | 2.1.9         | MIT           | transitive          |
| `@floating-ui/utils`                       | 0.2.12        | MIT           | transitive          |
| `@fontsource-variable/geist`               | 5.3.0         | OFL-1.1       | transitive          |
| `@fontsource-variable/geist-mono`          | 5.3.0         | OFL-1.1       | transitive          |
| `@fontsource-variable/instrument-sans`     | 5.3.0         | OFL-1.1       | transitive          |
| `@fontsource-variable/jetbrains-mono`      | 5.3.0         | OFL-1.1       | transitive          |
| `@fontsource-variable/mona-sans`           | 5.3.0         | OFL-1.1       | transitive          |
| `@headless-tree/core`                      | 1.8.0         | MIT           | direct, runtime     |
| `@hono/zod-validator`                      | 0.9.1         | MIT           | direct, runtime     |
| `@jridgewell/gen-mapping`                  | 0.3.13        | MIT           | transitive          |
| `@jridgewell/remapping`                    | 2.3.5         | MIT           | transitive          |
| `@jridgewell/resolve-uri`                  | 3.1.3         | MIT           | transitive          |
| `@jridgewell/sourcemap-codec`              | 1.6.0         | MIT           | transitive          |
| `@jridgewell/trace-mapping`                | 0.3.31        | MIT           | transitive          |
| `@napi-rs/wasm-runtime`                    | 1.2.2         | MIT           | transitive          |
| `@noble/ciphers`                           | 2.4.0         | MIT           | transitive          |
| `@noble/hashes`                            | 2.4.0         | MIT           | transitive          |
| `@opentelemetry/api`                       | 1.10.0        | Apache-2.0    | direct, runtime     |
| `@opentelemetry/api-logs`                  | 0.57.2        | Apache-2.0    | transitive          |
| `@opentelemetry/context-async-hooks`       | 1.30.1        | Apache-2.0    | direct, runtime     |
| `@opentelemetry/context-async-hooks`       | 3.1.1         | Apache-2.0    | direct, runtime     |
| `@opentelemetry/core`                      | 1.30.1        | Apache-2.0    | direct, runtime     |
| `@opentelemetry/core`                      | 2.12.1        | Apache-2.0    | direct, runtime     |
| `@opentelemetry/core`                      | 3.1.1         | Apache-2.0    | direct, runtime     |
| `@opentelemetry/exporter-trace-otlp-http`  | 0.301.2       | Apache-2.0    | direct, runtime     |
| `@opentelemetry/exporter-trace-otlp-http`  | 0.57.2        | Apache-2.0    | direct, runtime     |
| `@opentelemetry/otlp-exporter-base`        | 0.301.2       | Apache-2.0    | transitive          |
| `@opentelemetry/otlp-exporter-base`        | 0.57.2        | Apache-2.0    | transitive          |
| `@opentelemetry/otlp-transformer`          | 0.301.2       | Apache-2.0    | transitive          |
| `@opentelemetry/otlp-transformer`          | 0.57.2        | Apache-2.0    | transitive          |
| `@opentelemetry/resources`                 | 1.30.1        | Apache-2.0    | direct, runtime     |
| `@opentelemetry/resources`                 | 2.12.1        | Apache-2.0    | direct, runtime     |
| `@opentelemetry/resources`                 | 3.1.1         | Apache-2.0    | direct, runtime     |
| `@opentelemetry/sdk-logs`                  | 0.57.2        | Apache-2.0    | transitive          |
| `@opentelemetry/sdk-logs`                  | 3.1.1         | Apache-2.0    | transitive          |
| `@opentelemetry/sdk-metrics`               | 1.30.1        | Apache-2.0    | transitive          |
| `@opentelemetry/sdk-metrics`               | 3.1.1         | Apache-2.0    | transitive          |
| `@opentelemetry/sdk-trace`                 | 2.12.1        | Apache-2.0    | transitive          |
| `@opentelemetry/sdk-trace`                 | 3.1.1         | Apache-2.0    | transitive          |
| `@opentelemetry/sdk-trace-base`            | 1.30.1        | Apache-2.0    | direct, runtime     |
| `@opentelemetry/sdk-trace-base`            | 2.12.1        | Apache-2.0    | direct, runtime     |
| `@opentelemetry/semantic-conventions`      | 1.28.0        | Apache-2.0    | transitive          |
| `@opentelemetry/semantic-conventions`      | 1.45.0        | Apache-2.0    | transitive          |
| `@oxfmt/binding-darwin-arm64`              | 0.74.0        | MIT           | transitive          |
| `@oxlint/binding-darwin-arm64`             | 1.93.0        | MIT           | transitive          |
| `@protobufjs/aspromise`                    | 1.1.2         | BSD-3-Clause  | transitive          |
| `@protobufjs/base64`                       | 1.1.2         | BSD-3-Clause  | transitive          |
| `@protobufjs/codegen`                      | 2.0.5         | BSD-3-Clause  | transitive          |
| `@protobufjs/eventemitter`                 | 1.1.1         | BSD-3-Clause  | transitive          |
| `@protobufjs/fetch`                        | 1.1.1         | BSD-3-Clause  | transitive          |
| `@protobufjs/float`                        | 1.0.2         | BSD-3-Clause  | transitive          |
| `@protobufjs/path`                         | 1.1.2         | BSD-3-Clause  | transitive          |
| `@protobufjs/pool`                         | 1.1.0         | BSD-3-Clause  | transitive          |
| `@protobufjs/utf8`                         | 1.1.2         | BSD-3-Clause  | transitive          |
| `@rolldown/pluginutils`                    | 1.0.0-beta.27 | MIT           | transitive          |
| `@rolldown/pluginutils`                    | 1.1.1         | MIT           | transitive          |
| `@rollup/rollup-darwin-arm64`              | 4.68.3        | MIT           | transitive          |
| `@standard-schema/spec`                    | 1.1.0         | MIT           | transitive          |
| `@tailwindcss/node`                        | 4.3.5         | MIT           | transitive          |
| `@tailwindcss/oxide`                       | 4.3.5         | MIT           | transitive          |
| `@tailwindcss/oxide-darwin-arm64`          | 4.3.5         | MIT           | transitive          |
| `@tailwindcss/oxide-wasm32-wasi`           | 4.3.5         | MIT           | transitive          |
| `@tailwindcss/vite`                        | 4.3.5         | MIT           | direct, development |
| `@tanstack/history`                        | 1.162.5       | MIT           | transitive          |
| `@tanstack/react-router`                   | 1.170.46      | MIT           | direct, runtime     |
| `@tanstack/react-store`                    | 0.11.2        | MIT           | transitive          |
| `@tanstack/react-table`                    | 9.3.1         | MIT           | direct, runtime     |
| `@tanstack/react-virtual`                  | 3.14.26       | MIT           | direct, runtime     |
| `@tanstack/router-core`                    | 1.171.39      | MIT           | transitive          |
| `@tanstack/router-generator`               | 1.168.0       | MIT           | transitive          |
| `@tanstack/router-plugin`                  | 1.169.0       | MIT           | direct, development |
| `@tanstack/router-utils`                   | 1.163.0       | MIT           | transitive          |
| `@tanstack/store`                          | 0.11.2        | MIT           | transitive          |
| `@tanstack/table-core`                     | 9.3.1         | MIT           | transitive          |
| `@tanstack/virtual-core`                   | 3.19.11       | MIT           | transitive          |
| `@tanstack/virtual-file-routes`            | 1.162.0       | MIT           | transitive          |
| `@tybys/wasm-util`                         | 0.10.3        | MIT           | transitive          |
| `@types/babel__core`                       | 7.20.5        | MIT           | transitive          |
| `@types/babel__generator`                  | 7.27.0        | MIT           | transitive          |
| `@types/babel__template`                   | 7.4.4         | MIT           | transitive          |
| `@types/babel__traverse`                   | 7.28.0        | MIT           | transitive          |
| `@types/bun`                               | 1.4.4         | MIT           | direct, development |
| `@types/estree`                            | 1.0.10        | MIT           | transitive          |
| `@types/node`                              | 26.6.6        | MIT           | transitive          |
| `@types/react`                             | 19.3.0        | MIT           | direct, development |
| `@types/react-dom`                         | 19.3.0        | MIT           | direct, development |
| `@vitejs/plugin-react`                     | 4.7.0         | MIT           | direct, development |
| `ansis`                                    | 4.5.0         | ISC           | transitive          |
| `babel-dead-code-elimination`              | 1.0.12        | MIT           | transitive          |
| `baseline-browser-mapping`                 | 2.11.37       | Apache-2.0    | transitive          |
| `better-auth`                              | 1.7.25        | MIT           | direct, runtime     |
| `better-call`                              | 1.4.5         | MIT           | transitive          |
| `browserslist`                             | 4.29.5        | MIT           | transitive          |
| `buffer-from`                              | 1.1.2         | MIT           | transitive          |
| `bun-types`                                | 1.4.4         | MIT           | transitive          |
| `caniuse-lite`                             | 1.0.30001826  | CC-BY-4.0     | transitive          |
| `chokidar`                                 | 5.0.0         | MIT           | transitive          |
| `class-variance-authority`                 | 0.7.1         | Apache-2.0    | direct, runtime     |
| `clsx`                                     | 2.1.1         | MIT           | direct, runtime     |
| `cn`                                       | 0.5.2         | MIT           | direct, runtime     |
| `convert-source-map`                       | 2.0.0         | MIT           | transitive          |
| `cookie-es`                                | 3.1.1         | MIT           | transitive          |
| `csstype`                                  | 3.2.3         | MIT           | transitive          |
| `debug`                                    | 4.4.3         | MIT           | transitive          |
| `defu`                                     | 6.1.7         | MIT           | transitive          |
| `detect-libc`                              | 2.1.2         | Apache-2.0    | transitive          |
| `diff`                                     | 9.0.0         | BSD-3-Clause  | transitive          |
| `drizzle-kit`                              | 0.31.11       | MIT           | direct, development |
| `drizzle-orm`                              | 0.45.4        | Apache-2.0    | direct, runtime     |
| `electron-to-chromium`                     | 1.5.486       | ISC           | transitive          |
| `enhanced-resolve`                         | 5.27.0        | MIT           | transitive          |
| `esbuild`                                  | 0.18.20       | MIT           | transitive          |
| `esbuild`                                  | 0.25.12       | MIT           | transitive          |
| `esbuild`                                  | 0.28.2        | MIT           | transitive          |
| `escalade`                                 | 3.2.0         | MIT           | transitive          |
| `fdir`                                     | 6.5.0         | MIT           | transitive          |
| `fsevents`                                 | 2.3.3         | MIT           | transitive          |
| `gensync`                                  | 1.0.0-beta.2  | MIT           | transitive          |
| `get-tsconfig`                             | 4.14.3        | MIT           | transitive          |
| `graceful-fs`                              | 4.2.12        | BlueOak-1.0.0 | transitive          |
| `hono`                                     | 4.13.18       | MIT           | direct, runtime     |
| `isbot`                                    | 5.2.3         | Unlicense     | transitive          |
| `jiti`                                     | 2.7.0         | MIT           | transitive          |
| `jose`                                     | 6.2.17        | MIT           | transitive          |
| `js-tokens`                                | 4.0.0         | MIT           | transitive          |
| `jsesc`                                    | 3.1.0         | MIT           | transitive          |
| `json5`                                    | 2.2.3         | MIT           | transitive          |
| `kysely`                                   | 0.29.9        | MIT           | transitive          |
| `lightningcss`                             | 1.33.0        | MPL-2.0       | transitive          |
| `lightningcss-darwin-arm64`                | 1.33.0        | MPL-2.0       | transitive          |
| `long`                                     | 5.3.2         | Apache-2.0    | transitive          |
| `lru-cache`                                | 5.1.1         | ISC           | transitive          |
| `lucide-react`                             | 1.73.0        | ISC           | direct, runtime     |
| `magic-string`                             | 0.30.21       | MIT           | transitive          |
| `magic-string`                             | 1.4.5         | MIT           | transitive          |
| `ms`                                       | 2.1.3         | MIT           | transitive          |
| `nanoid`                                   | 3.3.20        | MIT           | transitive          |
| `nanostores`                               | 1.5.5         | MIT           | transitive          |
| `node-releases`                            | 2.0.64        | MIT           | transitive          |
| `oxfmt`                                    | 0.74.0        | MIT           | direct, development |
| `oxlint`                                   | 1.93.0        | MIT           | direct, development |
| `pathe`                                    | 2.0.3         | MIT           | transitive          |
| `picocolors`                               | 1.1.1         | ISC           | transitive          |
| `picomatch`                                | 4.0.7         | MIT           | transitive          |
| `postcss`                                  | 8.5.33        | MIT           | transitive          |
| `prettier`                                 | 3.10.1        | MIT           | transitive          |
| `protobufjs`                               | 7.6.6         | BSD-3-Clause  | transitive          |
| `react`                                    | 19.3.1        | MIT           | direct, runtime     |
| `react-dom`                                | 19.3.1        | MIT           | direct, runtime     |
| `react-refresh`                            | 0.17.0        | MIT           | transitive          |
| `readdirp`                                 | 5.1.1         | MIT           | transitive          |
| `reselect`                                 | 5.3.0         | MIT           | transitive          |
| `resolve-pkg-maps`                         | 1.0.0         | MIT           | transitive          |
| `rollup`                                   | 4.68.3        | MIT           | transitive          |
| `rou3`                                     | 0.9.2         | MIT           | transitive          |
| `scheduler`                                | 0.28.0        | MIT           | transitive          |
| `semver`                                   | 6.3.2         | ISC           | transitive          |
| `seroval`                                  | 1.8.1         | MIT           | transitive          |
| `seroval-plugins`                          | 1.8.0         | MIT           | transitive          |
| `set-cookie-parser`                        | 3.2.2         | MIT           | transitive          |
| `sonner`                                   | 2.0.8         | MIT           | direct, runtime     |
| `source-map`                               | 0.6.1         | BSD-3-Clause  | transitive          |
| `source-map-js`                            | 1.2.2         | BSD-3-Clause  | transitive          |
| `source-map-support`                       | 0.5.21        | MIT           | transitive          |
| `tailwind-merge`                           | 3.7.0         | MIT           | direct, runtime     |
| `tailwindcss`                              | 4.3.5         | MIT           | direct, development |
| `tapable`                                  | 2.3.4         | MIT           | transitive          |
| `tinyglobby`                               | 0.2.17        | MIT           | transitive          |
| `tinypool`                                 | 2.2.0         | MIT           | transitive          |
| `tslib`                                    | 2.8.1         | 0BSD          | transitive          |
| `tslib`                                    | 2.9.1         | 0BSD          | transitive          |
| `tsx`                                      | 4.23.15       | MIT           | transitive          |
| `tw-animate-css`                           | 1.4.0         | MIT           | direct, runtime     |
| `typescript`                               | 5.9.3         | Apache-2.0    | direct, development |
| `undici-types`                             | 8.9.0         | MIT           | transitive          |
| `unplugin`                                 | 3.7.0         | MIT           | transitive          |
| `update-browserslist-db`                   | 1.3.4         | MIT           | transitive          |
| `use-sync-external-store`                  | 1.7.0         | MIT           | transitive          |
| `vite`                                     | 6.4.6         | MIT           | direct, development |
| `webpack-virtual-modules`                  | 0.6.2         | MIT           | transitive          |
| `yallist`                                  | 3.1.1         | ISC           | transitive          |
| `zod`                                      | 3.25.76       | MIT           | direct, runtime     |
| `zod`                                      | 4.6.7         | MIT           | direct, runtime     |

## Notes

- Development-only packages (oxlint, oxfmt, TypeScript, Vite, drizzle-kit) are not part of a
  production install, but are listed here for completeness.
- `lightningcss` is MPL-2.0 (file-level copyleft). It is used unmodified at build time and is
  compatible with distributing this project under Apache-2.0.
- `caniuse-lite` is CC-BY-4.0 data, not code; attribution travels with the package.
- The `@fontsource-variable/*` fonts (OFL-1.1) are present in `apps/web/node_modules` but are
  neither declared nor imported, so they are not shipped in the built console.
- No GPL, AGPL, LGPL, SSPL or other strong-copyleft package is installed, and no package has an
  unknown license.
