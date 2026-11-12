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

## 5. Sign-in

Sign-in is bound to your address, so do this after picking the workers.dev name (1.2).

1. **Set the address**: in `wrangler.jsonc`, set `vars.APP_URL` to `https://setaside.<name>.workers.dev` (not a secret).
2. **Google OAuth client** (Google Cloud console → APIs & Services):
   - OAuth consent screen: External, basic scopes only (`openid`, `email`, `profile`), then **Publish app** so it is "In production", not "Testing". Basic scopes need no verification.
   - Credentials → Create OAuth client ID → Web application. Authorised JavaScript origin `https://setaside.<name>.workers.dev`; authorised redirect URI `https://setaside.<name>.workers.dev/api/auth/callback/google`.
   - Keep the client ID and secret for the next step.
3. **Worker secrets**, set once by hand (never in files or GitHub; releases leave them alone):

   | Secret                 | Value                                                        |
   | ---------------------- | ------------------------------------------------------------ |
   | `BETTER_AUTH_SECRET`   | a long random string, e.g. `openssl rand -base64 32`         |
   | `ALLOWED_EMAILS`       | Google addresses allowed to make an account, comma separated |
   | `GOOGLE_CLIENT_ID`     | from 5.2                                                     |
   | `GOOGLE_CLIENT_SECRET` | from 5.2                                                     |

   ```sh
   npx wrangler secret put BETTER_AUTH_SECRET
   npx wrangler secret put ALLOWED_EMAILS
   npx wrangler secret put GOOGLE_CLIENT_ID
   npx wrangler secret put GOOGLE_CLIENT_SECRET
   ```

4. After the next release: open the app, **Sign in with Google**, then Settings → Passkeys → **+ Add**. From then on sign in with the passkey; Google stays as backup. Losing both the passkey and the Google account means losing access.
5. Check CPU per sign-in once: Cloudflare dashboard → Workers → `setaside` → Observability, filter `/api/auth/`; CPU time should stay under 10 ms.

Changing who may sign up later means changing `ALLOWED_EMAILS` only.

## Later steps

Phone reminders (Web Push keys) add Worker secrets with `npx wrangler secret put <NAME>`. That step is added here by the backlog item that needs it.

## Updates

Pull the latest code into your fork, merge the Release PR. Migrations are additive only. A release that needs a manual step is marked breaking in `CHANGELOG.md`.
