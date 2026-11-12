import type { BetterAuthPlugin } from "better-auth";
import { createAuthEndpoint } from "better-auth/api";
import { setSessionCookie } from "better-auth/cookies";
import * as z from "zod";

/**
 * "Sign in as demo user": local development and tests only (spec 13, ADR 0004).
 * Only added to Better Auth when `import.meta.env.DEV` is true, which Vite sets to
 * false in the production build, so this endpoint is not in the deployed Worker
 * (CI checks the build output for it).
 */
export const DEMO_EMAIL_DOMAIN = "demo.setaside.local";

/** Provisioning source name for demo users (lets the allowed-email check pass them, in DEV only). */
export const DEMO_METHOD = "demo";

export const demoUsers = {
  demo: { email: `demo@${DEMO_EMAIL_DOMAIN}`, name: "Demo user" },
  // Used by the shared "second user is refused" test.
  second: { email: `second@${DEMO_EMAIL_DOMAIN}`, name: "Second demo user" },
} as const;

export type DemoUser = keyof typeof demoUsers;

export const demoSignIn = () =>
  ({
    id: "demo-sign-in",
    endpoints: {
      demoSignIn: createAuthEndpoint(
        "/demo/sign-in",
        { method: "POST", body: z.object({ user: z.enum(["demo", "second"]).default("demo") }) },
        async (ctx) => {
          const who = demoUsers[ctx.body.user];
          const found = await ctx.context.internalAdapter.findUserByEmail(who.email);
          const user =
            found?.user ??
            (await ctx.context.internalAdapter.createUser(
              { ...who, emailVerified: true },
              { method: DEMO_METHOD },
            ));
          const session = await ctx.context.internalAdapter.createSession(user.id);
          await setSessionCookie(ctx, { session, user });
          return ctx.json({ user: { id: user.id, name: user.name, email: user.email } });
        },
      ),
    },
  }) satisfies BetterAuthPlugin;
