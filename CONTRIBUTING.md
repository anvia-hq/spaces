# Contributing

Outside contributions are welcome.

## Before you open a pull request

- Open an issue first for anything bigger than a bug fix or a small correction, so the approach can be
  agreed before you write it.
- Read [DEVELOPMENT.md](DEVELOPMENT.md) for building, testing and the guest image.
- Read [AGENTS.md](AGENTS.md) for the layout and the constraints (Bun only, TypeScript strict, no barrel
  files, types in `types.ts`), and [docs/decision/](docs/decision/README.md) for why the code is shaped
  the way it is.
- Run the same gates CI runs:

  ```sh
  bun run typecheck
  bun run lint
  bun run format:check
  bun run test:rules
  bun run test
  bun run build
  ```

- Keep a pull request to one change, with an imperative subject and no unrelated reformatting.

## License of contributions

Contributions are made under the [Apache License 2.0](LICENSE). By opening a pull request you agree to
license your work under those terms.

## Sign-off (DCO)

Every commit must be signed off under the [Developer Certificate of Origin 1.1](https://developercertificate.org):

```sh
git commit -s -m "fix(api): reject a symlink leaf on move"
```

That appends a trailer using your git identity:

```
Signed-off-by: Your Name <you@example.com>
```

The sign-off is your statement that you wrote the change or otherwise have the right to submit it under
the project's license. Pull requests with any unsigned commit fail the `DCO` check
(`.github/workflows/dco.yml`). To sign off every commit by default:

```sh
git config --global format.signoff true
```
