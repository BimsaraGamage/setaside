# Login by passkey with Google as backup, no email login

Decided in ticket 08, 2026-11-12. Users sign in with a passkey day to day; Google sign-in is the backup and the way to make an account. Login runs inside the Worker through Better Auth (Hono + Drizzle on D1). Email login (magic link, one-time code, password reset) was rejected because the free tier cannot send email to other people (ticket 01). Cloudflare Access was rejected because it needs a card on file and does not fit a later in-app sign-up. Passwords were rejected: hashing them risks the 10 ms CPU limit, and passkeys need none.

## Consequences

- Passkeys and the Google sign-in setup are both tied to the web address, so the address must be fixed before real use; moving it later means new passkeys and a Google setup update.
- Account recovery depends on Google: losing both the passkey and the Google account means losing access.
- Contributors run locally with a demo-user sign-in that exists only in local development, so no Google setup is needed to build the app.
- CPU time per sign-in must be measured early in the build.
