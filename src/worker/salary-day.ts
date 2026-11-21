import { and, eq, gt, inArray, isNotNull, ne, or, type SQL } from "drizzle-orm";
import type { BatchItem } from "drizzle-orm/batch";
import { Hono } from "hono";
import * as z from "zod";
import {
  broughtIn,
  broughtInSalary,
  type ClosingEntries,
  checkCycleClose,
  checkExpectedSalaryDay,
  checkSalaryAmount,
  checkSalaryDay,
  isComingUp,
  leftoverOf,
  paidItOn,
  salaryCarriedOf,
  salaryLeftoverOf,
  staysInPlaces,
  stillToPayMinor,
  unpaidAtEnd,
  usualDayOf,
} from "../money";
import { countingRateOf, current } from "./current";
import {
  card,
  commitment,
  commitmentPayment,
  conversion,
  countingRate,
  cycle,
  cycleClose,
  dayChoice,
  income,
  instalmentPlan,
  personDebt,
  planExtraPayment,
  pot,
  potAllocation,
  prepayment,
  type RecurringBefore,
  recurringCommitment,
  type SalaryDayUndo,
  savingsGoal,
  savingsMovement,
  spend,
} from "./db/schema";
import { json } from "./json";
import { placeId, placesUsable } from "./place-use";
import type { SignedIn } from "./user-check";

const name = z.string().transform((n) => n.trim());

const salaryDayBody = z.object({
  cycleId: z.uuid(),
  incomeId: z.uuid(),
  salaryMinor: z.number().int(),
  receivedOn: z.string(),
  /** Step 1: the place the salary landed in (SAB-52), in the salary currency; null moves no place. */
  placeId,
  expectedSalaryOn: z.string(),
  /** Step 6, two currencies (spec 6, 8): a new counting rate; none keeps the current one. */
  countingRate: z.object({ id: z.uuid(), rate: z.string() }).nullish(),
  /** Step 4: this cycle's commitments. */
  commitments: z
    .array(
      z.object({
        id: z.uuid(),
        kind: z
          .enum(["bill", "savings", "savings_payback", "card_bill", "plan_payment", "person_payback"])
          .default("bill"),
        /** A plan payment: its instalment plan (item 19); a carried one keeps the plan of the one it carries on. */
        planId: z.uuid().nullish(),
        /** A card bill: its card (item 18); a carried one keeps the card of the one it carries on. */
        cardId: z.uuid().nullish(),
        /** A payback to savings: the prepayment it pays back (item 14). */
        prepaymentId: z.uuid().nullish(),
        /** A goal share (SAB-68): the savings goal it saves toward; a carried one keeps its goal. */
        goalId: z.uuid().nullish(),
        name,
        /** Either of the user's currencies (spec 8); none: the spending currency. */
        currency: z.string().optional(),
        plannedMinor: z.number().int(),
        dueOn: z.string(),
        /** The template it was filled from, or the one "Every cycle" makes. */
        recurringId: z.uuid().nullish(),
        /** Off on a filled one: it stops repeating (its template is deleted). */
        everyCycle: z.boolean().default(false),
        /** Last cycle's coming-up commitment it carries on. */
        carriedFromId: z.uuid().nullish(),
      }),
    )
    .max(100),
  /** Step 5: each pot's amount this cycle; a pot id not yet known with a name is a new pot. */
  pots: z
    .array(
      z.object({
        id: z.uuid(),
        allocationId: z.uuid(),
        amountMinor: z.number().int(),
        name: name.optional(),
        /** A new pot's currency (spec 8); a known pot keeps its own. */
        currency: z.string().optional(),
        usualAmountMinor: z.number().int().optional(),
      }),
    )
    .max(50),
  /** Steps 2 and 3: last cycle's leftover and unpaid commitments (item 12). */
  close: z.object({
    /** Two currencies: the income row for the salary currency's leftover (item 15). */
    salaryLeftoverIncomeId: z.uuid().optional(),
    /** Two currencies: the `cycle_close` row for the salary currency's leftover (item 16). */
    salaryCloseId: z.uuid().optional(),
    /** Two currencies: dollars actually in hand (null keeps the dollar leftover) and sent to dollar savings. */
    salaryInHandMinor: z.number().int().nullable().default(null),
    salaryToSavingsMinor: z.number().int().default(0),
    /** The `cycle_close` row and the new cycle's `leftover` income. */
    closeId: z.uuid(),
    leftoverIncomeId: z.uuid(),
    unpaid: z
      .array(
        z.object({
          id: z.uuid(),
          choice: z.enum(["paid", "carry", "drop"]),
          /** Carry: the new commitment's id. Paid it: the payment's id. */
          newId: z.uuid().nullish(),
          /** Paid it: the place it was paid from (SAB-52), in the commitment's currency; null moves no place. */
          placeId,
        }),
      )
      .max(100),
    inHandMinor: z.number().int().nullable(),
    toSavingsMinor: z.number().int(),
    overspend: z.enum(["take", "ignore"]).nullable(),
  }),
});

/** The current cycle's entries, as the money rules need them: its leftover, a conversion's split. */
export async function entriesOf(
  c: { var: SignedIn["Variables"] },
  now: NonNullable<Awaited<ReturnType<typeof current>>>,
) {
  const { db, mine } = c.var;
  const id = now.cycle.id;
  const incomes = await db.query.income.findMany({
    where: and(mine(income), eq(income.cycleId, id)),
    columns: { kind: true, currency: true, amountMinor: true, toSavingsMinor: true, receivedOn: true },
  });
  const spends = await db.query.spend.findMany({
    where: and(mine(spend), eq(spend.cycleId, id)),
    columns: { spentOn: true, currency: true, amountMinor: true, potId: true, oneOff: true },
  });
  const commitments = await db.query.commitment.findMany({
    where: and(mine(commitment), eq(commitment.cycleId, id)),
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
  });
  const pots = await db
    .select({
      id: pot.id,
      currency: pot.currency,
      archived: pot.archived,
      amountMinor: potAllocation.amountMinor,
    })
    .from(potAllocation)
    .innerJoin(pot, eq(pot.id, potAllocation.potId))
    .where(and(mine(pot), eq(potAllocation.cycleId, id)));
  const takeOuts = await db.query.savingsMovement.findMany({
    where: and(mine(savingsMovement), eq(savingsMovement.cycleId, id), eq(savingsMovement.kind, "take_out")),
    columns: { currency: true, amountMinor: true, movedOn: true },
  });
  const conversions = await db.query.conversion.findMany({
    where: and(mine(conversion), eq(conversion.cycleId, id)),
    columns: { givenMinor: true, receivedMinor: true, gainMinor: true },
  });
  // Pay extra from free money (item 19) comes out of this cycle's free money.
  const planExtras = await db.query.planExtraPayment.findMany({
    where: and(
      mine(planExtraPayment),
      eq(planExtraPayment.cycleId, id),
      eq(planExtraPayment.paidFrom, "free"),
    ),
    columns: { currency: true, amountMinor: true },
  });
  // Money lent to people in this cycle (item 20) came out of its free money.
  const lent = await db.query.personDebt.findMany({
    where: and(mine(personDebt), eq(personDebt.cycleId, id), eq(personDebt.direction, "lent")),
    columns: { currency: true, amountMinor: true },
  });
  return {
    spendingCurrency: now.settings.spendingCurrency,
    salaryCurrency: now.settings.salaryCurrency,
    countingRate: await countingRateOf(c),
    reserveRate: now.cycle.reserveRate,
    conversions,
    startedOn: now.cycle.startedOn,
    expectedSalaryOn: now.cycle.expectedSalaryOn,
    incomes,
    spends,
    commitments: commitments.map((k) => ({
      ...k,
      payments: payments.filter((p) => p.commitmentId === k.id),
    })),
    pots,
    takenOut: takeOuts.map((t) => ({ ...t, amountMinor: -t.amountMinor })),
    planExtras,
    lent,
  } satisfies ClosingEntries;
}

const changeRecurring = z.object({ active: z.boolean() });

/** Tables whose rows count as "something new entered" for Undo salary day. */
type Stamped =
  | typeof spend
  | typeof commitment
  | typeof commitmentPayment
  | typeof pot
  | typeof potAllocation
  | typeof dayChoice
  | typeof savingsMovement
  | typeof prepayment
  | typeof recurringCommitment
  | typeof conversion
  | typeof card
  | typeof instalmentPlan
  | typeof planExtraPayment
  | typeof personDebt
  | typeof income;

/**
 * Undo salary day's record for a cycle, while it is allowed (item 13, spec 2):
 * the cycle was started by salary day after item 13, and nothing has been
 * entered or changed since, in it or anywhere it touches, except the salary
 * amount and the expected salary day, which stay editable. Salary day stamps
 * every row it writes with the new cycle's `created_at`, so "newer" is any row
 * changed after that. Null when undo is not allowed. Today reads the same in
 * SQL (`UNDO_TABLES` in today-read.ts): a table added here goes there too.
 */
export async function undoRecord(
  c: { var: SignedIn["Variables"] },
  cur: { id: string; createdAt: Date },
): Promise<SalaryDayUndo | null> {
  const { db, mine } = c.var;
  const close = await db.query.cycleClose.findFirst({
    // The spending currency's row holds it; a second currency's row has none (item 16).
    where: and(mine(cycleClose), eq(cycleClose.nextCycleId, cur.id), isNotNull(cycleClose.undo)),
    columns: { undo: true },
  });
  if (!close?.undo) return null;
  const at = cur.createdAt;
  const any = (t: Stamped, more?: SQL) =>
    db
      .select({ id: t.id })
      .from(t)
      .where(and(mine(t), gt(t.updatedAt, at), more))
      .limit(1);
  const found = await db.batch([
    any(spend),
    any(commitment),
    any(commitmentPayment),
    any(pot),
    any(potAllocation),
    any(dayChoice),
    any(savingsMovement),
    any(prepayment),
    any(recurringCommitment),
    any(conversion),
    any(card),
    any(instalmentPlan),
    any(planExtraPayment),
    any(personDebt),
    // The salary amount stays editable during the current cycle (spec 2).
    any(income, or(ne(income.cycleId, cur.id), ne(income.kind, "salary"))),
  ]);
  return found.some((rows) => rows.length > 0) ? null : close.undo;
}

/**
 * Salary day (backlog item 11, spec 2, 3, 6): Start new cycle makes the new
 * cycle with its salary, commitments (filled from the recurring ones and last
 * cycle's coming-up ones) and pot amounts in one write; the old cycle ends and
 * is locked. Steps 2 and 3 (item 12) close the old cycle in the same write:
 * its unpaid commitments are paid, carried or dropped, and its leftover goes to
 * savings and the new cycle as the new cycle's `leftover` income. Also the Every cycle page's paused switch.
 */
export const salaryDay = new Hono<SignedIn>()
  .post("/salary-day", json(salaryDayBody), async (c) => {
    const { db, mine, userId } = c.var;
    const b = c.req.valid("json");
    const now = await current(c);
    if (!now) return c.json({ error: "not_set_up" as const }, 404);
    const cur = now.settings.spendingCurrency;
    const myPots = await db.query.pot.findMany({ where: mine(pot) });
    const known = new Map(myPots.map((p) => [p.id, p]));
    const potRows = b.pots.map((p) => {
      const old = known.get(p.id);
      return {
        ...p,
        old,
        name: old?.name ?? p.name ?? "",
        currency: old?.currency ?? p.currency ?? cur,
        usualAmountMinor: old?.usualAmountMinor ?? p.usualAmountMinor ?? -1,
      };
    });
    const problems = checkSalaryDay(
      { ...b, countingRate: b.countingRate?.rate ?? null, pots: potRows },
      { today: now.today, cycleStartedOn: now.cycle.startedOn, ...now.currencies },
    );
    // A pot once only; a stopped pot is not set aside again.
    if (new Set(b.pots.map((p) => p.id)).size !== b.pots.length) problems.push("pot.twice");
    potRows.forEach((p, i) => {
      if (p.old?.archived) problems.push(`pot.${i}.archived`);
    });

    // Carried on: open commitments of the ending cycle due after its salary day, once each.
    const carriedIds = b.commitments.flatMap((k) => (k.carriedFromId ? [k.carriedFromId] : []));
    const carried = carriedIds.length
      ? await db.query.commitment.findMany({
          where: and(mine(commitment), inArray(commitment.id, carriedIds)),
        })
      : [];
    const comingUp = new Set(
      carried
        .filter((k) => k.cycleId === now.cycle.id && isComingUp(k, now.cycle.expectedSalaryOn))
        .map((k) => k.id),
    );
    if (new Set(carriedIds).size !== carriedIds.length || carriedIds.some((id) => !comingUp.has(id))) {
      problems.push("carried_from");
    }

    // Paybacks to savings (item 14): one of the user's prepayments, never Every cycle; a carried
    // one keeps the prepayment of the commitment it carries on.
    const carriedById = new Map(carried.map((k) => [k.id, k]));
    const prepaymentOf = (k: (typeof b.commitments)[number]) =>
      k.carriedFromId ? (carriedById.get(k.carriedFromId)?.prepaymentId ?? null) : (k.prepaymentId ?? null);
    const wanted = [...new Set(b.commitments.flatMap((k) => (k.prepaymentId ? [k.prepaymentId] : [])))];
    const myPrepayments = wanted.length
      ? await db.query.prepayment.findMany({
          where: and(mine(prepayment), inArray(prepayment.id, wanted)),
          columns: { id: true },
        })
      : [];
    const prepaymentIds = new Set(myPrepayments.map((p) => p.id));
    b.commitments.forEach((k, i) => {
      const linked = prepaymentOf(k);
      const payback = k.kind === "savings_payback";
      if (payback !== (linked !== null) || (payback && k.everyCycle)) problems.push(`commitment.${i}.kind`);
      else if (payback && !k.carriedFromId && !prepaymentIds.has(linked as string)) {
        problems.push(`commitment.${i}.prepayment`);
      }
    });

    // Card bills (item 18): one of the user's cards, in its currency; a carried one keeps its card.
    const cardOf = (k: (typeof b.commitments)[number]) =>
      k.carriedFromId ? (carriedById.get(k.carriedFromId)?.cardId ?? null) : (k.cardId ?? null);
    const wantedCards = [...new Set(b.commitments.flatMap((k) => (k.cardId ? [k.cardId] : [])))];
    const myCards = wantedCards.length
      ? await db.query.card.findMany({
          where: and(mine(card), inArray(card.id, wantedCards)),
          columns: { id: true, currency: true },
        })
      : [];
    b.commitments.forEach((k, i) => {
      const linked = cardOf(k);
      const bill = k.kind === "card_bill";
      if (bill !== (linked !== null)) problems.push(`commitment.${i}.card`);
      else if (bill && !k.carriedFromId) {
        const found = myCards.find((x) => x.id === linked);
        if (!found || found.currency !== (k.currency ?? cur)) problems.push(`commitment.${i}.card`);
      }
    });

    // Plan payments (item 19): one of the user's plans not paid off, never Every cycle; a carried
    // one keeps the plan of the commitment it carries on.
    const planOf = (k: (typeof b.commitments)[number]) =>
      k.carriedFromId ? (carriedById.get(k.carriedFromId)?.planId ?? null) : (k.planId ?? null);
    const wantedPlans = [...new Set(b.commitments.flatMap((k) => (k.planId ? [k.planId] : [])))];
    const myPlans = wantedPlans.length
      ? await db.query.instalmentPlan.findMany({
          where: and(mine(instalmentPlan), inArray(instalmentPlan.id, wantedPlans)),
          columns: { id: true, currency: true, paidOffOn: true },
        })
      : [];
    b.commitments.forEach((k, i) => {
      const linked = planOf(k);
      const payment = k.kind === "plan_payment";
      if (payment !== (linked !== null) || (payment && k.everyCycle)) problems.push(`commitment.${i}.plan`);
      else if (payment && !k.carriedFromId) {
        const found = myPlans.find((x) => x.id === linked);
        if (!found || found.paidOffOn || found.currency !== (k.currency ?? cur)) {
          problems.push(`commitment.${i}.plan`);
        }
      }
    });

    // Paybacks to a person (item 20): only last cycle's coming-up ones move on, keeping their entry.
    const personDebtOf = (k: (typeof b.commitments)[number]) =>
      k.carriedFromId ? (carriedById.get(k.carriedFromId)?.personDebtId ?? null) : null;
    b.commitments.forEach((k, i) => {
      const payback = k.kind === "person_payback";
      if (payback !== (personDebtOf(k) !== null) || (payback && k.everyCycle)) {
        problems.push(`commitment.${i}.person`);
      }
    });

    // Goal shares (SAB-68): a savings set-aside of one of the user's live goals, in its currency,
    // never Every cycle; a carried one keeps the goal of the commitment it carries on.
    const goalOf = (k: (typeof b.commitments)[number]) =>
      k.carriedFromId ? (carriedById.get(k.carriedFromId)?.goalId ?? null) : (k.goalId ?? null);
    const wantedGoals = [...new Set(b.commitments.flatMap((k) => (k.goalId ? [k.goalId] : [])))];
    const myGoals = wantedGoals.length
      ? await db.query.savingsGoal.findMany({
          where: and(mine(savingsGoal), inArray(savingsGoal.id, wantedGoals)),
          columns: { id: true, currency: true, stopped: true },
        })
      : [];
    b.commitments.forEach((k, i) => {
      const linked = goalOf(k);
      if (linked === null) return;
      if (k.kind !== "savings" || k.everyCycle) problems.push(`commitment.${i}.goal`);
      else if (!k.carriedFromId) {
        const found = myGoals.find((x) => x.id === linked);
        if (!found || found.stopped || found.currency !== (k.currency ?? cur)) {
          problems.push(`commitment.${i}.goal`);
        }
      }
    });

    // Steps 2 and 3: the leftover is worked out here from the ending cycle's rows (spec 6).
    const entries = await entriesOf(c, now);
    const unpaid = unpaidAtEnd(entries.commitments, now.cycle.expectedSalaryOn);
    const leftover = leftoverOf(entries, b.close.unpaid);
    const salaryLeftover = salaryLeftoverOf(entries, b.close.unpaid);
    const salaryBrought =
      salaryLeftover === null
        ? null
        : broughtInSalary(b.close, salaryLeftover, salaryCarriedOf(entries, b.close.unpaid));
    const salaryIncome =
      salaryBrought !== null && (salaryBrought.amountMinor !== 0 || salaryBrought.toSavingsMinor !== 0);
    const salaryIdsMissing =
      (salaryIncome && !b.close.salaryLeftoverIncomeId) ||
      (salaryLeftover !== null && !b.close.salaryCloseId);
    if (salaryIdsMissing) problems.push("close.new_id");
    const closeCtx = { unpaidIds: unpaid.map((k) => k.id), leftover, salaryLeftoverMinor: salaryLeftover };
    for (const p of checkCycleClose(b.close, closeCtx)) {
      problems.push(`close.${p}`);
    }
    const unpaidById = new Map(unpaid.map((k) => [k.id, k]));
    // A carried one is a new row, a Paid it with money still to pay a new payment: ids made on the phone.
    const needsId = (u: (typeof b.close.unpaid)[number]) => {
      const k = unpaidById.get(u.id);
      return k !== undefined && (u.choice === "carry" || (u.choice === "paid" && stillToPayMinor(k) > 0));
    };
    if (b.close.unpaid.some((u) => needsId(u) && !u.newId)) problems.push("close.new_id");
    // The salary's place and each Paid it's place (SAB-52): the user's, in use, in the money's currency.
    // A savings set-aside paid is moved to savings: its money stays where it is.
    const paidFrom = (u: (typeof b.close.unpaid)[number]) => {
      const k = unpaidById.get(u.id);
      return k && u.choice === "paid" && !staysInPlaces(k.kind) ? (u.placeId ?? null) : null;
    };
    const placeUses = [
      { placeId: b.placeId, currency: now.settings.salaryCurrency },
      ...b.close.unpaid.map((u) => ({
        placeId: paidFrom(u),
        currency: unpaidById.get(u.id)?.currency ?? cur,
      })),
    ];
    if (!(await placesUsable(c, placeUses))) problems.push("place");
    if (problems.length) return c.json({ error: "invalid" as const, problems }, 400);

    const recurringIds = b.commitments.flatMap((k) => (k.recurringId ? [k.recurringId] : []));
    const templates = recurringIds.length
      ? await db.query.recurringCommitment.findMany({
          where: and(mine(recurringCommitment), inArray(recurringCommitment.id, recurringIds)),
        })
      : [];
    const haveTemplate = new Map(templates.map((t) => [t.id, t]));

    // One time for every row salary day writes: Undo is allowed while nothing is newer (item 13).
    const at = new Date();
    const stamp = { createdAt: at, updatedAt: at };
    const touched = { updatedAt: at };
    const undo: SalaryDayUndo = {
      templates: [],
      potsMade: potRows.filter((p) => !p.old).map((p) => p.id),
      reopened: [],
      payments: [],
      ...(b.countingRate ? { countingRateId: b.countingRate.id } : {}),
    };
    const keep = (id: string, before: RecurringBefore | null) => {
      if (!undo.templates.some((t) => t.id === id)) undo.templates.push({ id, before });
    };

    const writes: BatchItem<"sqlite">[] = [
      db.insert(cycle).values({
        ...stamp,
        id: b.cycleId,
        userId,
        startedOn: b.receivedOn,
        expectedSalaryOn: b.expectedSalaryOn,
        // The counting rate when salary day was confirmed (spec 8): rupee set-asides are reserved at it.
        reserveRate: b.countingRate?.rate ?? entries.countingRate ?? null,
      }),
      db.insert(income).values({
        ...stamp,
        id: b.incomeId,
        userId,
        cycleId: b.cycleId,
        kind: "salary",
        currency: now.settings.salaryCurrency,
        amountMinor: b.salaryMinor,
        receivedOn: b.receivedOn,
        placeId: b.placeId ?? null,
      }),
    ];
    if (b.countingRate) {
      // Step 6's rate is the newest counting rate from now on (spec 6, 8).
      writes.push(
        db
          .insert(countingRate)
          .values({ ...stamp, id: b.countingRate.id, userId, rate: b.countingRate.rate, setAt: at }),
      );
    }
    for (const k of b.commitments) {
      const template = {
        name: k.name,
        // A payback or plan payment is never Every cycle (checked above).
        kind: k.kind as "bill" | "savings" | "card_bill",
        usualAmountMinor: k.plannedMinor,
        usualDay: usualDayOf(k.dueOn),
        cardId: cardOf(k),
      };
      let recurringId: string | null = null;
      if (k.recurringId && k.everyCycle) {
        recurringId = k.recurringId;
        const before = haveTemplate.get(k.recurringId);
        if (!before) {
          keep(k.recurringId, null);
          writes.push(
            db
              .insert(recurringCommitment)
              .values({ ...stamp, id: k.recurringId, userId, currency: k.currency ?? cur, ...template }),
          );
        } else if (!k.carriedFromId) {
          // The amount and day confirmed today become the last ones (spec 3).
          keep(k.recurringId, before);
          writes.push(
            db
              .update(recurringCommitment)
              .set({ ...template, ...touched })
              .where(and(mine(recurringCommitment), eq(recurringCommitment.id, k.recurringId))),
          );
        }
      } else if (k.recurringId && haveTemplate.has(k.recurringId)) {
        // "Every cycle" switched off on a filled one: it stops repeating.
        keep(k.recurringId, haveTemplate.get(k.recurringId) ?? null);
        writes.push(
          db
            .delete(recurringCommitment)
            .where(and(mine(recurringCommitment), eq(recurringCommitment.id, k.recurringId))),
        );
      }
      writes.push(
        db.insert(commitment).values({
          ...stamp,
          id: k.id,
          userId,
          cycleId: b.cycleId,
          recurringId,
          name: k.name,
          kind: k.kind,
          currency: k.currency ?? cur,
          plannedMinor: k.plannedMinor,
          dueOn: k.dueOn,
          carriedFromId: k.carriedFromId ?? null,
          prepaymentId: prepaymentOf(k),
          cardId: cardOf(k),
          planId: planOf(k),
          personDebtId: personDebtOf(k),
          goalId: goalOf(k),
        }),
      );
      if (k.carriedFromId) {
        undo.reopened.push({ id: k.carriedFromId, state: "open" });
        writes.push(
          db
            .update(commitment)
            .set({ ...touched, state: "carried" })
            .where(and(mine(commitment), eq(commitment.id, k.carriedFromId))),
        );
      }
    }
    // Step 2: last cycle's unpaid commitments. The ended cycle's only writes are these (spec 2).
    for (const u of b.close.unpaid) {
      const k = unpaidById.get(u.id);
      if (!k) continue;
      const rest = stillToPayMinor(k);
      const old = and(mine(commitment), eq(commitment.id, k.id));
      undo.reopened.push({ id: k.id, state: k.state });
      if (u.choice === "paid") {
        if (rest > 0 && u.newId) {
          undo.payments.push(u.newId);
          writes.push(
            db.insert(commitmentPayment).values({
              ...stamp,
              id: u.newId,
              userId,
              commitmentId: k.id,
              currency: k.currency,
              amountMinor: rest,
              paidOn: paidItOn(k.dueOn, now.cycle.startedOn, b.receivedOn),
              placeId: paidFrom(u),
            }),
          );
        }
        writes.push(
          db
            .update(commitment)
            .set({ ...touched, state: "finished" })
            .where(old),
        );
      } else if (u.choice === "drop") {
        writes.push(
          db
            .update(commitment)
            .set({ ...touched, state: "dropped" })
            .where(old),
        );
      } else if (u.newId) {
        // Carried: its still to pay, due as before, so it shows as late (spec 3).
        writes.push(
          db.insert(commitment).values({
            ...stamp,
            id: u.newId,
            userId,
            cycleId: b.cycleId,
            name: k.name,
            kind: k.kind,
            currency: k.currency,
            plannedMinor: rest,
            dueOn: k.dueOn,
            carriedFromId: k.id,
            cardId: k.cardId,
            planId: k.planId,
            personDebtId: k.personDebtId,
            prepaymentId: k.prepaymentId,
            goalId: k.goalId,
          }),
          db
            .update(commitment)
            .set({ ...touched, state: "carried" })
            .where(old),
        );
      }
    }
    // Step 3: the leftover (or what is in hand) to savings and the new cycle, with carried ones' money.
    const brought = broughtIn(b.close, leftover);
    writes.push(
      db.insert(cycleClose).values({
        ...stamp,
        id: b.close.closeId,
        userId,
        cycleId: now.cycle.id,
        nextCycleId: b.cycleId,
        currency: cur,
        // Kept for Past's "how it ended" (item 21).
        leftoverMinor: leftover.leftoverMinor,
        leftoverCorrectionMinor: brought.correctionMinor,
        leftoverToSavingsMinor: brought.toSavingsMinor,
        overspendChoice: b.close.overspend,
        // Complete here: step 4's and step 2's entries are in, pots made are known.
        undo,
      }),
    );
    if (brought.amountMinor !== 0 || brought.toSavingsMinor !== 0) {
      writes.push(
        db.insert(income).values({
          ...stamp,
          id: b.close.leftoverIncomeId,
          userId,
          cycleId: b.cycleId,
          kind: "leftover",
          currency: cur,
          amountMinor: brought.amountMinor,
          toSavingsMinor: brought.toSavingsMinor,
          receivedOn: b.receivedOn,
        }),
      );
    }
    // Two currencies: the salary currency's leftover to dollar savings and the new cycle (item 16).
    const salaryCur = now.currencies.salaryCurrency;
    if (salaryBrought && salaryCur && b.close.salaryCloseId) {
      writes.push(
        db.insert(cycleClose).values({
          ...stamp,
          id: b.close.salaryCloseId,
          userId,
          cycleId: now.cycle.id,
          nextCycleId: b.cycleId,
          currency: salaryCur,
          leftoverMinor: salaryLeftover,
          leftoverCorrectionMinor: salaryBrought.correctionMinor,
          leftoverToSavingsMinor: salaryBrought.toSavingsMinor,
        }),
      );
    }
    if (salaryBrought && salaryIncome && salaryCur && b.close.salaryLeftoverIncomeId) {
      writes.push(
        db.insert(income).values({
          ...stamp,
          id: b.close.salaryLeftoverIncomeId,
          userId,
          cycleId: b.cycleId,
          kind: "leftover",
          currency: salaryCur,
          amountMinor: salaryBrought.amountMinor,
          toSavingsMinor: salaryBrought.toSavingsMinor,
          receivedOn: b.receivedOn,
        }),
      );
    }
    for (const p of potRows) {
      if (!p.old) {
        writes.push(
          db.insert(pot).values({
            ...stamp,
            id: p.id,
            userId,
            name: p.name,
            currency: p.currency,
            usualAmountMinor: p.usualAmountMinor,
          }),
        );
      }
      writes.push(
        db.insert(potAllocation).values({
          ...stamp,
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
      // An id is already in use (or the salary was entered twice at once).
      return c.json({ error: "conflict" as const }, 409);
    }
    return c.json({ ok: true as const, cycleId: b.cycleId }, 201);
  })
  /**
   * Undo salary day (item 13, spec 2): removes the new cycle and everything in it
   * (cascades: its incomes, commitments, pot amounts, cycle-end choices), pots
   * made that day, the counting rate typed in step 6, puts back the templates it made, changed or deleted, and
   * reopens last cycle's commitments it paid, carried or dropped (Paid it's
   * payments go too). The old cycle is current again, as it was. `cycleId` is
   * the cycle to undo, so a second tap can't undo the salary day before it.
   */
  .post("/salary-day/undo", json(z.object({ cycleId: z.uuid() })), async (c) => {
    const { db, mine, userId } = c.var;
    const now = await current(c);
    if (!now || now.cycle.id !== c.req.valid("json").cycleId) {
      return c.json({ error: "not_found" as const }, 404);
    }
    const undo = await undoRecord(c, now.cycle);
    if (!undo) return c.json({ error: "too_late" as const }, 409);
    const writes: BatchItem<"sqlite">[] = [];
    for (const id of undo.payments) {
      writes.push(
        db.delete(commitmentPayment).where(and(mine(commitmentPayment), eq(commitmentPayment.id, id))),
      );
    }
    for (const k of undo.reopened) {
      writes.push(
        db
          .update(commitment)
          .set({ state: k.state })
          .where(and(mine(commitment), eq(commitment.id, k.id))),
      );
    }
    for (const t of undo.templates) {
      const row = and(mine(recurringCommitment), eq(recurringCommitment.id, t.id));
      if (!t.before) {
        writes.push(db.delete(recurringCommitment).where(row));
        continue;
      }
      // Stored as JSON: dates come back as text.
      const before = {
        ...t.before,
        userId,
        createdAt: new Date(t.before.createdAt),
        updatedAt: new Date(t.before.updatedAt),
      };
      writes.push(
        db
          .insert(recurringCommitment)
          .values(before)
          .onConflictDoUpdate({
            target: recurringCommitment.id,
            set: before,
            setWhere: eq(recurringCommitment.userId, userId),
          }),
      );
    }
    if (undo.countingRateId) {
      writes.push(
        db.delete(countingRate).where(and(mine(countingRate), eq(countingRate.id, undo.countingRateId))),
      );
    }
    writes.push(db.delete(cycle).where(and(mine(cycle), eq(cycle.id, now.cycle.id))));
    for (const id of undo.potsMade) {
      writes.push(db.delete(pot).where(and(mine(pot), eq(pot.id, id))));
    }
    await db.batch(writes as [BatchItem<"sqlite">, ...BatchItem<"sqlite">[]]);
    return c.json({ ok: true as const });
  })
  /** The salary amount stays editable during the current cycle (item 13, spec 2). */
  .patch("/salary", json(z.object({ salaryMinor: z.number().int() })), async (c) => {
    const { db, mine } = c.var;
    const { salaryMinor } = c.req.valid("json");
    const now = await current(c);
    if (!now) return c.json({ error: "not_set_up" as const }, 404);
    const problems = checkSalaryAmount(salaryMinor);
    if (problems.length) return c.json({ error: "invalid" as const, problems }, 400);
    const done = await db
      .update(income)
      .set({ amountMinor: salaryMinor })
      .where(and(mine(income), eq(income.cycleId, now.cycle.id), eq(income.kind, "salary")))
      .returning({ id: income.id });
    // The first cycle has opening money, not a salary.
    if (!done.length) return c.json({ error: "no_salary" as const }, 404);
    return c.json({ ok: true as const });
  })
  /**
   * The expected salary day, changed later (spec 2): also a late salary's new
   * expected day; the days left are re-counted from it (item 13).
   */
  .patch("/cycle", json(z.object({ expectedSalaryOn: z.string() })), async (c) => {
    const { db, mine } = c.var;
    const { expectedSalaryOn } = c.req.valid("json");
    const now = await current(c);
    if (!now) return c.json({ error: "not_set_up" as const }, 404);
    const problems = checkExpectedSalaryDay(expectedSalaryOn, now.today);
    if (problems.length) return c.json({ error: "invalid" as const, problems }, 400);
    await db
      .update(cycle)
      .set({ expectedSalaryOn })
      .where(and(mine(cycle), eq(cycle.id, now.cycle.id)));
    return c.json({ ok: true as const });
  })
  /** Every cycle page: pause a recurring commitment, or switch it back on (spec 3, 10). */
  .patch("/recurring-commitments/:id", json(changeRecurring), async (c) => {
    const { db, mine } = c.var;
    const done = await db
      .update(recurringCommitment)
      .set(c.req.valid("json"))
      .where(and(mine(recurringCommitment), eq(recurringCommitment.id, c.req.param("id"))))
      .returning({ id: recurringCommitment.id });
    if (!done.length) return c.json({ error: "not_found" as const }, 404);
    return c.json({ ok: true as const });
  });
