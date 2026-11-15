import { and, desc, eq, gt, inArray } from "drizzle-orm";
import { Hono } from "hono";
import * as z from "zod";
import { checkIncome, checkSavingsMove, savingsTotal } from "../money";
import { current } from "./current";
import { commitment, commitmentPayment, income, prepayment, savingsMovement } from "./db/schema";
import { json } from "./json";
import type { SignedIn } from "./user-check";

/** One line of the Savings movements list; `amountMinor` below zero is money out. */
export interface SavingsLine {
  id: string;
  kind: "put_in" | "take_out" | "income" | "leftover" | "set_aside" | "prepayment" | "payback";
  cycleId: string;
  currency: string;
  amountMinor: number;
  on: string;
  /** The commitment's name for a set-aside or payback moved; the prepayment's name. */
  name: string | null;
}

/**
 * Every movement into and out of savings, all cycles, newest first (spec 5):
 * Put in and Take out, extra income sent to savings, leftover saved on salary
 * day, savings set-asides moved, prepayments (out) and their paybacks moved (in).
 * Totals are worked out from it with the money rules.
 */
export async function savingsLines(c: { var: SignedIn["Variables"] }): Promise<SavingsLine[]> {
  const { db, mine } = c.var;
  const moves = await db
    .select({
      id: savingsMovement.id,
      kind: savingsMovement.kind,
      cycleId: savingsMovement.cycleId,
      currency: savingsMovement.currency,
      amountMinor: savingsMovement.amountMinor,
      movedOn: savingsMovement.movedOn,
      name: prepayment.name,
    })
    .from(savingsMovement)
    .leftJoin(prepayment, and(eq(prepayment.id, savingsMovement.prepaymentId), mine(prepayment)))
    .where(mine(savingsMovement));
  const incomes = await db.query.income.findMany({
    where: and(mine(income), gt(income.toSavingsMinor, 0)),
    columns: { id: true, kind: true, cycleId: true, currency: true, toSavingsMinor: true, receivedOn: true },
  });
  const setAsides = await db
    .select({
      id: commitmentPayment.id,
      cycleId: commitment.cycleId,
      currency: commitmentPayment.currency,
      amountMinor: commitmentPayment.amountMinor,
      on: commitmentPayment.paidOn,
      name: commitment.name,
      kind: commitment.kind,
    })
    .from(commitmentPayment)
    .innerJoin(commitment, eq(commitment.id, commitmentPayment.commitmentId))
    .where(
      and(
        mine(commitmentPayment),
        mine(commitment),
        inArray(commitment.kind, ["savings", "savings_payback"]),
      ),
    )
    .orderBy(desc(commitmentPayment.paidOn));
  const lines: SavingsLine[] = [
    ...moves
      // Plan payoffs from savings come with item 19.
      .flatMap((m) =>
        m.kind === "put_in" || m.kind === "take_out" || m.kind === "prepayment"
          ? [
              {
                id: m.id,
                kind: m.kind,
                cycleId: m.cycleId,
                currency: m.currency,
                amountMinor: m.amountMinor,
                on: m.movedOn,
                name: m.kind === "prepayment" ? m.name : null,
              },
            ]
          : [],
      ),
    ...incomes.map((i) => ({
      id: i.id,
      // Last cycle's leftover saved on salary day (item 12), or extra income.
      kind: i.kind === "leftover" ? ("leftover" as const) : ("income" as const),
      cycleId: i.cycleId,
      currency: i.currency,
      amountMinor: i.toSavingsMinor,
      on: i.receivedOn,
      name: null,
    })),
    ...setAsides.map(({ kind, ...p }) => ({
      ...p,
      kind: kind === "savings_payback" ? ("payback" as const) : ("set_aside" as const),
    })),
  ];
  return lines.sort((a, b) => (a.on === b.on ? (a.id < b.id ? 1 : -1) : a.on < b.on ? 1 : -1));
}

const newMove = z.object({
  id: z.uuid(),
  kind: z.enum(["put_in", "take_out"]),
  /** Above zero; a take-out is stored below zero. */
  amountMinor: z.number().int(),
});

const newIncome = z.object({
  id: z.uuid(),
  kind: z.string(),
  amountMinor: z.number().int(),
  toSavingsMinor: z.number().int(),
});

/**
 * Savings and Add income (backlog item 10, spec 5): Put in, Take out (into free
 * money) and extra income split to savings and free money, dated today in the
 * current cycle. Deletes are the toasts' Undo, current cycle only.
 * The phone works out every number with the money rules.
 */
export const savings = new Hono<SignedIn>()
  .post("/savings-movements", json(newMove), async (c) => {
    const { db, userId } = c.var;
    const b = c.req.valid("json");
    const now = await current(c);
    if (!now) return c.json({ error: "not_set_up" as const }, 404);
    const currency = now.settings.spendingCurrency;
    const totalMinor = b.kind === "take_out" ? savingsTotal(await savingsLines(c), currency) : 0;
    const problems = checkSavingsMove({ ...b, currency, totalMinor }, { spendingCurrency: currency });
    if (problems.length) return c.json({ error: "invalid" as const, problems }, 400);
    try {
      await db.insert(savingsMovement).values({
        id: b.id,
        userId,
        cycleId: now.cycle.id,
        currency,
        amountMinor: b.kind === "take_out" ? -b.amountMinor : b.amountMinor,
        kind: b.kind,
        movedOn: now.today,
      });
    } catch {
      // The id is already in use.
      return c.json({ error: "conflict" as const }, 409);
    }
    return c.json({ ok: true as const }, 201);
  })
  .delete("/savings-movements/:id", async (c) => {
    const { db, mine } = c.var;
    const id = c.req.param("id");
    const now = await current(c);
    const old = await db.query.savingsMovement.findFirst({
      where: and(mine(savingsMovement), eq(savingsMovement.id, id)),
      columns: { cycleId: true, kind: true },
    });
    if (!now || !old || (old.kind !== "put_in" && old.kind !== "take_out")) {
      return c.json({ error: "not_found" as const }, 404);
    }
    if (old.cycleId !== now.cycle.id) return c.json({ error: "locked" as const }, 409);
    await db.delete(savingsMovement).where(and(mine(savingsMovement), eq(savingsMovement.id, id)));
    return c.json({ ok: true as const });
  })
  .post("/incomes", json(newIncome), async (c) => {
    const { db, userId } = c.var;
    const b = c.req.valid("json");
    const now = await current(c);
    if (!now) return c.json({ error: "not_set_up" as const }, 404);
    const row = { ...b, currency: now.settings.spendingCurrency };
    const problems = checkIncome(row, { spendingCurrency: now.settings.spendingCurrency });
    if (problems.length) return c.json({ error: "invalid" as const, problems }, 400);
    try {
      await db.insert(income).values({
        ...row,
        kind: "extra",
        userId,
        cycleId: now.cycle.id,
        receivedOn: now.today,
      });
    } catch {
      // The id is already in use.
      return c.json({ error: "conflict" as const }, 409);
    }
    return c.json({ ok: true as const }, 201);
  })
  .delete("/incomes/:id", async (c) => {
    const { db, mine } = c.var;
    const id = c.req.param("id");
    const now = await current(c);
    const old = await db.query.income.findFirst({
      where: and(mine(income), eq(income.id, id)),
      columns: { cycleId: true, kind: true },
    });
    // Salary and opening money are changed on salary day and first use, not here.
    if (!now || !old || old.kind !== "extra") return c.json({ error: "not_found" as const }, 404);
    if (old.cycleId !== now.cycle.id) return c.json({ error: "locked" as const }, 409);
    await db.delete(income).where(and(mine(income), eq(income.id, id)));
    return c.json({ ok: true as const });
  });
