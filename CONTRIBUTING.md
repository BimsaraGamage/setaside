# Contributing to Setaside

Thanks for looking. Setaside is a small personal-finance app with a locked spec; changes are welcome when they fit it.

## Before you start

- **Rules live in [docs/spec.md](docs/spec.md).** Words in [GLOSSARY.md](GLOSSARY.md), decisions in [docs/adr/](docs/adr/), tables in [docs/data-model.md](docs/data-model.md). A change to how money is counted changes the spec in the same pull request.
- **Bigger than a fix?** Open an issue first (bug or feature form), so we agree on the rule before code is written.
- **Security problems:** never in a public issue. See [SECURITY.md](SECURITY.md).
- Be kind: [CODE_OF_CONDUCT.md](CODE_OF_CONDUCT.md).

## Set up

Node 24 (`nvm use`), then follow "Run it locally" in the [README](README.md). No Cloudflare account is needed for local work.

## Making a change

1. Branch from `main`: `<type>/<short-slug>`, e.g. `fix/allowance-rounding`.
2. **Money rules are written test-first** in `test/money/` (plain Node, no browser).
3. **Every new API route** runs behind the shared user check and gets a probe in `test/server/second-user.test.ts`; that test fails if a route has none.
4. Database changes: edit `src/worker/db/schema.ts`, then `npm run db:generate`. **Migrations are additive only** (new tables or columns).
5. Run before pushing: `npm run lint`, `npm run typecheck`, `npm run test:money`, `npm run test:server`, and `npm run e2e` if screens changed.
6. Open a pull request. Its **title is a [Conventional Commit](https://www.conventionalcommits.org/)** (`feat: …`, `fix: …`, `docs: …`, `chore: …`); CI checks it, and it becomes the changelog line. Mark a change **breaking** (`feat!: …`) when a self-hoster must do something by hand (a manual step, or a changed or new setting).
7. CI must pass (`all good`). Pull requests are squash-merged and the branch is deleted.

## Releases

release-please keeps a Release PR open with the next version and `CHANGELOG.md`. Merging it tags the release and deploys the maintainer's copy. See [docs/self-hosting.md](docs/self-hosting.md) to run your own.

By contributing you agree your work is released under the [MIT licence](LICENSE).
