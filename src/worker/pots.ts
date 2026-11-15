import { and, eq, ne } from "drizzle-orm";
import { Hono } from "hono";
import * as z from "zod";
import { checkPot } from "../money";
import { current } from "./current";
import { pot, potAllocation, spend } from "./db/schema";
import { json } from "./json";
import type { SignedIn } from "./user-check";

const name = z.string().transform((n) => n.trim());

const newPot = z.object({
  id: z.uuid(),
  /** This cycle's `pot_allocation` id. */
  allocationId: z.uuid(),
  name,
  usualAmountMinor: z.number().int(),
  amountMinor: z.number().int(),
});

const changePot = z
  .object({
    name,
    usualAmountMinor: z.number().int(),
    /** This cycle's amount; `allocationId` is used if the pot has none in this cycle yet. */
    amountMinor: z.number().int(),
    allocationId: z.uuid(),
    /** "Stop using this pot", or use it again. */
    archived: z.boolean(),
  })
  .partial();

/**
 * Pots (backlog item 7, spec 4 and 10): new, change, stop using, use again and
 * delete. A pot lasts across cycles; its amount is set aside per cycle in
 * `pot_allocation`, changed in the current cycle only. The phone works out every number.
 */
export const pots = new Hono<SignedIn>()
  .post("/pots", json(newPot), async (c) => {
    const { db, userId } = c.var;
    const { allocationId, amountMinor, ...b } = c.req.valid("json");
    const now = await current(c);
    if (!now) return c.json({ error: "not_set_up" as const }, 404);
    const row = { ...b, currency: now.settings.spendingCurrency };
    const problems = checkPot({ ...row, amountMinor }, { spendingCurrency: now.settings.spendingCurrency });
    if (problems.length) return c.json({ error: "invalid" as const, problems }, 400);
    try {
      await db.batch([
        db.insert(pot).values({ ...row, userId }),
        db
          .insert(potAllocation)
          .values({ id: allocationId, userId, potId: b.id, cycleId: now.cycle.id, amountMinor }),
      ]);
    } catch {
      // An id is already in use.
      return c.json({ error: "conflict" as const }, 409);
    }
    return c.json({ ok: true as const, cycleId: now.cycle.id }, 201);
  })
  .patch("/pots/:id", json(changePot), async (c) => {
    const { db, mine, userId } = c.var;
    const { allocationId, amountMinor, ...b } = c.req.valid("json");
    const id = c.req.param("id");
    const now = await current(c);
    const old = await db.query.pot.findFirst({ where: and(mine(pot), eq(pot.id, id)) });
    if (!now || !old) return c.json({ error: "not_found" as const }, 404);
    const alloc = await db.query.potAllocation.findFirst({
      where: and(mine(potAllocation), eq(potAllocation.potId, id), eq(potAllocation.cycleId, now.cycle.id)),
    });
    const next = { ...old, ...b, amountMinor: amountMinor ?? alloc?.amountMinor ?? 0 };
    const problems = checkPot(next, { spendingCurrency: now.settings.spendingCurrency });
    if (problems.length) return c.json({ error: "invalid" as const, problems }, 400);
    if (amountMinor !== undefined && !alloc && !allocationId)
      return c.json({ error: "bad_request" as const }, 400);
    const update = db
      .update(pot)
      .set({ name: next.name, usualAmountMinor: next.usualAmountMinor, archived: next.archived })
      .where(and(mine(pot), eq(pot.id, id)));
    try {
      if (amountMinor === undefined) {
        await update;
      } else if (alloc) {
        await db.batch([
          update,
          db
            .update(potAllocation)
            .set({ amountMinor })
            .where(and(mine(potAllocation), eq(potAllocation.id, alloc.id))),
        ]);
      } else {
        await db.batch([
          update,
          db.insert(potAllocation).values({
            id: allocationId as string,
            userId,
            potId: id,
            cycleId: now.cycle.id,
            amountMinor,
          }),
        ]);
      }
    } catch {
      // The allocation id is already in use.
      return c.json({ error: "conflict" as const }, 409);
    }
    return c.json({ ok: true as const });
  })
  .delete("/pots/:id", async (c) => {
    const { db, mine } = c.var;
    const id = c.req.param("id");
    const now = await current(c);
    const old = await db.query.pot.findFirst({
      where: and(mine(pot), eq(pot.id, id)),
      columns: { id: true },
    });
    if (!now || !old) return c.json({ error: "not_found" as const }, 404);
    // Deleting would change spends or an ended cycle: stop using it instead.
    const used = await db.query.spend.findFirst({
      where: and(mine(spend), eq(spend.potId, id)),
      columns: { id: true },
    });
    if (used) return c.json({ error: "has_spends" as const }, 409);
    const past = await db.query.potAllocation.findFirst({
      where: and(mine(potAllocation), eq(potAllocation.potId, id), ne(potAllocation.cycleId, now.cycle.id)),
      columns: { id: true },
    });
    if (past) return c.json({ error: "locked" as const }, 409);
    await db.delete(pot).where(and(mine(pot), eq(pot.id, id)));
    return c.json({ ok: true as const });
  });
