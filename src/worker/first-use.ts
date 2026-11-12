import { and, desc, eq } from "drizzle-orm";
import { Hono } from "hono";
import { validator } from "hono/validator";
import * as z from "zod";
import { checkFirstUse, isTimeZone, todayIn } from "../money";
import { cycle, income, settings } from "./db/schema";
import type { SignedIn } from "./user-check";

const firstUseBody = z.object({
  settingsId: z.uuid(),
  cycleId: z.uuid(),
  incomeId: z.uuid(),
  salaryCurrency: z.string(),
  spendingCurrency: z.string(),
  homeTimeZone: z.string(),
  usualPayDay: z.number().int(),
  heldMinor: z.number().int(),
  expectedSalaryOn: z.string(),
});

const settingsBody = z
  .object({ usualPayDay: z.number().int().min(1).max(31), homeTimeZone: z.string().refine(isTimeZone) })
  .partial();

function json<T extends z.ZodType>(schema: T) {
  return validator("json", (value, c) => {
    const parsed = schema.safeParse(value);
    if (!parsed.success) return c.json({ error: "bad_request" as const }, 400);
    return parsed.data as z.infer<T>;
  });
}

/**
 * First use and the Today numbers' entries (backlog item 3, spec 2 and 10).
 * The phone works out every number with the money rules; this only reads and saves.
 */
export const firstUse = new Hono<SignedIn>()
  /** Settings, the current cycle and its entries: everything Today needs. */
  .get("/current", async (c) => {
    const { db, mine } = c.var;
    const s = await db.query.settings.findFirst({ where: mine(settings) });
    const current = await db.query.cycle.findFirst({
      where: mine(cycle),
      orderBy: [desc(cycle.startedOn), desc(cycle.createdAt)],
    });
    const incomes = current
      ? await db.query.income.findMany({ where: and(mine(income), eq(income.cycleId, current.id)) })
      : [];
    return c.json({
      settings: s
        ? {
            salaryCurrency: s.salaryCurrency,
            spendingCurrency: s.spendingCurrency,
            homeTimeZone: s.homeTimeZone,
            usualPayDay: s.usualPayDay,
          }
        : null,
      cycle: current
        ? { id: current.id, startedOn: current.startedOn, expectedSalaryOn: current.expectedSalaryOn }
        : null,
      incomes: incomes.map((i) => ({
        id: i.id,
        kind: i.kind,
        currency: i.currency,
        amountMinor: i.amountMinor,
        toSavingsMinor: i.toSavingsMinor,
        receivedOn: i.receivedOn,
      })),
    });
  })
  /** First use: settings row, the first cycle and its opening income, in one write. */
  .post("/first-use", json(firstUseBody), async (c) => {
    const { db, mine, userId } = c.var;
    const b = c.req.valid("json");
    const today = isTimeZone(b.homeTimeZone) ? todayIn(b.homeTimeZone, Date.now()) : "";
    const problems = checkFirstUse(b, today);
    if (problems.length) return c.json({ error: "invalid" as const, problems }, 400);
    if (await db.query.settings.findFirst({ where: mine(settings), columns: { id: true } })) {
      return c.json({ error: "already_set_up" as const }, 409);
    }
    try {
      await db.batch([
        db.insert(settings).values({
          id: b.settingsId,
          userId,
          salaryCurrency: b.salaryCurrency,
          spendingCurrency: b.spendingCurrency,
          homeTimeZone: b.homeTimeZone,
          usualPayDay: b.usualPayDay,
        }),
        db.insert(cycle).values({
          id: b.cycleId,
          userId,
          startedOn: today,
          expectedSalaryOn: b.expectedSalaryOn,
        }),
        db.insert(income).values({
          id: b.incomeId,
          userId,
          cycleId: b.cycleId,
          kind: "opening",
          currency: b.spendingCurrency,
          amountMinor: b.heldMinor,
          receivedOn: today,
        }),
      ]);
    } catch {
      // An id already in use (or a second phone finishing first use at the same time).
      return c.json({ error: "conflict" as const }, 409);
    }
    return c.json({ ok: true as const, startedOn: today }, 201);
  })
  /** Settings: usual pay day and home time zone (spec 10). Currencies are set once. */
  .patch("/settings", json(settingsBody), async (c) => {
    const { db, mine } = c.var;
    const b = c.req.valid("json");
    if (b.usualPayDay === undefined && b.homeTimeZone === undefined) {
      return c.json({ error: "bad_request" as const }, 400);
    }
    const done = await db.update(settings).set(b).where(mine(settings)).returning({ id: settings.id });
    if (!done.length) return c.json({ error: "not_set_up" as const }, 404);
    return c.json({ ok: true as const });
  });
