import { and, eq } from "drizzle-orm";
import { Hono } from "hono";
import * as z from "zod";
import { checkCommitment } from "../money";
import { current } from "./current";
import { commitment } from "./db/schema";
import { json } from "./json";
import type { SignedIn } from "./user-check";

const name = z.string().transform((n) => n.trim());

const newCommitment = z.object({
  id: z.uuid(),
  name,
  plannedMinor: z.number().int(),
  dueOn: z.string(),
});

const changeCommitment = z
  .object({
    name,
    plannedMinor: z.number().int(),
    dueOn: z.string(),
    /** Mark finished, or reopen (item 6). Carried and dropped come with salary day (item 12). */
    state: z.enum(["open", "finished"]),
  })
  .partial();

/**
 * Commitments (backlog items 5 and 6, spec 3 and 10): add, change, mark finished,
 * reopen and delete bills in the current cycle only (ended cycles are locked).
 * Payments are in payments.ts. The phone works out every number.
 * Other kinds and "Every cycle" come with later items.
 */
export const commitments = new Hono<SignedIn>()
  .post("/commitments", json(newCommitment), async (c) => {
    const { db, userId } = c.var;
    const b = c.req.valid("json");
    const now = await current(c);
    if (!now) return c.json({ error: "not_set_up" as const }, 404);
    const row = { ...b, currency: now.settings.spendingCurrency };
    const problems = checkCommitment(row, {
      cycleStartedOn: now.cycle.startedOn,
      spendingCurrency: now.settings.spendingCurrency,
    });
    if (problems.length) return c.json({ error: "invalid" as const, problems }, 400);
    try {
      await db.insert(commitment).values({ ...row, userId, cycleId: now.cycle.id, kind: "bill" });
    } catch {
      // The id is already in use.
      return c.json({ error: "conflict" as const }, 409);
    }
    return c.json({ ok: true as const, cycleId: now.cycle.id }, 201);
  })
  .patch("/commitments/:id", json(changeCommitment), async (c) => {
    const { db, mine } = c.var;
    const b = c.req.valid("json");
    const id = c.req.param("id");
    const now = await current(c);
    const old = await db.query.commitment.findFirst({ where: and(mine(commitment), eq(commitment.id, id)) });
    if (!now || !old) return c.json({ error: "not_found" as const }, 404);
    if (old.cycleId !== now.cycle.id) return c.json({ error: "locked" as const }, 409);
    const next = { ...old, ...b };
    const problems = checkCommitment(next, {
      cycleStartedOn: now.cycle.startedOn,
      spendingCurrency: now.settings.spendingCurrency,
    });
    if (problems.length) return c.json({ error: "invalid" as const, problems }, 400);
    await db
      .update(commitment)
      .set({ name: next.name, plannedMinor: next.plannedMinor, dueOn: next.dueOn, state: next.state })
      .where(and(mine(commitment), eq(commitment.id, id)));
    return c.json({ ok: true as const });
  })
  .delete("/commitments/:id", async (c) => {
    const { db, mine } = c.var;
    const id = c.req.param("id");
    const now = await current(c);
    const old = await db.query.commitment.findFirst({
      where: and(mine(commitment), eq(commitment.id, id)),
      columns: { cycleId: true },
    });
    if (!now || !old) return c.json({ error: "not_found" as const }, 404);
    if (old.cycleId !== now.cycle.id) return c.json({ error: "locked" as const }, 409);
    await db.delete(commitment).where(and(mine(commitment), eq(commitment.id, id)));
    return c.json({ ok: true as const });
  });
