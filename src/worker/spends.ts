import { and, eq } from "drizzle-orm";
import { Hono } from "hono";
import * as z from "zod";
import { checkSpend } from "../money";
import { current } from "./current";
import { pot, spend } from "./db/schema";
import { json } from "./json";
import type { SignedIn } from "./user-check";

const note = z
  .string()
  .nullish()
  .transform((n) => n?.trim() || null);

/** The pot it comes from (item 7); null means free money. */
const potId = z.uuid().nullish();

const newSpend = z.object({
  id: z.uuid(),
  spentOn: z.string(),
  amountMinor: z.number().int(),
  note,
  potId,
});

const changeSpend = z.object({ spentOn: z.string(), amountMinor: z.number().int(), note, potId }).partial();

/** The signed-in user's pot with this id, as `checkSpend` needs it; none when there is no such pot. */
async function potsFor(c: { var: SignedIn["Variables"] }, id: string | null | undefined) {
  if (!id) return [];
  const { db, mine } = c.var;
  const found = await db.query.pot.findFirst({
    where: and(mine(pot), eq(pot.id, id)),
    columns: { id: true, currency: true, archived: true },
  });
  return found ? [found] : [];
}

/**
 * Spends (backlog items 4 and 7, spec 4, 7 and 10): add, change and delete, in
 * the current cycle only (ended cycles are locked), from free money or a pot in
 * use. The phone works out every number.
 */
export const spends = new Hono<SignedIn>()
  .post("/spends", json(newSpend), async (c) => {
    const { db, userId } = c.var;
    const b = c.req.valid("json");
    const now = await current(c);
    if (!now) return c.json({ error: "not_set_up" as const }, 404);
    const row = { ...b, potId: b.potId ?? null, currency: now.settings.spendingCurrency };
    const problems = checkSpend(row, {
      today: now.today,
      cycleStartedOn: now.cycle.startedOn,
      spendingCurrency: now.settings.spendingCurrency,
      pots: await potsFor(c, row.potId),
    });
    if (problems.length) return c.json({ error: "invalid" as const, problems }, 400);
    try {
      await db.insert(spend).values({ ...row, userId, cycleId: now.cycle.id });
    } catch {
      // The id is already in use.
      return c.json({ error: "conflict" as const }, 409);
    }
    return c.json({ ok: true as const, cycleId: now.cycle.id }, 201);
  })
  .patch("/spends/:id", json(changeSpend), async (c) => {
    const { db, mine } = c.var;
    const b = c.req.valid("json");
    const id = c.req.param("id");
    const now = await current(c);
    const old = await db.query.spend.findFirst({ where: and(mine(spend), eq(spend.id, id)) });
    if (!now || !old) return c.json({ error: "not_found" as const }, 404);
    if (old.cycleId !== now.cycle.id) return c.json({ error: "locked" as const }, 409);
    const next = { ...old, ...b, potId: b.potId === undefined ? old.potId : b.potId };
    const problems = checkSpend(next, {
      today: now.today,
      cycleStartedOn: now.cycle.startedOn,
      spendingCurrency: now.settings.spendingCurrency,
      pots: await potsFor(c, next.potId),
      keepPotId: old.potId,
    });
    if (problems.length) return c.json({ error: "invalid" as const, problems }, 400);
    await db
      .update(spend)
      .set({ spentOn: next.spentOn, amountMinor: next.amountMinor, note: next.note, potId: next.potId })
      .where(and(mine(spend), eq(spend.id, id)));
    return c.json({ ok: true as const });
  })
  .delete("/spends/:id", async (c) => {
    const { db, mine } = c.var;
    const id = c.req.param("id");
    const now = await current(c);
    const old = await db.query.spend.findFirst({
      where: and(mine(spend), eq(spend.id, id)),
      columns: { cycleId: true },
    });
    if (!now || !old) return c.json({ error: "not_found" as const }, 404);
    if (old.cycleId !== now.cycle.id) return c.json({ error: "locked" as const }, 409);
    await db.delete(spend).where(and(mine(spend), eq(spend.id, id)));
    return c.json({ ok: true as const });
  });
