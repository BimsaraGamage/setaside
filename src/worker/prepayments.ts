import { and, eq, sql } from "drizzle-orm";
import { Hono } from "hono";
import * as z from "zod";
import { checkPrepayment, savingsTotal } from "../money";
import { current } from "./current";
import { commitment, commitmentPayment, prepayment, savingsMovement } from "./db/schema";
import { json } from "./json";
import { placeId, placesUsable } from "./place-use";
import { savingsLines } from "./savings";
import type { SignedIn } from "./user-check";

/** One prepayment with what has been moved back so far, for Savings and salary day. */
export interface PrepaymentLine {
  id: string;
  name: string;
  currency: string;
  totalMinor: number;
  paybackMinor: number;
  /** The normal monthly price and months covered, for the prepayment saving; null when not given. */
  normalMonthlyMinor: number | null;
  months: number | null;
  /** Payments on its payback commitments, all cycles. */
  paidBackMinor: number;
  /** The day its money came out of savings. */
  startedOn: string;
}

/** Every prepayment of the user, oldest first, with its payback so far (spec 5). */
export async function prepaymentLines(c: { var: SignedIn["Variables"] }): Promise<PrepaymentLine[]> {
  const { db, mine } = c.var;
  const rows = await db
    .select({
      id: prepayment.id,
      name: prepayment.name,
      currency: prepayment.currency,
      totalMinor: prepayment.totalMinor,
      paybackMinor: prepayment.paybackMinor,
      normalMonthlyMinor: prepayment.normalMonthlyMinor,
      months: prepayment.months,
      startedOn: savingsMovement.movedOn,
    })
    .from(prepayment)
    .innerJoin(savingsMovement, eq(savingsMovement.prepaymentId, prepayment.id))
    .where(and(mine(prepayment), mine(savingsMovement)))
    .orderBy(savingsMovement.movedOn, prepayment.id);
  const paid = await db
    .select({ id: commitment.prepaymentId, paidMinor: sql<number>`sum(${commitmentPayment.amountMinor})` })
    .from(commitmentPayment)
    .innerJoin(commitment, eq(commitment.id, commitmentPayment.commitmentId))
    .where(and(mine(commitmentPayment), mine(commitment), eq(commitment.kind, "savings_payback")))
    .groupBy(commitment.prepaymentId);
  return prepaymentLinesOf(rows, paid);
}

/** The rows `prepaymentLines` reads (Today reads the same in its one batch, `today-read.ts`). */
export type PrepaymentRow = Omit<PrepaymentLine, "paidBackMinor">;

/** Prepayment lines from their rows and the payback paid per prepayment. */
export function prepaymentLinesOf(
  rows: PrepaymentRow[],
  paid: { id: string | null; paidMinor: number }[],
): PrepaymentLine[] {
  const byId = new Map(paid.map((p) => [p.id, Number(p.paidMinor)]));
  return rows.map((r) => ({ ...r, paidBackMinor: byId.get(r.id) ?? 0 }));
}

const newPrepayment = z.object({
  id: z.uuid(),
  /** The money out of savings. */
  movementId: z.uuid(),
  /** This cycle's payback. */
  commitmentId: z.uuid(),
  name: z.string().transform((n) => n.trim()),
  /** Either of the user's currencies (spec 8); none: the spending currency. */
  currency: z.string().optional(),
  totalMinor: z.number().int(),
  paybackMinor: z.number().int(),
  /** For the prepayment saving: the normal monthly price and the months covered (both or neither). */
  normalMonthlyMinor: z.number().int().nullish(),
  months: z.number().int().nullish(),
  /** The place the money was paid out of (SAB-52); null moves no place. */
  placeId,
});

/**
 * Prepayment from savings (backlog item 14, spec 5): Take out of savings "for a
 * prepayment" takes the money out of savings (not into free money: it paid for
 * the prepayment) and sets this cycle's payback aside at once, due today, so
 * free money feels the same as paying monthly. Salary day sets aside the next
 * ones. Delete is the toast's Undo, while nothing is paid back.
 */
export const prepayments = new Hono<SignedIn>()
  .post("/prepayments", json(newPrepayment), async (c) => {
    const { db, userId } = c.var;
    const b = c.req.valid("json");
    const now = await current(c);
    if (!now) return c.json({ error: "not_set_up" as const }, 404);
    const currency = b.currency ?? now.settings.spendingCurrency;
    const savingsMinor = savingsTotal(await savingsLines(c), currency);
    const problems: string[] = checkPrepayment({ ...b, currency }, { ...now.currencies, savingsMinor });
    if (!(await placesUsable(c, [{ placeId: b.placeId, currency }]))) problems.push("place");
    if (problems.length) return c.json({ error: "invalid" as const, problems }, 400);
    try {
      await db.batch([
        db.insert(prepayment).values({
          id: b.id,
          userId,
          name: b.name,
          currency,
          totalMinor: b.totalMinor,
          paybackMinor: b.paybackMinor,
          normalMonthlyMinor: b.normalMonthlyMinor ?? null,
          months: b.months ?? null,
        }),
        db.insert(savingsMovement).values({
          id: b.movementId,
          userId,
          cycleId: now.cycle.id,
          currency,
          amountMinor: -b.totalMinor,
          kind: "prepayment",
          movedOn: now.today,
          prepaymentId: b.id,
          // The money left its place: it paid for the prepayment (spec 6).
          placeId: b.placeId ?? null,
        }),
        db.insert(commitment).values({
          id: b.commitmentId,
          userId,
          cycleId: now.cycle.id,
          name: b.name,
          kind: "savings_payback",
          currency,
          plannedMinor: b.paybackMinor,
          dueOn: now.today,
          prepaymentId: b.id,
        }),
      ]);
    } catch {
      // An id is already in use.
      return c.json({ error: "conflict" as const }, 409);
    }
    return c.json({ ok: true as const }, 201);
  })
  .delete("/prepayments/:id", async (c) => {
    const { db, mine } = c.var;
    const id = c.req.param("id");
    const now = await current(c);
    const move = await db.query.savingsMovement.findFirst({
      where: and(mine(savingsMovement), eq(savingsMovement.prepaymentId, id)),
      columns: { cycleId: true },
    });
    const found = await db.query.prepayment.findFirst({
      where: and(mine(prepayment), eq(prepayment.id, id)),
      columns: { id: true },
    });
    if (!now || !move || !found) return c.json({ error: "not_found" as const }, 404);
    if (move.cycleId !== now.cycle.id) return c.json({ error: "locked" as const }, 409);
    const paidBack = (await prepaymentLines(c)).find((p) => p.id === id)?.paidBackMinor ?? 0;
    if (paidBack > 0) return c.json({ error: "paid_back" as const }, 409);
    await db.batch([
      db.delete(commitment).where(and(mine(commitment), eq(commitment.prepaymentId, id))),
      db.delete(savingsMovement).where(and(mine(savingsMovement), eq(savingsMovement.prepaymentId, id))),
      db.delete(prepayment).where(and(mine(prepayment), eq(prepayment.id, id))),
    ]);
    return c.json({ ok: true as const });
  });
