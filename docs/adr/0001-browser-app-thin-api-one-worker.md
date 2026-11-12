# Browser app with a thin Hono API on one Worker, D1 through Drizzle

Decided in ticket 07, 2026-11-12. The app has to cost nothing on Cloudflare's free tier, where static asset requests are free and unlimited but each Worker request gets only 10 ms of CPU (ticket 01). So the screens are a React single-page app in TypeScript, served as static assets. One Worker runs a thin Hono JSON API that only reads and saves data, and Hono RPC shares types with the screens. D1 is the only store, accessed through Drizzle; schema changes are plain SQL migration files applied with `wrangler d1 migrations`. Everything lives in one project with one install and one deploy.

## Considered options

- **Server-rendered pages, or a mix with hydration**: rejected. Each screen would spend Worker CPU, and offline use would be harder later.
- **Svelte or Vue**: rejected in favour of React, which has the largest pool of possible contributors.
- **Plain SQL or Kysely**: rejected in favour of Drizzle, which keeps typed queries and generated SQL migrations.
- **Split packages (monorepo)**: more setup than a small app needs.
