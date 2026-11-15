import { and, desc, eq, inArray } from "drizzle-orm";
import { Hono } from "hono";
import * as z from "zod";
import { checkFirstUse, cycleSpeeds, isTimeZone, todayIn } from "../money";
import {
  commitment,
  commitmentPayment,
  cycle,
  dayChoice,
  income,
  pot,
  potAllocation,
  recurringCommitment,
  settings,
  spend,
} from "./db/schema";
import { json } from "./json";
import { savingsLines } from "./savings";
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

/**
 * Last cycle's spending speeds, free money's and each pot's, over its whole
 * length (spec 7). Worked out here so the phone gets two numbers per speed, not
 * last cycle's rows.
 */
async function lastCycleSpeeds(
  c: { var: SignedIn["Variables"] },
  last: { id: string; startedOn: string },
  endedBefore: string,
  spendingCurrency: string,
) {
  const { db, mine } = c.var;
  const spends = await db.query.spend.findMany({
    where: and(mine(spend), eq(spend.cycleId, last.id)),
    columns: { spentOn: true, currency: true, amountMinor: true, potId: true, oneOff: true },
  });
  const allocations = await db
    .select({ id: pot.id, currency: pot.currency, amountMinor: potAllocation.amountMinor })
    .from(potAllocation)
    .innerJoin(pot, eq(pot.id, potAllocation.potId))
    .where(and(mine(pot), eq(potAllocation.cycleId, last.id)));
  return cycleSpeeds(
    { spendingCurrency, spends, pots: allocations.map((p) => ({ ...p, archived: false })) },
    last.startedOn,
    endedBefore,
  );
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
    // The current cycle and the one before it (its speed is used in the first 3 days, item 8).
    const [current, last] = await db.query.cycle.findMany({
      where: mine(cycle),
      orderBy: [desc(cycle.startedOn), desc(cycle.createdAt)],
      limit: 2,
    });
    const incomes = current
      ? await db.query.income.findMany({ where: and(mine(income), eq(income.cycleId, current.id)) })
      : [];
    const spends = current
      ? await db.query.spend.findMany({
          where: and(mine(spend), eq(spend.cycleId, current.id)),
          orderBy: [desc(spend.spentOn), desc(spend.id)],
        })
      : [];
    const commitments = current
      ? await db.query.commitment.findMany({
          where: and(mine(commitment), eq(commitment.cycleId, current.id)),
          orderBy: [commitment.dueOn, commitment.name],
        })
      : [];
    // Payments of this cycle's commitments (a subquery: D1 caps bound values at 100).
    const payments = current
      ? await db.query.commitmentPayment.findMany({
          where: and(
            mine(commitmentPayment),
            inArray(
              commitmentPayment.commitmentId,
              db
                .select({ id: commitment.id })
                .from(commitment)
                .where(and(mine(commitment), eq(commitment.cycleId, current.id))),
            ),
          ),
          orderBy: [commitmentPayment.paidOn, commitmentPayment.id],
        })
      : [];
    // Every pot (they last across cycles) with this cycle's amount, if it has one.
    const pots = await db
      .select({
        id: pot.id,
        name: pot.name,
        currency: pot.currency,
        usualAmountMinor: pot.usualAmountMinor,
        archived: pot.archived,
        amountMinor: potAllocation.amountMinor,
      })
      .from(pot)
      .leftJoin(
        potAllocation,
        and(eq(potAllocation.potId, pot.id), eq(potAllocation.cycleId, current?.id ?? "")),
      )
      .where(mine(pot))
      .orderBy(pot.createdAt, pot.id);
    const dayChoices = current
      ? await db.query.dayChoice.findMany({
          where: and(mine(dayChoice), eq(dayChoice.cycleId, current.id)),
          columns: { dayOn: true, choice: true },
          orderBy: [dayChoice.dayOn],
        })
      : [];
    // Savings movements of every cycle (spec 5); this cycle's take-outs are free money.
    const savings = current ? await savingsLines(c) : [];
    // The "Every cycle" templates, paused ones too (item 11).
    const recurring = await db.query.recurringCommitment.findMany({
      where: mine(recurringCommitment),
      columns: {
        id: true,
        name: true,
        kind: true,
        currency: true,
        usualAmountMinor: true,
        usualDay: true,
        active: true,
      },
      orderBy: [recurringCommitment.usualDay, recurringCommitment.name],
    });
    const lastCycle =
      current && last && s ? await lastCycleSpeeds(c, last, current.startedOn, s.spendingCurrency) : null;
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
      spends: spends.map((s) => ({
        id: s.id,
        spentOn: s.spentOn,
        currency: s.currency,
        amountMinor: s.amountMinor,
        note: s.note,
        potId: s.potId,
        oneOff: s.oneOff,
      })),
      pots,
      lastCycle,
      dayChoices,
      savings,
      recurring,
      commitments: commitments.map((k) => ({
        id: k.id,
        name: k.name,
        kind: k.kind,
        currency: k.currency,
        plannedMinor: k.plannedMinor,
        dueOn: k.dueOn,
        state: k.state,
        recurringId: k.recurringId,
        carriedFromId: k.carriedFromId,
        payments: payments
          .filter((p) => p.commitmentId === k.id)
          .map((p) => ({ id: p.id, amountMinor: p.amountMinor, currency: p.currency, paidOn: p.paidOn })),
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
