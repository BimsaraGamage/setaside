import { env as workerEnv } from "cloudflare:workers";
import { passkey } from "@better-auth/passkey";
import { type BetterAuthOptions, betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { drizzle } from "drizzle-orm/d1";
import * as schema from "../db/schema";
import { DEMO_METHOD, demoSignIn } from "./demo-sign-in";

/**
 * Login (spec 13, ADR 0004): passkey day to day, Google as backup and for the
 * first sign-in. No email login, no passwords. Better Auth runs in the Worker
 * on D1 through Drizzle.
 */

const DAY = 60 * 60 * 24;

/** Used only in local development when `.dev.vars` has no secret. Never in the live app. */
const LOCAL_DEV_SECRET = "local-development-only-secret-not-for-the-live-app";

/** `ALLOWED_EMAILS` is a comma- or space-separated list of Google addresses (a Worker secret). */
export function parseAllowedEmails(raw: string | undefined): Set<string> {
  return new Set(
    (raw ?? "")
      .split(/[\s,]+/)
      .map((e) => e.trim().toLowerCase())
      .filter(Boolean),
  );
}

/** The app's own address. Live: `APP_URL` from wrangler.jsonc. Local: whatever address the dev server runs on. */
export function appOrigin(env: Env, request: Request): string {
  if (import.meta.env.DEV) return new URL(request.url).origin;
  return new URL(env.APP_URL).origin;
}

type UserInfoCheck = NonNullable<NonNullable<BetterAuthOptions["user"]>["validateUserInfo"]>;

/** Gate for new accounts and new linked sign-ins. Returning sign-ins pass (spec 13). */
export function allowedEmailCheck(allowed: Set<string>): UserInfoCheck {
  return ({ user, source }) => {
    if (source.action === "sign-in") return;
    if (import.meta.env.DEV && source.method === DEMO_METHOD) return;
    const email = String(user.email ?? "").toLowerCase();
    if (!allowed.has(email))
      return { error: "not_allowed", errorDescription: "This account isn't on the list." };
  };
}

export function googleConfigured(env: Env): boolean {
  return Boolean(env.GOOGLE_CLIENT_ID && env.GOOGLE_CLIENT_SECRET);
}

function createAuth(env: Env, origin: string) {
  const secret = env.BETTER_AUTH_SECRET || (import.meta.env.DEV ? LOCAL_DEV_SECRET : undefined);
  if (!secret) throw new Error("BETTER_AUTH_SECRET is not set (see docs/self-hosting.md)");
  const allowed = parseAllowedEmails(env.ALLOWED_EMAILS);

  return betterAuth({
    appName: "Setaside",
    baseURL: origin,
    basePath: "/api/auth",
    secret,
    trustedOrigins: [origin],
    telemetry: { enabled: false },
    database: drizzleAdapter(drizzle(env.DB, { schema }), { provider: "sqlite", schema }),
    session: { expiresIn: 30 * DAY, updateAge: DAY },
    socialProviders: googleConfigured(env)
      ? {
          google: {
            clientId: env.GOOGLE_CLIENT_ID,
            clientSecret: env.GOOGLE_CLIENT_SECRET,
            // Basic scopes only (spec 18), so the Google app needs no verification.
            scope: ["openid", "email", "profile"],
            prompt: "select_account",
          },
        }
      : undefined,
    plugins: [
      passkey({ rpID: new URL(origin).hostname, rpName: "Setaside", origin }),
      ...(import.meta.env.DEV ? [demoSignIn()] : []),
    ],
    // Allowed-email list: only these Google accounts can make an account (or link
    // one). A refused Google sign-in comes back to the app with ?error=not_allowed.
    user: { validateUserInfo: allowedEmailCheck(allowed) },
  });
}

export type Auth = ReturnType<typeof createAuth>;

// One Better Auth instance per address, reused across requests in the same
// isolate, so it is not rebuilt on every request (10 ms CPU limit).
const cache = new Map<string, Auth>();

export function getAuth(env: Env, request: Request): Auth {
  const origin = appOrigin(env, request);
  let auth = cache.get(origin);
  if (!auth) cache.set(origin, (auth = createAuth(env, origin)));
  return auth;
}

// Live: build it while the Worker starts up, which has its own time limit,
// instead of inside the first request's 10 ms of CPU.
if (!import.meta.env.DEV) {
  try {
    const origin = new URL(workerEnv.APP_URL).origin;
    cache.set(origin, createAuth(workerEnv, origin));
  } catch {
    // Settings missing: the first request reports it.
  }
}
