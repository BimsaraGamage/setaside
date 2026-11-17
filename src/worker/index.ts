import { sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/d1";
import { Hono } from "hono";
import { getAuth, googleConfigured } from "./auth";
import { cards } from "./cards";
import { commitments } from "./commitments";
import { conversions } from "./conversions";
import { dayChoices } from "./day-choices";
import { dataExport } from "./export";
import { firstUse } from "./first-use";
import { past } from "./past";
import { payments } from "./payments";
import { people } from "./people";
import { plans } from "./plans";
import { pots } from "./pots";
import { prepayments } from "./prepayments";
import { push } from "./push";
import { sendReminders } from "./reminders-cron";
import { salaryDay } from "./salary-day";
import { savings } from "./savings";
import { spends } from "./spends";
import { type SignedIn, userCheck } from "./user-check";

export type Bindings = Env;

/** Routes anyone can call. Everything else is behind the user check (see the shared server test). */
export const PUBLIC_ROUTES = ["/api/health", "/api/sign-in-options", "/api/auth/*"] as const;

/** Private API: every route here runs behind the one shared user check. */
const signedIn = new Hono<SignedIn>()
  .use(userCheck)
  .get("/me", (c) => c.json({ user: c.var.user }))
  .route("/", firstUse)
  .route("/", spends)
  .route("/", commitments)
  .route("/", payments)
  .route("/", pots)
  .route("/", dayChoices)
  .route("/", savings)
  .route("/", prepayments)
  .route("/", conversions)
  .route("/", cards)
  .route("/", plans)
  .route("/", people)
  .route("/", past)
  .route("/", push)
  .route("/", dataExport)
  .route("/", salaryDay);

const app = new Hono<{ Bindings: Bindings }>()
  .basePath("/api")
  .get("/health", async (c) => {
    const db = drizzle(c.env.DB);
    const row = await db.get<{ ok: number }>(sql`select 1 as ok`);
    return c.json({ app: "setaside", database: row?.ok === 1 });
  })
  .get("/sign-in-options", (c) => c.json({ google: googleConfigured(c.env), demo: import.meta.env.DEV }))
  .on(["GET", "POST"], "/auth/*", (c) => getAuth(c.env, c.req.raw).handler(c.req.raw))
  .route("/", signedIn);

export type AppType = typeof app;
export { app };

export default {
  fetch: app.fetch,
  /** The reminder cron (item 26, spec 12): every 15 minutes, see wrangler.jsonc. */
  scheduled(controller, env, ctx) {
    ctx.waitUntil(
      sendReminders(env, controller.scheduledTime).then((r) => console.log(JSON.stringify({ reminders: r }))),
    );
  },
} satisfies ExportedHandler<Bindings>;
