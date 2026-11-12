import { sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/d1";
import { Hono } from "hono";

export type Bindings = Env;

const app = new Hono<{ Bindings: Bindings }>().basePath("/api").get("/health", async (c) => {
  const db = drizzle(c.env.DB);
  const row = await db.get<{ ok: number }>(sql`select 1 as ok`);
  return c.json({ app: "setaside", database: row?.ok === 1 });
});

export type AppType = typeof app;
export default app;
