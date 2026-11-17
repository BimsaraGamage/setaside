import { eq } from "drizzle-orm";
import { Hono } from "hono";
import { deleteCookie } from "hono/cookie";
import * as z from "zod";
import { getAuth } from "./auth";
import { user } from "./db/schema";
import { json } from "./json";
import type { SignedIn } from "./user-check";

/** The word typed to confirm, exactly (spec 14). */
export const CONFIRM_WORD = "DELETE";

/**
 * Delete account (item 28, spec 14). Removes the signed-in user's row; every table's
 * owner column cascades from it (`ownerColumn()`), so every row with the user's id
 * goes in the same statement, sessions too, which signs out every device. The
 * route takes no ids: it can only ever delete the signed-in user.
 */
export const deleteAccount = new Hono<SignedIn>().post(
  "/account/delete",
  json(z.object({ confirm: z.literal(CONFIRM_WORD) })),
  async (c) => {
    const { db, userId } = c.var;
    await db.delete(user).where(eq(user.id, userId));
    // This device's sign-in cookies go too (the sessions are already gone).
    const { authCookies } = await getAuth(c.env, c.req.raw).$context;
    for (const cookie of [authCookies.sessionToken, authCookies.sessionData, authCookies.dontRememberToken]) {
      deleteCookie(c, cookie.name, {
        path: cookie.attributes.path ?? "/",
        secure: cookie.attributes.secure,
        sameSite: cookie.attributes.sameSite,
        httpOnly: true,
      });
    }
    return c.json({ ok: true as const }, 200);
  },
);
