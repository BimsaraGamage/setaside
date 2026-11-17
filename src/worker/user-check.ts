import { eq, type SQL } from "drizzle-orm";
import { type DrizzleD1Database, drizzle } from "drizzle-orm/d1";
import type { SQLiteColumn } from "drizzle-orm/sqlite-core";
import { createMiddleware } from "hono/factory";
import { getAuth } from "./auth";
import * as schema from "./db/schema";

/**
 * The one shared user check (spec 13). Every private route runs behind it: no
 * signed-in user means 401, and the route only gets `userId` plus `mine()`, which
 * scopes a query to that user. No private route reads `c.env.DB` directly; the one
 * fixed-SQL read of Today (`today-read.ts`) binds `userId` and scopes every table to it.
 */
export interface SignedIn {
  Bindings: Env;
  Variables: {
    userId: string;
    user: { id: string; name: string; email: string };
    /** `$client` is the D1 binding, for the one fixed-SQL batch of Today (`today-read.ts`). */
    db: DrizzleD1Database<typeof schema> & { $client: D1Database };
    /** `where` clause for "rows owned by the signed-in user". */
    mine: (table: { userId: SQLiteColumn }) => SQL;
  };
}

export const userCheck = createMiddleware<SignedIn>(async (c, next) => {
  const found = await getAuth(c.env, c.req.raw).api.getSession({ headers: c.req.raw.headers });
  if (!found) return c.json({ error: "signed_out" }, 401);
  const { id, name, email } = found.user;
  c.set("userId", id);
  c.set("user", { id, name, email });
  c.set("db", drizzle(c.env.DB, { schema }));
  c.set("mine", (table) => eq(table.userId, id));
  await next();
});
