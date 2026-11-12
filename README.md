# Setaside

After every salary, Setaside sets aside the **commitments** of the pay cycle and shows the **free money** left, a **daily allowance** for everyday spending, and whether the money will last to the next salary. Mobile-first web app, runs on Cloudflare's free plan, costs nothing to run.

Status: early build (backlog item 2 of 29). Rules: [docs/spec.md](docs/spec.md). Build order: [docs/backlog.md](docs/backlog.md). Words: [GLOSSARY.md](GLOSSARY.md). Decisions: [docs/adr/](docs/adr/).

## Run it locally

Needs Node 24 (`nvm use`). No Cloudflare account needed.

```sh
npm ci
npx playwright install chromium webkit   # once, for browser journeys
npm run db:migrate:local                  # local D1 database
npm run dev                               # http://localhost:5173
```

Sign in with **Sign in as demo user**: it exists only in local development (and tests), never in the live build; CI checks the build for it. Passkeys also work on `localhost`. No Google setup or `.dev.vars` is needed; the "Missing required secrets" warning is expected locally. To try Google sign-in locally, see `.dev.vars.example`.

| Command                           | What it does                                                           |
| --------------------------------- | ---------------------------------------------------------------------- |
| `npm run lint` / `npm run format` | Biome check / fix                                                      |
| `npm run typecheck`               | TypeScript, all projects                                               |
| `npm run test:money`              | money-rule tests (plain Node)                                          |
| `npm run test:server`             | API tests on a local D1 in the Workers runtime                         |
| `npm run e2e`                     | Playwright journeys, Chromium + WebKit at phone size                   |
| `npm run db:generate`             | new SQL migration from `src/worker/db/schema.ts` (additive only)       |
| `npm run types`                   | regenerate `worker-configuration.d.ts` after changing `wrangler.jsonc` |

## Layout

- `src/client/`: React screens (single-page app, static assets)
- `src/worker/`: one Worker, thin Hono JSON API under `/api`; Hono RPC types shared with the screens
  - `auth/`: Better Auth (passkey + Google, allowed-email list), demo sign-in for local use
  - `user-check.ts`: the one shared user check every private route runs behind; `test/server/second-user.test.ts` fails if a route has no probe
- `src/money/`: money rules, pure TypeScript, run on the phone and checked on the server
- `migrations/`: D1 SQL migrations (drizzle-kit)
- `test/money`, `test/server`, `e2e/`: tests

## Contributing

Every change goes through a pull request with a [Conventional Commits](https://www.conventionalcommits.org/) title and is squash-merged. Releases come from the release-please Release PR; merging it deploys.

## Self-hosting

See [docs/self-hosting.md](docs/self-hosting.md).

## Licence

[MIT](LICENSE)
