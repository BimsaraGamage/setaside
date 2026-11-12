# Self-hosting Setaside

Everything here fits Cloudflare's and GitHub's free plans. Do these steps once; after that, updates are "pull, merge the Release PR".

Secrets never go into files or GitHub variables. Each step says **where** a value lives.

## 1. Cloudflare

1. Sign up at Cloudflare (free plan, no card).
2. **Pick your workers.dev name** (Workers & Pages → your subdomain). The app will live at `setaside.<name>.workers.dev`. Pick it before real use: sign-in is bound to this address.
3. Sign in locally: `npx wrangler login`.
4. **Create the database**: `npx wrangler d1 create setaside`. Copy the printed `database_id` into `wrangler.jsonc` (not a secret).
5. **Make an API token** (My Profile → API Tokens → Create custom token): permissions _Workers Scripts: Edit_ and _D1: Edit_, your account only. Keep it for step 3.
6. Note your **account ID** (Workers & Pages overview).

## 2. Release GitHub App

Lets the release workflow open the Release PR so CI runs on it.

1. GitHub → Settings → Developer settings → GitHub Apps → New. No webhook. Repository permissions: _Contents_, _Pull requests_, _Issues_: read and write.
2. Install it on your `setaside` repo only.
3. Note its **Client ID** and generate a **private key** (.pem).

## 3. GitHub repo settings

Settings → Secrets and variables → Actions:

| Kind     | Name                      | Value                      |
| -------- | ------------------------- | -------------------------- |
| Variable | `CLOUDFLARE_ACCOUNT_ID`   | account ID (1.6)           |
| Variable | `RELEASE_APP_CLIENT_ID`   | App Client ID (2.3)        |
| Secret   | `RELEASE_APP_PRIVATE_KEY` | contents of the .pem (2.3) |
| Secret   | `CLOUDFLARE_API_TOKEN`    | API token (1.5)            |

Create an environment named `production` (Settings → Environments). While the repo is private the token stays a repo secret; once public, move it into `production`.

## 4. First release

Merge a PR into `main`. release-please opens a Release PR; merging it runs the release: quick checks, Time Travel bookmark, migrations, deploy. Open `https://setaside.<name>.workers.dev`.

After the first deploy, check in the Cloudflare dashboard that **preview URLs are off** for the `setaside` Worker (`wrangler.jsonc` sets `preview_urls: false`).

## Later steps

Sign-in (Google OAuth client, Better Auth secret, allowed-email list) and phone reminders (Web Push keys) add Worker secrets with `npx wrangler secret put <NAME>`. Those steps are added here by the backlog items that need them.

## Updates

Pull the latest code into your fork, merge the Release PR. Migrations are additive only. A release that needs a manual step is marked breaking in `CHANGELOG.md`.
