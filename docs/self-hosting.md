# Self-hosting Setaside

Everything here fits Cloudflare's and GitHub's free plans. Do these steps once; after that, updates are "pull, merge the Release PR".

Secrets never go into files or GitHub variables. Each step says **where** a value lives.

## 0. Your copy

1. **Fork** this repo (forks of a public repo are public; that's fine, no secret ever lives in it).
2. In your fork, **Actions → enable workflows** (forks start with Actions off).
3. Clone it and install: Node 24 (`nvm use`), then `npm ci`. Every `npx wrangler …` below runs inside the clone.

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

Then the Cloudflare token, used only by the release run:

1. Settings → Environments → **New environment** `production`.
2. Deployment branches and tags → **Selected branches and tags** → add `main`.
3. Environment secrets → `CLOUDFLARE_API_TOKEN` = API token (1.5).

GitHub Free has environments on **public** repos only (in a private repo on Free, environment secrets are ignored). If your copy is private, add `CLOUDFLARE_API_TOKEN` as a repo secret instead.

## 4. Sign-in and Worker secrets

Sign-in is bound to your address, so do this after picking the workers.dev name (1.2). Do it **before the first release**: the deploy refuses to run until the four sign-in secrets are on the Worker (`secrets.required` in `wrangler.jsonc`).

1. **Set the address**: in `wrangler.jsonc`, set `vars.APP_URL` to `https://setaside.<name>.workers.dev` (not a secret).
2. **Google OAuth client** (Google Cloud console → APIs & Services):
   - OAuth consent screen: External, basic scopes only (`openid`, `email`, `profile`). Leave it in **"Testing"** and add each address from `ALLOWED_EMAILS` (4.3) as a **test user**: only test users can sign in, which matches the allowed-email list. Publishing ("In production") needs a privacy policy link, which comes with public sign-up later.
   - Credentials → Create OAuth client ID → Web application. Authorised JavaScript origin `https://setaside.<name>.workers.dev`; authorised redirect URI `https://setaside.<name>.workers.dev/api/auth/callback/google`.
   - Keep the client ID and secret for the next step.
3. **Worker secrets**, set once by hand (never in files or GitHub; releases leave them alone):

   | Secret                 | Value                                                        |
   | ---------------------- | ------------------------------------------------------------ |
   | `BETTER_AUTH_SECRET`   | a long random string, e.g. `openssl rand -base64 32`         |
   | `ALLOWED_EMAILS`       | Google addresses allowed to make an account, comma separated |
   | `GOOGLE_CLIENT_ID`     | from 4.2                                                     |
   | `GOOGLE_CLIENT_SECRET` | from 4.2                                                     |

   Before the first release the Worker doesn't exist yet; `wrangler secret bulk` creates it. Put the four lines (`NAME=value`) in a file **outside the repo**, then:

   ```sh
   npx wrangler secret bulk ~/setaside-secrets.env
   rm ~/setaside-secrets.env
   ```

   Later changes to one secret: `npx wrangler secret put <NAME>`.

4. After the first release (5): open the app, **Sign in with Google** (Google may say the app is unverified or in testing: continue), then Settings → Sign-in → **+ Add**. From then on sign in with the passkey; Google stays as backup. Losing both the passkey and the Google account means losing access.
5. Check CPU per sign-in once: Cloudflare dashboard → Workers → `setaside` → Observability, filter `/api/auth/`; CPU time should stay under 10 ms.

Changing who may sign up later means changing `ALLOWED_EMAILS` only.

## 5. First release

Merge a PR into `main`. release-please opens a Release PR; merging it runs the release: quick checks, Time Travel bookmark, migrations, deploy. Open `https://setaside.<name>.workers.dev`.

After the first deploy, check in the Cloudflare dashboard that **preview URLs are off** for the `setaside` Worker (`wrangler.jsonc` sets `preview_urls: false`).

## Phone reminders

Phone notifications (spec 12) need a VAPID key pair as two more Worker secrets. Without them the app works the same, except Settings says phone alerts aren't set up and reminders only show at the top of Today.

1. Make the key pair on your computer (keep the private key to yourself):

   ```sh
   npx web-push generate-vapid-keys
   ```

2. Set both as Worker secrets (paste each key when asked):

   ```sh
   npx wrangler secret put VAPID_PUBLIC_KEY
   npx wrangler secret put VAPID_PRIVATE_KEY
   ```

3. On each phone: add the app to the Home Screen (on iPhone, iOS 16.4 or later: Share › Add to Home Screen), open it from there, then Settings → Reminders → **Turn on reminders**.
4. The cron runs every 15 minutes (`triggers` in `wrangler.jsonc`). Check CPU per run once: Cloudflare dashboard → Workers → `setaside` → Observability, filter the scheduled runs; each logs `{"reminders": {users, pushes, gone, failed}}`. CPU time should stay under 10 ms.

Changing the key pair later turns alerts off on every phone: each one taps Turn on reminders again.

## Updates

On GitHub, **Sync fork** (or pull upstream's `main` into yours), then merge the Release PR. Keep your own `database_id` and `APP_URL` in `wrangler.jsonc` if a sync touches them. Migrations are additive only. A release that needs a manual step is marked breaking in `CHANGELOG.md`.
