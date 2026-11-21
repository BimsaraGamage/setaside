import { and, eq, inArray, sql } from "drizzle-orm";
import { Hono } from "hono";
import * as z from "zod";
import {
  checkPlan,
  checkPlanExtra,
  type PlanEntry,
  planDueOn,
  planPaymentDueMinor,
  planProgress,
  savingsTotal,
  stillToPayMinor,
} from "../money";
import { current } from "./current";
import {
  card,
  commitment,
  commitmentPayment,
  instalmentPlan,
  planExtraPayment,
  savingsMovement,
} from "./db/schema";
import { json } from "./json";
import { placeId, placesUsable } from "./place-use";
import { savingsLines } from "./savings";
import type { SignedIn } from "./user-check";

/** One Pay extra or Pay it all off (item 19). */
export interface PlanExtraLine {
  id: string;
  cycleId: string;
  amountMinor: number;
  paidFrom: "free" | "savings";
  paysOff: boolean;
  paidOn: string;
}

/** One plan with what is paid so far, for Money, its page and salary day (spec 9). */
export interface PlanLine extends PlanEntry {
  cardId: string | null;
  /** Its extra payments, oldest first. */
  extras: PlanExtraLine[];
}

/**
 * Every plan of the user, oldest first (spec 9), with what payments on its plan
 * payments cover (all cycles; another currency counts what it covers), how many
 * of those were finished with money paid ("N of M"), and its extra payments.
 */
export async function planLines(c: { var: SignedIn["Variables"] }): Promise<PlanLine[]> {
  const { db, mine } = c.var;
  const plans = await db.query.instalmentPlan.findMany({
    where: mine(instalmentPlan),
    orderBy: [instalmentPlan.createdAt, instalmentPlan.id],
  });
  if (plans.length === 0) return [];
  const paid = await db
    .select({
      planId: commitment.planId,
      state: commitment.state,
      covered: sql<number>`sum(case when ${commitmentPayment.currency} = ${commitment.currency} then ${commitmentPayment.amountMinor} else coalesce(${commitmentPayment.coversMinor}, 0) end)`,
    })
    .from(commitmentPayment)
    .innerJoin(commitment, eq(commitment.id, commitmentPayment.commitmentId))
    .where(and(mine(commitmentPayment), mine(commitment), eq(commitment.kind, "plan_payment")))
    .groupBy(commitment.id);
  const extras = await db.query.planExtraPayment.findMany({
    where: mine(planExtraPayment),
    orderBy: [planExtraPayment.paidOn, planExtraPayment.createdAt],
  });
  return planLinesOf({ plans, paid, extras });
}

/** The rows `planLines` reads (Today reads the same in its one batch, `today-read.ts`). */
export interface PlanRows {
  plans: Omit<typeof instalmentPlan.$inferSelect, "userId" | "createdAt" | "updatedAt">[];
  /** What each plan payment's payments cover, one row per commitment. */
  paid: { planId: string | null; state: (typeof commitment.$inferSelect)["state"]; covered: number }[];
  /** Extra payments, oldest first. */
  extras: (PlanExtraLine & { planId: string })[];
}

/** Plan lines from their rows. */
export function planLinesOf({ plans, paid, extras }: PlanRows): PlanLine[] {
  return plans.map((p) => {
    const own = paid.filter((r) => r.planId === p.id);
    const ownExtras = extras.filter((x) => x.planId === p.id);
    return {
      id: p.id,
      name: p.name,
      currency: p.currency,
      priceMinor: p.priceMinor,
      paymentCount: p.paymentCount,
      paymentMinor: p.paymentMinor,
      firstPaymentOn: p.firstPaymentOn,
      cardId: p.cardId,
      normalMonthlyMinor: p.normalMonthlyMinor,
      paidOffOn: p.paidOffOn,
      paidMinor: own.reduce((t, r) => t + Number(r.covered), 0),
      paymentsMade: own.filter((r) => r.state === "finished" && Number(r.covered) > 0).length,
      extraMinor: ownExtras.reduce((t, x) => t + x.amountMinor, 0),
      extras: ownExtras.map((x) => ({
        id: x.id,
        cycleId: x.cycleId,
        amountMinor: x.amountMinor,
        paidFrom: x.paidFrom,
        paysOff: x.paysOff,
        paidOn: x.paidOn,
      })),
    };
  });
}

const newPlan = z.object({
  id: z.uuid(),
  /** This cycle's payment, made when the first payment falls in this cycle. */
  commitmentId: z.uuid(),
  name: z.string().transform((n) => n.trim()),
  /** Either of the user's currencies (spec 8); none: the spending currency. */
  currency: z.string().optional(),
  priceMinor: z.number().int(),
  paymentCount: z.number().int(),
  paymentMinor: z.number().int(),
  firstPaymentOn: z.string(),
  cardId: z.uuid().nullish(),
  normalMonthlyMinor: z.number().int().nullish(),
});

const newExtra = z.object({
  id: z.uuid(),
  amountMinor: z.number().int(),
  from: z.enum(["free", "savings"]),
  /** Pay it all off: the plan ends, this cycle's open payment is finished. */
  paysOff: z.boolean().default(false),
  /** The place the money came out of (SAB-52), from free money or savings alike; null moves no place. */
  placeId,
});

/**
 * Instalment plans (backlog item 19, spec 9): New loan or instalments makes the
 * plan and, when its first payment falls in this cycle, this cycle's payment
 * commitment; salary day sets aside the next ones. Pay extra and Pay it all off
 * take money from free money or savings; their Undo deletes them. A plan is
 * deleted (the toast's Undo, or Delete) only while nothing is paid on it.
 */
export const plans = new Hono<SignedIn>()
  .post("/plans", json(newPlan), async (c) => {
    const { db, mine, userId } = c.var;
    const b = c.req.valid("json");
    const now = await current(c);
    if (!now) return c.json({ error: "not_set_up" as const }, 404);
    const currency = b.currency ?? now.settings.spendingCurrency;
    const cards = await db.query.card.findMany({
      where: mine(card),
      columns: { id: true, currency: true, archived: true },
    });
    const problems = checkPlan(
      { ...b, currency },
      { ...now.currencies, cycleStartedOn: now.cycle.startedOn, cards },
    );
    if (problems.length) return c.json({ error: "invalid" as const, problems }, 400);
    const entry = {
      ...b,
      currency,
      cardId: b.cardId ?? null,
      normalMonthlyMinor: b.normalMonthlyMinor ?? null,
      paidOffOn: null,
      paidMinor: 0,
      extraMinor: 0,
      paymentsMade: 0,
    };
    const dueOn = planDueOn(entry, now.cycle.startedOn);
    try {
      await db.batch([
        db.insert(instalmentPlan).values({
          id: b.id,
          userId,
          name: b.name,
          currency,
          priceMinor: b.priceMinor,
          paymentCount: b.paymentCount,
          paymentMinor: b.paymentMinor,
          firstPaymentOn: b.firstPaymentOn,
          cardId: entry.cardId,
          normalMonthlyMinor: entry.normalMonthlyMinor,
        }),
        // The first payment is set aside now when it falls by the expected salary day.
        ...(dueOn <= now.cycle.expectedSalaryOn
          ? [
              db.insert(commitment).values({
                id: b.commitmentId,
                userId,
                cycleId: now.cycle.id,
                name: b.name,
                kind: "plan_payment",
                currency,
                plannedMinor: planPaymentDueMinor(entry),
                dueOn,
                planId: b.id,
              }),
            ]
          : []),
      ]);
    } catch {
      // An id is already in use.
      return c.json({ error: "conflict" as const }, 409);
    }
    return c.json({ ok: true as const }, 201);
  })
  .delete("/plans/:id", async (c) => {
    const { db, mine } = c.var;
    const id = c.req.param("id");
    const now = await current(c);
    const plan = (await planLines(c)).find((p) => p.id === id);
    if (!now || !plan) return c.json({ error: "not_found" as const }, 404);
    if (plan.paidMinor > 0 || plan.extras.length > 0) return c.json({ error: "paid" as const }, 409);
    const rows = await db.query.commitment.findMany({
      where: and(mine(commitment), eq(commitment.planId, id)),
      columns: { cycleId: true },
    });
    // Ended cycles are locked: a plan with a payment there stays.
    if (rows.some((k) => k.cycleId !== now.cycle.id)) return c.json({ error: "locked" as const }, 409);
    await db.batch([
      db.delete(commitment).where(and(mine(commitment), eq(commitment.planId, id))),
      db.delete(instalmentPlan).where(and(mine(instalmentPlan), eq(instalmentPlan.id, id))),
    ]);
    return c.json({ ok: true as const });
  })
  .post("/plans/:id/extra", json(newExtra), async (c) => {
    const { db, mine, userId } = c.var;
    const b = c.req.valid("json");
    const id = c.req.param("id");
    const now = await current(c);
    const plan = (await planLines(c)).find((p) => p.id === id);
    if (!now || !plan) return c.json({ error: "not_found" as const }, 404);
    if (plan.paidOffOn) return c.json({ error: "paid_off" as const }, 409);
    const open = await db.query.commitment.findMany({
      where: and(
        mine(commitment),
        eq(commitment.planId, id),
        eq(commitment.cycleId, now.cycle.id),
        eq(commitment.state, "open"),
      ),
    });
    const payments = open.length
      ? await db.query.commitmentPayment.findMany({
          where: and(
            mine(commitmentPayment),
            inArray(
              commitmentPayment.commitmentId,
              open.map((k) => k.id),
            ),
          ),
        })
      : [];
    const setAsideMinor = open.reduce(
      (t, k) => t + stillToPayMinor({ ...k, payments: payments.filter((p) => p.commitmentId === k.id) }),
      0,
    );
    const savingsMinor = b.from === "savings" ? savingsTotal(await savingsLines(c), plan.currency) : 0;
    const problems: string[] = checkPlanExtra(b, {
      stillToPayMinor: planProgress(plan).stillToPayMinor,
      setAsideMinor,
      savingsMinor,
    });
    if (!(await placesUsable(c, [{ placeId: b.placeId, currency: plan.currency }]))) problems.push("place");
    if (problems.length) return c.json({ error: "invalid" as const, problems }, 400);
    // One time for every row it writes: Undo of Pay it all off reopens what it finished.
    const at = new Date();
    try {
      await db.batch([
        db.insert(planExtraPayment).values({
          id: b.id,
          userId,
          cycleId: now.cycle.id,
          planId: id,
          currency: plan.currency,
          amountMinor: b.amountMinor,
          paidFrom: b.from,
          paysOff: b.paysOff,
          paidOn: now.today,
          placeId: b.placeId ?? null,
          createdAt: at,
          updatedAt: at,
        }),
        ...(b.from === "savings"
          ? [
              db.insert(savingsMovement).values({
                id: b.id,
                userId,
                cycleId: now.cycle.id,
                currency: plan.currency,
                amountMinor: -b.amountMinor,
                kind: "plan_extra",
                movedOn: now.today,
                createdAt: at,
                updatedAt: at,
              }),
            ]
          : []),
        ...(b.paysOff
          ? [
              db
                .update(instalmentPlan)
                .set({ paidOffOn: now.today, updatedAt: at })
                .where(and(mine(instalmentPlan), eq(instalmentPlan.id, id))),
              db
                .update(commitment)
                .set({ state: "finished", updatedAt: at })
                .where(
                  and(
                    mine(commitment),
                    eq(commitment.planId, id),
                    eq(commitment.cycleId, now.cycle.id),
                    eq(commitment.state, "open"),
                  ),
                ),
            ]
          : []),
      ]);
    } catch {
      return c.json({ error: "conflict" as const }, 409);
    }
    return c.json({ ok: true as const }, 201);
  })
  .delete("/plans/extra/:id", async (c) => {
    const { db, mine } = c.var;
    const id = c.req.param("id");
    const now = await current(c);
    const x = await db.query.planExtraPayment.findFirst({
      where: and(mine(planExtraPayment), eq(planExtraPayment.id, id)),
    });
    if (!now || !x) return c.json({ error: "not_found" as const }, 404);
    if (x.cycleId !== now.cycle.id) return c.json({ error: "locked" as const }, 409);
    await db.batch([
      db.delete(planExtraPayment).where(and(mine(planExtraPayment), eq(planExtraPayment.id, id))),
      db
        .delete(savingsMovement)
        .where(
          and(mine(savingsMovement), eq(savingsMovement.id, id), eq(savingsMovement.kind, "plan_extra")),
        ),
      ...(x.paysOff
        ? [
            db
              .update(instalmentPlan)
              .set({ paidOffOn: null })
              .where(and(mine(instalmentPlan), eq(instalmentPlan.id, x.planId))),
            // The payments Pay it all off finished, untouched since.
            db
              .update(commitment)
              .set({ state: "open" })
              .where(
                and(
                  mine(commitment),
                  eq(commitment.planId, x.planId),
                  eq(commitment.cycleId, now.cycle.id),
                  eq(commitment.state, "finished"),
                  eq(commitment.updatedAt, x.createdAt),
                ),
              ),
          ]
        : []),
    ]);
    return c.json({ ok: true as const });
  });
