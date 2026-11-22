import { and, desc, eq, gt, inArray } from "drizzle-orm";
import { Hono } from "hono";
import * as z from "zod";
import { checkGoalTakeOut, checkIncome, checkSavingsMove, placeUsable, savingsTotal } from "../money";
import {
  commitment,
  commitmentPayment,
  conversion,
  income,
  instalmentPlan,
  planExtraPayment,
  prepayment,
  savingsMovement,
  settings,
} from "./db/schema";
import { json } from "./json";
import { placeId } from "./place-use";
import { GOAL_SAVED, type GoalSavedRow, goalSavedOf } from "./savings-goals";
import { SAVINGS_SQL } from "./today-read";
import type { SignedIn } from "./user-check";
import { type Read, readForWrite } from "./write-read";

/** One line of the Savings movements list; `amountMinor` below zero is money out. */
export interface SavingsLine {
  id: string;
  kind:
    | "put_in"
    | "take_out"
    | "income"
    | "leftover"
    | "set_aside"
    | "prepayment"
    | "payback"
    | "rate_gain"
    | "plan_extra";
  cycleId: string;
  currency: string;
  amountMinor: number;
  on: string;
  /** The commitment's name for a set-aside or payback moved; the prepayment's or plan's name. */
  name: string | null;
  /** Take out "from a goal" (SAB-69): the goal it took from; left out when none. */
  goalId?: string;
}

/**
 * Every movement into and out of savings, all cycles, newest first (spec 5):
 * Put in and Take out, extra income sent to savings, leftover saved on salary
 * day, savings set-asides moved, prepayments (out) and their paybacks moved (in),
 * rate gains on conversions (item 16, in the spending currency).
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
      planName: instalmentPlan.name,
      goalId: savingsMovement.goalId,
    })
    .from(savingsMovement)
    .leftJoin(prepayment, and(eq(prepayment.id, savingsMovement.prepaymentId), mine(prepayment)))
    // Pay extra on a plan from savings (item 19): its extra payment has the same id.
    .leftJoin(planExtraPayment, and(eq(planExtraPayment.id, savingsMovement.id), mine(planExtraPayment)))
    .leftJoin(instalmentPlan, and(eq(instalmentPlan.id, planExtraPayment.planId), mine(instalmentPlan)))
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
  const gains = await db.query.conversion.findMany({
    where: and(mine(conversion), gt(conversion.gainMinor, 0)),
    columns: { id: true, cycleId: true, gainMinor: true, doneOn: true },
  });
  const spendingCurrency = gains.length
    ? (await db.query.settings.findFirst({ where: mine(settings), columns: { spendingCurrency: true } }))
        ?.spendingCurrency
    : undefined;
  return savingsLinesOf({ moves, incomes, setAsides, gains }, spendingCurrency);
}

/** The rows `savingsLines` reads (Today reads the same in its one batch, `today-read.ts`). */
export interface SavingsRows {
  moves: {
    id: string;
    kind: (typeof savingsMovement.$inferSelect)["kind"];
    cycleId: string;
    currency: string;
    amountMinor: number;
    movedOn: string;
    name: string | null;
    planName: string | null;
    goalId: string | null;
  }[];
  /** Incomes with part sent to savings. */
  incomes: {
    id: string;
    kind: (typeof income.$inferSelect)["kind"];
    cycleId: string;
    currency: string;
    toSavingsMinor: number;
    receivedOn: string;
  }[];
  /** Payments on savings and savings payback commitments, newest first. */
  setAsides: {
    id: string;
    cycleId: string;
    currency: string;
    amountMinor: number;
    on: string;
    name: string;
    kind: (typeof commitment.$inferSelect)["kind"];
  }[];
  /** Conversions with a rate gain. */
  gains: { id: string; cycleId: string; gainMinor: number; doneOn: string }[];
}

/**
 * The savings statements for `readForWrite` (SAB-72): a write that checks against
 * today's savings reads them in the same one batch as its other checks, instead of
 * `savingsLines` (Drizzle reads one after another).
 */
export const SAVINGS_READS = {
  savingsMoves: [SAVINGS_SQL.savingsMoves],
  savingsIncomes: [SAVINGS_SQL.savingsIncomes],
  savingsSetAsides: [SAVINGS_SQL.savingsSetAsides],
  savingsGains: [SAVINGS_SQL.savingsGains],
} as const satisfies Record<string, Read>;

/** The rows `SAVINGS_READS` gives. */
export type SavingsReadRows = {
  savingsMoves: SavingsRows["moves"];
  savingsIncomes: SavingsRows["incomes"];
  savingsSetAsides: SavingsRows["setAsides"];
  savingsGains: SavingsRows["gains"];
};

/** Savings lines from `SAVINGS_READS`' rows (the same lines `savingsLines` gives). */
export function savingsLinesFrom(r: SavingsReadRows, spendingCurrency: string): SavingsLine[] {
  return savingsLinesOf(
    {
      moves: r.savingsMoves,
      incomes: r.savingsIncomes,
      setAsides: r.savingsSetAsides,
      gains: r.savingsGains,
    },
    spendingCurrency,
  );
}

/** Savings lines from their rows, newest first; rate gains need the spending currency. */
export function savingsLinesOf(
  { moves, incomes, setAsides, gains }: SavingsRows,
  spendingCurrency: string | undefined,
): SavingsLine[] {
  const lines: SavingsLine[] = [
    ...moves.flatMap((m) =>
      m.kind === "put_in" || m.kind === "take_out" || m.kind === "prepayment" || m.kind === "plan_extra"
        ? [
            {
              id: m.id,
              kind: m.kind,
              cycleId: m.cycleId,
              currency: m.currency,
              amountMinor: m.amountMinor,
              on: m.movedOn,
              name: m.kind === "prepayment" ? m.name : m.kind === "plan_extra" ? m.planName : null,
              ...(m.goalId ? { goalId: m.goalId } : {}),
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
    ...(spendingCurrency
      ? gains.map((g) => ({
          id: g.id,
          kind: "rate_gain" as const,
          cycleId: g.cycleId,
          currency: spendingCurrency,
          amountMinor: g.gainMinor,
          on: g.doneOn,
          name: null,
        }))
      : []),
  ];
  return lines.sort((a, b) => (a.on === b.on ? (a.id < b.id ? 1 : -1) : a.on < b.on ? 1 : -1));
}

const newMove = z.object({
  id: z.uuid(),
  kind: z.enum(["put_in", "take_out"]),
  /** Either of the user's currencies (spec 8); none: the spending currency. */
  currency: z.string().optional(),
  /** Above zero; a take-out is stored below zero. */
  amountMinor: z.number().int(),
  /** Put in: the place the money went into (SAB-52). A take-out stays where it is: it takes none. */
  placeId,
  /** Take out "from a goal" (SAB-69): one of the user's goals in its currency; none takes from no goal. */
  goalId: z.uuid().nullish(),
});

const newIncome = z.object({
  id: z.uuid(),
  kind: z.string(),
  /** Either of the user's currencies (spec 8); none: the spending currency. */
  currency: z.string().optional(),
  amountMinor: z.number().int(),
  toSavingsMinor: z.number().int(),
  /** The place the money landed in (SAB-52), the part sent to savings too; null moves no place. */
  placeId,
});

/** The place a Put in names (SAB-52), for `readForWrite`; `?2` is its id (null: none). */
const PLACE = `select id, currency, archived from place where user_id = ?1 and id = ?2`;

interface PlaceRow {
  id: string;
  currency: string;
  archived: number;
}

/** A savings movement or an income an Undo deletes (SAB-78), for `readForWrite`; `?2` is its id. */
const MOVEMENT = `select cycle_id as cycleId, kind from savings_movement where user_id = ?1 and id = ?2`;
const INCOME = `select cycle_id as cycleId, kind from income where user_id = ?1 and id = ?2`;

interface OldRow {
  cycleId: string;
  kind: string;
}

/**
 * Savings and Add income (backlog item 10, spec 5): Put in, Take out (into free
 * money) and extra income (or loan money received as cash, item 19) split to savings and free money, dated today in the
 * current cycle. Deletes are the toasts' Undo, current cycle only. Income and Put
 * in may name the place the money landed in (SAB-52). A take-out may name the
 * savings goal it takes from (SAB-69); its Undo puts it back toward the goal.
 * The phone works out every number with the money rules.
 */
export const savings = new Hono<SignedIn>()
  .post("/savings-movements", json(newMove), async (c) => {
    const { db, userId } = c.var;
    const b = c.req.valid("json");
    const takeOut = b.kind === "take_out";
    // Taken out into free money, the money stays in its place (spec 6).
    const inPlace = b.kind === "put_in" ? (b.placeId ?? null) : null;
    const goalId = b.goalId ?? null;
    // One D1 batch for every read (SAB-73): a take-out from a goal made ~10 D1 calls.
    // Savings only for a take-out, the goal only when one is named.
    const { now, places, saved, ...r } = await readForWrite<
      Partial<SavingsReadRows> & { places: PlaceRow[]; saved?: GoalSavedRow[] }
    >(c, {
      ...(takeOut ? SAVINGS_READS : {}),
      places: [PLACE, inPlace],
      ...(goalId && takeOut ? { saved: [GOAL_SAVED, goalId] as const } : {}),
    });
    if (!now) return c.json({ error: "not_set_up" as const }, 404);
    const currency = b.currency ?? now.settings.spendingCurrency;
    const totalMinor = takeOut
      ? savingsTotal(savingsLinesFrom(r as SavingsReadRows, now.settings.spendingCurrency), currency)
      : 0;
    const problems: string[] = checkSavingsMove({ ...b, currency, totalMinor }, now.currencies);
    if (
      inPlace &&
      !placeUsable(
        inPlace,
        currency,
        places.map((p) => ({ ...p, archived: Number(p.archived) === 1 })),
      )
    ) {
      problems.push("place");
    }
    if (goalId) {
      const goal = saved && goalSavedOf(saved);
      if (!goal) problems.push("goal");
      else problems.push(...checkGoalTakeOut({ currency, amountMinor: b.amountMinor }, goal));
    }
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
        placeId: inPlace,
        goalId,
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
    // One D1 batch for the checks (SAB-78): `current()` and a Drizzle read were 3 D1 calls.
    const { now, olds } = await readForWrite<{ olds: OldRow[] }>(c, { olds: [MOVEMENT, id] });
    const old = olds[0];
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
    const { now, places } = await readForWrite<{ places: PlaceRow[] }>(c, {
      places: [PLACE, b.placeId ?? null],
    });
    if (!now) return c.json({ error: "not_set_up" as const }, 404);
    const row = { ...b, currency: b.currency ?? now.settings.spendingCurrency };
    const problems: string[] = checkIncome(row, now.currencies);
    // Borrowed money and money paid back go with their person entry (item 20, /api/people).
    if (row.kind === "borrowed" || row.kind === "paid_back") problems.push("kind");
    if (
      row.placeId &&
      !placeUsable(
        row.placeId,
        row.currency,
        places.map((p) => ({ ...p, archived: Number(p.archived) === 1 })),
      )
    ) {
      problems.push("place");
    }
    if (problems.length) return c.json({ error: "invalid" as const, problems }, 400);
    try {
      await db.insert(income).values({
        ...row,
        // Checked above: extra income or loan money received as cash (item 19).
        kind: row.kind as "extra" | "loan",
        placeId: row.placeId ?? null,
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
    const { now, olds } = await readForWrite<{ olds: OldRow[] }>(c, { olds: [INCOME, id] });
    const old = olds[0];
    // Salary and opening money are changed on salary day and first use, not here; borrowed
    // money goes with its person entry (item 20). Got it back (`paid_back`) is undone here.
    if (!now || !old || (old.kind !== "extra" && old.kind !== "loan" && old.kind !== "paid_back")) {
      return c.json({ error: "not_found" as const }, 404);
    }
    if (old.cycleId !== now.cycle.id) return c.json({ error: "locked" as const }, 409);
    await db.delete(income).where(and(mine(income), eq(income.id, id)));
    return c.json({ ok: true as const });
  });
