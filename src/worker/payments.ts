import { and, eq } from "drizzle-orm";
import { Hono } from "hono";
import * as z from "zod";
import { checkPayment } from "../money";
import { current } from "./current";
import { commitment, commitmentPayment } from "./db/schema";
import { json } from "./json";
import type { SignedIn } from "./user-check";

const newPayment = z.object({
  id: z.uuid(),
  amountMinor: z.number().int(),
  paidOn: z.string(),
  /** Mark the commitment finished in the same write ("Pay and finish"). */
  finish: z.boolean().optional(),
});

const changePayment = z.object({ amountMinor: z.number().int(), paidOn: z.string() }).partial();

/**
 * Paying commitments (backlog item 6, spec 3): payments in full or in parts, in
 * the current cycle only (ended cycles are locked). Paid more or less than
 * planned is allowed; the phone works out every number from the payments.
 */
export const payments = new Hono<SignedIn>()
  .post("/commitments/:id/payments", json(newPayment), async (c) => {
    const { db, mine, userId } = c.var;
    const { finish, ...b } = c.req.valid("json");
    const id = c.req.param("id");
    const now = await current(c);
    const owner = await db.query.commitment.findFirst({
      where: and(mine(commitment), eq(commitment.id, id)),
      columns: { cycleId: true, state: true, currency: true },
    });
    if (!now || !owner) return c.json({ error: "not_found" as const }, 404);
    if (owner.cycleId !== now.cycle.id) return c.json({ error: "locked" as const }, 409);
    if (owner.state !== "open") return c.json({ error: "not_open" as const }, 409);
    // In the commitment's own currency until item 17 (paid in the other currency).
    const row = { ...b, currency: owner.currency };
    const problems = checkPayment(row, {
      today: now.today,
      cycleStartedOn: now.cycle.startedOn,
      currency: owner.currency,
    });
    if (problems.length) return c.json({ error: "invalid" as const, problems }, 400);
    const insert = db.insert(commitmentPayment).values({ ...row, userId, commitmentId: id });
    try {
      if (finish) {
        await db.batch([
          insert,
          db
            .update(commitment)
            .set({ state: "finished" })
            .where(and(mine(commitment), eq(commitment.id, id))),
        ]);
      } else {
        await insert;
      }
    } catch {
      // The id is already in use.
      return c.json({ error: "conflict" as const }, 409);
    }
    return c.json({ ok: true as const }, 201);
  })
  .patch("/payments/:id", json(changePayment), async (c) => {
    const { db, mine } = c.var;
    const b = c.req.valid("json");
    const id = c.req.param("id");
    const now = await current(c);
    const old = await db.query.commitmentPayment.findFirst({
      where: and(mine(commitmentPayment), eq(commitmentPayment.id, id)),
    });
    const owner = old
      ? await db.query.commitment.findFirst({
          where: and(mine(commitment), eq(commitment.id, old.commitmentId)),
          columns: { cycleId: true, currency: true },
        })
      : undefined;
    if (!now || !old || !owner) return c.json({ error: "not_found" as const }, 404);
    if (owner.cycleId !== now.cycle.id) return c.json({ error: "locked" as const }, 409);
    const next = { ...old, ...b };
    const problems = checkPayment(next, {
      today: now.today,
      cycleStartedOn: now.cycle.startedOn,
      currency: owner.currency,
    });
    if (problems.length) return c.json({ error: "invalid" as const, problems }, 400);
    await db
      .update(commitmentPayment)
      .set({ amountMinor: next.amountMinor, paidOn: next.paidOn })
      .where(and(mine(commitmentPayment), eq(commitmentPayment.id, id)));
    return c.json({ ok: true as const });
  })
  .delete("/payments/:id", async (c) => {
    const { db, mine } = c.var;
    const id = c.req.param("id");
    const now = await current(c);
    const old = await db.query.commitmentPayment.findFirst({
      where: and(mine(commitmentPayment), eq(commitmentPayment.id, id)),
      columns: { commitmentId: true },
    });
    const owner = old
      ? await db.query.commitment.findFirst({
          where: and(mine(commitment), eq(commitment.id, old.commitmentId)),
          columns: { cycleId: true, currency: true },
        })
      : undefined;
    if (!now || !old || !owner) return c.json({ error: "not_found" as const }, 404);
    if (owner.cycleId !== now.cycle.id) return c.json({ error: "locked" as const }, 409);
    await db.delete(commitmentPayment).where(and(mine(commitmentPayment), eq(commitmentPayment.id, id)));
    return c.json({ ok: true as const });
  });
