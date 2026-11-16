import { and, desc, eq, inArray, ne, sql } from "drizzle-orm";
import { Hono } from "hono";
import {
  commitment,
  commitmentPayment,
  cycle,
  cycleClose,
  income,
  pot,
  potAllocation,
  spend,
} from "./db/schema";
import type { SignedIn } from "./user-check";

type Ctx = { var: SignedIn["Variables"] };

/** Every cycle, newest first; the first one is the current cycle, the rest have ended. */
async function cyclesOf(c: Ctx) {
  const { db, mine } = c.var;
  return db.query.cycle.findMany({
    where: mine(cycle),
    columns: { id: true, startedOn: true, expectedSalaryOn: true },
    orderBy: [desc(cycle.startedOn), desc(cycle.createdAt)],
  });
}

/** `cycle_close` rows, as the money rules need them (`CloseEntry`), with their cycle. */
async function closesOf(c: Ctx, cycleId?: string) {
  const { db, mine } = c.var;
  return db
    .select({
      cycleId: cycleClose.cycleId,
      currency: cycleClose.currency,
      leftoverMinor: cycleClose.leftoverMinor,
      correctionMinor: cycleClose.leftoverCorrectionMinor,
      toSavingsMinor: cycleClose.leftoverToSavingsMinor,
      overspendChoice: cycleClose.overspendChoice,
    })
    .from(cycleClose)
    .where(cycleId ? and(mine(cycleClose), eq(cycleClose.cycleId, cycleId)) : mine(cycleClose));
}

/**
 * Past (item 21, spec 10): ended cycles, read only. The phone works out every
 * number with the money rules; the list gets sums per currency, not every row.
 */
export const past = new Hono<SignedIn>()
  /** Past cycles, newest first: dates, salary (or opening money), spent, how it ended. */
  .get("/past", async (c) => {
    const { db, mine } = c.var;
    const [current, ...ended] = await cyclesOf(c);
    if (!current || !ended.length) return c.json({ cycles: [] });
    const incomes = await db
      .select({
        cycleId: income.cycleId,
        kind: income.kind,
        currency: income.currency,
        amountMinor: sql<number>`sum(${income.amountMinor})`,
      })
      .from(income)
      .where(and(mine(income), inArray(income.kind, ["salary", "opening"]), ne(income.cycleId, current.id)))
      .groupBy(income.cycleId, income.kind, income.currency);
    const spends = await db
      .select({
        cycleId: spend.cycleId,
        currency: spend.currency,
        amountMinor: sql<number>`sum(${spend.amountMinor})`,
      })
      .from(spend)
      .where(and(mine(spend), ne(spend.cycleId, current.id)))
      .groupBy(spend.cycleId, spend.currency);
    const closes = await closesOf(c);
    const of = <R extends { cycleId: string }>(rows: R[], id: string) =>
      rows.filter((r) => r.cycleId === id).map(({ cycleId: _, ...r }) => r);
    const newer = [current, ...ended];
    return c.json({
      cycles: ended.map((k, i) => ({
        id: k.id,
        startedOn: k.startedOn,
        // The cycle after it (one newer in the list) started the day it ended.
        nextStartedOn: newer[i]?.startedOn ?? k.expectedSalaryOn,
        incomes: of(incomes, k.id),
        spends: of(spends, k.id),
        closes: of(closes, k.id),
      })),
    });
  })
  /** One ended cycle with its rows (read only); the current cycle is not here. */
  .get("/past/:id", async (c) => {
    const { db, mine } = c.var;
    const id = c.req.param("id");
    const all = await cyclesOf(c);
    const at = all.findIndex((k) => k.id === id);
    const k = all[at];
    const next = all[at - 1];
    if (at < 1 || !k || !next) return c.json({ error: "not_found" as const }, 404);
    const incomes = await db.query.income.findMany({
      where: and(mine(income), eq(income.cycleId, id)),
      columns: { kind: true, currency: true, amountMinor: true, toSavingsMinor: true, receivedOn: true },
    });
    const spends = await db.query.spend.findMany({
      where: and(mine(spend), eq(spend.cycleId, id)),
      columns: {
        id: true,
        spentOn: true,
        currency: true,
        amountMinor: true,
        note: true,
        potId: true,
        cardId: true,
        oneOff: true,
      },
      orderBy: [desc(spend.spentOn), desc(spend.id)],
    });
    const commitments = await db.query.commitment.findMany({
      where: and(mine(commitment), eq(commitment.cycleId, id)),
      columns: {
        id: true,
        name: true,
        kind: true,
        currency: true,
        plannedMinor: true,
        dueOn: true,
        state: true,
      },
      orderBy: [commitment.dueOn, commitment.name],
    });
    // A subquery: D1 caps bound values at 100.
    const payments = await db.query.commitmentPayment.findMany({
      where: and(
        mine(commitmentPayment),
        inArray(
          commitmentPayment.commitmentId,
          db
            .select({ id: commitment.id })
            .from(commitment)
            .where(and(mine(commitment), eq(commitment.cycleId, id))),
        ),
      ),
      columns: { commitmentId: true, amountMinor: true, currency: true, coversMinor: true, paidOn: true },
      orderBy: [commitmentPayment.paidOn, commitmentPayment.id],
    });
    const pots = await db
      .select({
        id: pot.id,
        name: pot.name,
        currency: pot.currency,
        amountMinor: potAllocation.amountMinor,
      })
      .from(potAllocation)
      .innerJoin(pot, eq(pot.id, potAllocation.potId))
      .where(and(mine(pot), eq(potAllocation.cycleId, id)))
      .orderBy(pot.createdAt, pot.id);
    const closes = await closesOf(c, id);
    return c.json({
      cycle: {
        id: k.id,
        startedOn: k.startedOn,
        expectedSalaryOn: k.expectedSalaryOn,
        nextStartedOn: next.startedOn,
      },
      incomes,
      spends,
      // Its own pots are the ones it set aside; stopping one later doesn't change this cycle.
      pots: pots.map((p) => ({ ...p, archived: false })),
      commitments: commitments.map((m) => ({
        ...m,
        payments: payments.filter((p) => p.commitmentId === m.id).map(({ commitmentId: _, ...p }) => p),
      })),
      closes: closes.map(({ cycleId: _, ...r }) => r),
    });
  });
