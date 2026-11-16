import { and, desc, eq, inArray } from "drizzle-orm";
import type { BatchItem } from "drizzle-orm/batch";
import { Hono } from "hono";
import * as z from "zod";
import { checkFirstUse, cycleSpeeds, isRate, isTimeZone, todayIn, usualDayOf } from "../money";
import { cardLines } from "./cards";
import { conversionLines } from "./conversions";
import { countingRateOf } from "./current";
import {
  commitment,
  commitmentPayment,
  countingRate,
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
import { planLines } from "./plans";
import { prepaymentLines } from "./prepayments";
import { undoRecord } from "./salary-day";
import { savingsLines } from "./savings";
import type { SignedIn } from "./user-check";

const firstUseBody = z.object({
  settingsId: z.uuid(),
  cycleId: z.uuid(),
  incomeId: z.uuid(),
  /** Two currencies (spec 2, 8): the opening income in the salary currency and the counting rate. */
  salaryIncomeId: z.uuid().optional(),
  heldSalaryMinor: z.number().int().optional(),
  countingRateId: z.uuid().optional(),
  countingRate: z.string().nullish(),
  salaryCurrency: z.string(),
  spendingCurrency: z.string(),
  homeTimeZone: z.string(),
  usualPayDay: z.number().int(),
  heldMinor: z.number().int(),
  expectedSalaryOn: z.string(),
  /** Step 4 (ticket 37): the bills still unpaid before the expected salary day. */
  commitments: z
    .array(
      z.object({
        id: z.uuid(),
        name: z.string().transform((n) => n.trim()),
        /** Either currency (spec 8); none: the spending currency. */
        currency: z.string().optional(),
        plannedMinor: z.number().int(),
        dueOn: z.string(),
        /** With "Every cycle" on: the id of the template made from it. */
        recurringId: z.uuid().nullish(),
      }),
    )
    .max(100)
    .default([]),
  /** Step 4: new pots, each with this cycle's amount (also its usual amount). */
  pots: z
    .array(
      z.object({
        id: z.uuid(),
        allocationId: z.uuid(),
        name: z.string().transform((n) => n.trim()),
        /** Either currency (spec 8); none: the spending currency. */
        currency: z.string().optional(),
        amountMinor: z.number().int(),
      }),
    )
    .max(50)
    .default([]),
});

const countingRateBody = z.object({ id: z.uuid(), rate: z.string() });

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
    // Prepayments from savings with their payback so far (item 14).
    const prepayments = current ? await prepaymentLines(c) : [];
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
        cardId: true,
      },
      orderBy: [recurringCommitment.usualDay, recurringCommitment.name],
    });
    // Undo salary day is offered while nothing new is entered (item 13).
    const undoSalaryDay = current ? (await undoRecord(c, current)) !== null : false;
    const lastCycle =
      current && last && s ? await lastCycleSpeeds(c, last, current.startedOn, s.spendingCurrency) : null;
    // This cycle's conversions (item 16): free money and Change dollars' list.
    const conversions = current ? await conversionLines(c, current.id) : [];
    // Cards with what they owed before this cycle (item 18); the phone adds this cycle's rows.
    const cards = current ? await cardLines(c, current.id) : [];
    // Instalment plans with what is paid so far and their extra payments (item 19).
    const plans = current ? await planLines(c) : [];
    return c.json({
      settings: s
        ? {
            salaryCurrency: s.salaryCurrency,
            spendingCurrency: s.spendingCurrency,
            homeTimeZone: s.homeTimeZone,
            usualPayDay: s.usualPayDay,
            // Two currencies (spec 8): the newest counting rate; null with one currency.
            countingRate: s.salaryCurrency !== s.spendingCurrency ? await countingRateOf(c) : null,
          }
        : null,
      cycle: current
        ? {
            id: current.id,
            startedOn: current.startedOn,
            expectedSalaryOn: current.expectedSalaryOn,
            reserveRate: current.reserveRate,
          }
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
        cardId: s.cardId,
        oneOff: s.oneOff,
      })),
      pots,
      cards,
      plans,
      conversions,
      lastCycle,
      undoSalaryDay,
      dayChoices,
      savings,
      prepayments,
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
        prepaymentId: k.prepaymentId,
        cardId: k.cardId,
        planId: k.planId,
        payments: payments
          .filter((p) => p.commitmentId === k.id)
          .map((p) => ({
            id: p.id,
            amountMinor: p.amountMinor,
            currency: p.currency,
            coversMinor: p.coversMinor,
            paidOn: p.paidOn,
          })),
      })),
    });
  })
  /**
   * First use: settings row, the first cycle, its opening income, bills (with
   * their Every cycle templates), pots and their amounts, in one write.
   */
  .post("/first-use", json(firstUseBody), async (c) => {
    const { db, mine, userId } = c.var;
    const b = c.req.valid("json");
    const today = isTimeZone(b.homeTimeZone) ? todayIn(b.homeTimeZone, Date.now()) : "";
    const problems = checkFirstUse(b, today);
    if (new Set(b.pots.map((p) => p.id)).size !== b.pots.length) problems.push("pot.twice");
    const two = b.salaryCurrency !== b.spendingCurrency;
    if (two && (!b.salaryIncomeId || !b.countingRateId)) problems.push("new_id");
    if (problems.length) return c.json({ error: "invalid" as const, problems }, 400);
    if (await db.query.settings.findFirst({ where: mine(settings), columns: { id: true } })) {
      return c.json({ error: "already_set_up" as const }, 409);
    }
    const cur = b.spendingCurrency;
    const writes: BatchItem<"sqlite">[] = [
      db.insert(settings).values({
        id: b.settingsId,
        userId,
        salaryCurrency: b.salaryCurrency,
        spendingCurrency: cur,
        homeTimeZone: b.homeTimeZone,
        usualPayDay: b.usualPayDay,
      }),
      db.insert(cycle).values({
        id: b.cycleId,
        userId,
        startedOn: today,
        expectedSalaryOn: b.expectedSalaryOn,
        // Two currencies (spec 8): rupee set-asides past the rupees are reserved at the first counting rate.
        reserveRate: two && b.countingRate ? b.countingRate : null,
      }),
      db.insert(income).values({
        id: b.incomeId,
        userId,
        cycleId: b.cycleId,
        kind: "opening",
        currency: cur,
        amountMinor: b.heldMinor,
        receivedOn: today,
      }),
    ];
    // Two currencies: money held in the salary currency, and the counting rate (spec 8).
    if (two && b.salaryIncomeId && b.countingRateId && b.countingRate) {
      writes.push(
        db.insert(income).values({
          id: b.salaryIncomeId,
          userId,
          cycleId: b.cycleId,
          kind: "opening",
          currency: b.salaryCurrency,
          amountMinor: b.heldSalaryMinor ?? 0,
          receivedOn: today,
        }),
        db
          .insert(countingRate)
          .values({ id: b.countingRateId, userId, rate: b.countingRate, setAt: new Date() }),
      );
    }
    for (const k of b.commitments) {
      const recurringId = k.recurringId ?? null;
      if (recurringId) {
        writes.push(
          db.insert(recurringCommitment).values({
            id: recurringId,
            userId,
            name: k.name,
            kind: "bill",
            currency: k.currency ?? cur,
            usualAmountMinor: k.plannedMinor,
            usualDay: usualDayOf(k.dueOn),
          }),
        );
      }
      writes.push(
        db.insert(commitment).values({
          id: k.id,
          userId,
          cycleId: b.cycleId,
          recurringId,
          name: k.name,
          kind: "bill",
          currency: k.currency ?? cur,
          plannedMinor: k.plannedMinor,
          dueOn: k.dueOn,
        }),
      );
    }
    for (const p of b.pots) {
      writes.push(
        db.insert(pot).values({
          id: p.id,
          userId,
          name: p.name,
          currency: p.currency ?? cur,
          usualAmountMinor: p.amountMinor,
        }),
        db.insert(potAllocation).values({
          id: p.allocationId,
          userId,
          potId: p.id,
          cycleId: b.cycleId,
          amountMinor: p.amountMinor,
        }),
      );
    }
    try {
      await db.batch(writes as [BatchItem<"sqlite">, ...BatchItem<"sqlite">[]]);
    } catch {
      // An id already in use (or a second phone finishing first use at the same time).
      return c.json({ error: "conflict" as const }, 409);
    }
    return c.json({ ok: true as const, startedOn: today }, 201);
  })
  /** Counting rate set by hand (spec 8, item 15): any time, for a two-currency user. */
  .post("/counting-rates", json(countingRateBody), async (c) => {
    const { db, mine, userId } = c.var;
    const b = c.req.valid("json");
    const s = await db.query.settings.findFirst({ where: mine(settings) });
    if (!s) return c.json({ error: "not_set_up" as const }, 404);
    if (s.salaryCurrency === s.spendingCurrency) return c.json({ error: "one_currency" as const }, 409);
    if (!isRate(b.rate)) return c.json({ error: "invalid" as const, problems: ["rate"] }, 400);
    try {
      await db.insert(countingRate).values({ id: b.id, userId, rate: b.rate, setAt: new Date() });
    } catch {
      // The id is already in use.
      return c.json({ error: "conflict" as const }, 409);
    }
    return c.json({ ok: true as const }, 201);
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
