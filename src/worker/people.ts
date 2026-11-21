import { and, eq, inArray, isNotNull, sql } from "drizzle-orm";
import { Hono } from "hono";
import * as z from "zod";
import {
  checkGotBack,
  checkPayback,
  checkPersonDebt,
  type PersonDebtEntry,
  paybackName,
  stillToPayMinor,
} from "../money";
import { current } from "./current";
import { commitment, commitmentPayment, income, personDebt } from "./db/schema";
import { json } from "./json";
import { placeId, placesUsable } from "./place-use";
import type { SignedIn } from "./user-check";

/** One Got it back on money lent (item 20): a `paid_back` income. */
export interface GotBackLine {
  id: string;
  cycleId: string;
  amountMinor: number;
  toSavingsMinor: number;
  on: string;
}

/** One person entry for People, its page, Add income and the free money of its cycle (spec 9). */
export interface PersonDebtLine extends PersonDebtEntry {
  cycleId: string;
  /** Lent: each Got it back, oldest first. Borrowed: none (its paybacks are commitments). */
  gotBack: GotBackLine[];
  /** Borrowed: the money it came in as (its `borrowed` income); null for lent. */
  incomeId: string | null;
}

/**
 * Every person entry of the user, oldest first (spec 9), with what is back so
 * far, all cycles: lent, the `paid_back` incomes; borrowed, what payments on
 * its paybacks cover (another currency counts what it covers).
 */
export async function personDebtLines(c: { var: SignedIn["Variables"] }): Promise<PersonDebtLine[]> {
  const { db, mine } = c.var;
  const debts = await db.query.personDebt.findMany({
    where: mine(personDebt),
    orderBy: [personDebt.madeOn, personDebt.createdAt, personDebt.id],
  });
  if (debts.length === 0) return [];
  const incomes = await db.query.income.findMany({
    where: and(mine(income), isNotNull(income.personDebtId)),
    columns: {
      id: true,
      kind: true,
      cycleId: true,
      amountMinor: true,
      toSavingsMinor: true,
      receivedOn: true,
      personDebtId: true,
    },
    orderBy: [income.receivedOn, income.createdAt],
  });
  const paid = await db
    .select({
      personDebtId: commitment.personDebtId,
      covered: sql<number>`sum(case when ${commitmentPayment.currency} = ${commitment.currency} then ${commitmentPayment.amountMinor} else coalesce(${commitmentPayment.coversMinor}, 0) end)`,
    })
    .from(commitmentPayment)
    .innerJoin(commitment, eq(commitment.id, commitmentPayment.commitmentId))
    .where(and(mine(commitmentPayment), mine(commitment), eq(commitment.kind, "person_payback")))
    .groupBy(commitment.personDebtId);
  return personDebtLinesOf({ debts, incomes, paid });
}

/** The rows `personDebtLines` reads (Today reads the same in its one batch, `today-read.ts`). */
export interface PersonDebtRows {
  debts: Omit<typeof personDebt.$inferSelect, "userId" | "createdAt" | "updatedAt">[];
  /** Incomes linked to a person entry, oldest first. */
  incomes: {
    id: string;
    kind: (typeof income.$inferSelect)["kind"];
    cycleId: string;
    amountMinor: number;
    toSavingsMinor: number;
    receivedOn: string;
    personDebtId: string | null;
  }[];
  /** What payments on each borrowed entry's paybacks cover. */
  paid: { personDebtId: string | null; covered: number }[];
}

/** Person entry lines from their rows. */
export function personDebtLinesOf({ debts, incomes, paid }: PersonDebtRows): PersonDebtLine[] {
  return debts.map((d) => {
    const own = incomes.filter((i) => i.personDebtId === d.id);
    const gotBack = own
      .filter((i) => i.kind === "paid_back")
      .map((i) => ({
        id: i.id,
        cycleId: i.cycleId,
        amountMinor: i.amountMinor,
        toSavingsMinor: i.toSavingsMinor,
        on: i.receivedOn,
      }));
    const backMinor =
      d.direction === "lent"
        ? gotBack.reduce((t, g) => t + g.amountMinor, 0)
        : Number(paid.find((r) => r.personDebtId === d.id)?.covered ?? 0);
    return {
      id: d.id,
      cycleId: d.cycleId,
      personName: d.personName,
      direction: d.direction,
      currency: d.currency,
      amountMinor: d.amountMinor,
      madeOn: d.madeOn,
      settledOn: d.settledOn,
      backMinor,
      gotBack,
      incomeId: own.find((i) => i.kind === "borrowed")?.id ?? null,
    };
  });
}

const name = z.string().transform((n) => n.trim());

const newDebt = z.object({
  id: z.uuid(),
  direction: z.enum(["lent", "borrowed"]),
  personName: name,
  /** Either of the user's currencies (spec 8); none: the spending currency. */
  currency: z.string().optional(),
  amountMinor: z.number().int(),
  /** Borrowed: the income it comes in as, and the part of it sent to savings. */
  incomeId: z.uuid().optional(),
  toSavingsMinor: z.number().int().default(0),
  /** Borrowed: the payback commitment, when a date is given. */
  payback: z.object({ id: z.uuid(), plannedMinor: z.number().int(), dueOn: z.string() }).nullish(),
  /** Lent: the place the money came out of. Borrowed: the place it landed in (SAB-52). Null moves no place. */
  placeId,
});

const newBack = z.object({
  id: z.uuid(),
  amountMinor: z.number().int(),
  toSavingsMinor: z.number().int(),
  /** The place the money landed in (SAB-52); null moves no place. */
  placeId,
});

const newPayback = z.object({ id: z.uuid(), plannedMinor: z.number().int(), dueOn: z.string() });

const settle = z.object({ settled: z.boolean() });

/**
 * People (backlog item 20, spec 9): I lent money (out of free money now) and I
 * borrowed (in like extra income, with a payback commitment); Got it back on
 * money lent (split like extra income); paybacks added on money borrowed;
 * Settled closes an entry. Undo of each is a delete or the opposite change.
 */
export const people = new Hono<SignedIn>()
  .post("/people", json(newDebt), async (c) => {
    const { db, userId } = c.var;
    const b = c.req.valid("json");
    const now = await current(c);
    if (!now) return c.json({ error: "not_set_up" as const }, 404);
    const currency = b.currency ?? now.settings.spendingCurrency;
    const problems: string[] = checkPersonDebt(
      { ...b, currency },
      { ...now.currencies, cycleStartedOn: now.cycle.startedOn },
    );
    if (b.direction === "borrowed" && !b.incomeId) problems.push("new_id");
    if (!(await placesUsable(c, [{ placeId: b.placeId, currency }]))) problems.push("place");
    if (problems.length) return c.json({ error: "invalid" as const, problems }, 400);
    try {
      await db.batch([
        db.insert(personDebt).values({
          id: b.id,
          userId,
          cycleId: now.cycle.id,
          personName: b.personName,
          direction: b.direction,
          currency,
          amountMinor: b.amountMinor,
          madeOn: now.today,
          // Money lent leaves its place here; money borrowed lands with its income.
          placeId: b.direction === "lent" ? (b.placeId ?? null) : null,
        }),
        ...(b.direction === "borrowed" && b.incomeId
          ? [
              db.insert(income).values({
                id: b.incomeId,
                userId,
                cycleId: now.cycle.id,
                kind: "borrowed",
                currency,
                amountMinor: b.amountMinor,
                toSavingsMinor: b.toSavingsMinor,
                receivedOn: now.today,
                personDebtId: b.id,
                placeId: b.placeId ?? null,
              }),
            ]
          : []),
        ...(b.direction === "borrowed" && b.payback
          ? [
              db.insert(commitment).values({
                id: b.payback.id,
                userId,
                cycleId: now.cycle.id,
                name: paybackName(b.personName),
                kind: "person_payback",
                currency,
                plannedMinor: b.payback.plannedMinor,
                dueOn: b.payback.dueOn,
                personDebtId: b.id,
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
  .delete("/people/:id", async (c) => {
    const { db, mine } = c.var;
    const id = c.req.param("id");
    const now = await current(c);
    const d = (await personDebtLines(c)).find((x) => x.id === id);
    if (!now || !d) return c.json({ error: "not_found" as const }, 404);
    // Ended cycles are locked: an entry made there stays (Settled closes it).
    if (d.cycleId !== now.cycle.id) return c.json({ error: "locked" as const }, 409);
    if (d.backMinor > 0 || d.gotBack.length > 0) return c.json({ error: "paid" as const }, 409);
    const paybacks = await db.query.commitment.findMany({
      where: and(mine(commitment), eq(commitment.personDebtId, id)),
      columns: { cycleId: true },
    });
    if (paybacks.some((k) => k.cycleId !== now.cycle.id)) return c.json({ error: "locked" as const }, 409);
    await db.batch([
      db.delete(commitment).where(and(mine(commitment), eq(commitment.personDebtId, id))),
      db.delete(income).where(and(mine(income), eq(income.personDebtId, id))),
      db.delete(personDebt).where(and(mine(personDebt), eq(personDebt.id, id))),
    ]);
    return c.json({ ok: true as const });
  })
  .post("/people/:id/back", json(newBack), async (c) => {
    const { db, userId } = c.var;
    const b = c.req.valid("json");
    const id = c.req.param("id");
    const now = await current(c);
    const d = (await personDebtLines(c)).find((x) => x.id === id);
    if (!now || !d) return c.json({ error: "not_found" as const }, 404);
    const problems: string[] = checkGotBack(b, d);
    if (!(await placesUsable(c, [{ placeId: b.placeId, currency: d.currency }]))) problems.push("place");
    if (problems.length) return c.json({ error: "invalid" as const, problems }, 400);
    try {
      await db.insert(income).values({
        id: b.id,
        userId,
        cycleId: now.cycle.id,
        kind: "paid_back",
        currency: d.currency,
        amountMinor: b.amountMinor,
        toSavingsMinor: b.toSavingsMinor,
        receivedOn: now.today,
        personDebtId: id,
        placeId: b.placeId ?? null,
      });
    } catch {
      return c.json({ error: "conflict" as const }, 409);
    }
    return c.json({ ok: true as const }, 201);
  })
  .post("/people/:id/payback", json(newPayback), async (c) => {
    const { db, mine, userId } = c.var;
    const b = c.req.valid("json");
    const id = c.req.param("id");
    const now = await current(c);
    const d = (await personDebtLines(c)).find((x) => x.id === id);
    if (!now || !d) return c.json({ error: "not_found" as const }, 404);
    const open = await db.query.commitment.findMany({
      where: and(
        mine(commitment),
        eq(commitment.personDebtId, id),
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
    const problems = checkPayback(b, d, { cycleStartedOn: now.cycle.startedOn, setAsideMinor });
    if (problems.length) return c.json({ error: "invalid" as const, problems }, 400);
    try {
      await db.insert(commitment).values({
        id: b.id,
        userId,
        cycleId: now.cycle.id,
        name: paybackName(d.personName),
        kind: "person_payback",
        currency: d.currency,
        plannedMinor: b.plannedMinor,
        dueOn: b.dueOn,
        personDebtId: id,
      });
    } catch {
      return c.json({ error: "conflict" as const }, 409);
    }
    return c.json({ ok: true as const, cycleId: now.cycle.id }, 201);
  })
  .patch("/people/:id", json(settle), async (c) => {
    const { db, mine } = c.var;
    const b = c.req.valid("json");
    const id = c.req.param("id");
    const now = await current(c);
    const d = await db.query.personDebt.findFirst({ where: and(mine(personDebt), eq(personDebt.id, id)) });
    if (!now || !d) return c.json({ error: "not_found" as const }, 404);
    if (b.settled === (d.settledOn !== null)) return c.json({ ok: true as const });
    // One time for every row it changes: Undo of Settled reopens just the paybacks it finished.
    const at = new Date();
    const thisCycle = (state: "open" | "finished") =>
      and(
        mine(commitment),
        eq(commitment.personDebtId, id),
        eq(commitment.cycleId, now.cycle.id),
        eq(commitment.state, state),
      );
    await db.batch([
      db
        .update(personDebt)
        .set({ settledOn: b.settled ? now.today : null, updatedAt: at })
        .where(and(mine(personDebt), eq(personDebt.id, id))),
      b.settled
        ? // Nothing more is paid back: this cycle's open paybacks are finished, their money free again.
          db.update(commitment).set({ state: "finished", updatedAt: at }).where(thisCycle("open"))
        : // Undo: the paybacks Settled finished, untouched since.
          db
            .update(commitment)
            .set({ state: "open" })
            .where(and(thisCycle("finished"), eq(commitment.updatedAt, d.updatedAt))),
    ]);
    return c.json({ ok: true as const });
  });
