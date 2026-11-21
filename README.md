# Setaside

After every salary, Setaside sets aside the **commitments** of the pay cycle and shows the **free money** left, a **daily allowance** for everyday spending, and whether the money will last to the next salary. Mobile-first web app, runs on Cloudflare's free plan, costs nothing to run.

Status: v0.1: all 29 backlog items built. Rules: [docs/spec.md](docs/spec.md). Build order: [docs/backlog.md](docs/backlog.md). Words: [GLOSSARY.md](GLOSSARY.md). Decisions: [docs/adr/](docs/adr/).

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

## Feedback

`npm run feedback` reads what people sent from the app (see [docs/spec.md](docs/spec.md), "Feedback"). The **feedback job**
(`npm run feedback:auto`, `scripts/feedback-auto.mjs`) can also handle new feedback by itself: it sorts each one with a
read-only Claude run, answers the sender in the app, charts a ticket on the maintainer's planning map, and for a small fix
builds it on a pushed `fb/<id>` branch (tests first, all checks green). It never opens a PR, merges, deploys or releases.

- **Off by default**: it does nothing unless `SETASIDE_MAP` names the planning map folder.
- **Kept apart**: feedback text is untrusted. The AI works on copies outside the home folder and can't read
  home, so it never sees a login or key. Code it wrote runs only in a [bubblewrap](https://github.com/containers/bubblewrap)
  sandbox (`scripts/feedback-check.mjs`: no network, no home). A fix may change only `src/`, `test/` and `e2e/`.
- **Timer** (the maintainer's laptop): `~/.config/systemd/user/setaside-feedback.timer`, every 5 minutes.
  Turn it on: `systemctl --user enable --now setaside-feedback.timer`.
  Turn it off: `systemctl --user disable --now setaside-feedback.timer`.
  What it did: `journalctl --user -u setaside-feedback`; each Claude run's cost:
  `~/.local/state/setaside-feedback/runs.jsonl`.

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md) and the [Code of Conduct](CODE_OF_CONDUCT.md). Security problems: [SECURITY.md](SECURITY.md), reported privately.

## Self-hosting

See [docs/self-hosting.md](docs/self-hosting.md).

## Licence

[MIT](LICENSE)
