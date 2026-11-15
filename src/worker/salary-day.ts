import { and, eq, inArray } from "drizzle-orm";
import type { BatchItem } from "drizzle-orm/batch";
import { Hono } from "hono";
import * as z from "zod";
import {
  broughtIn,
  type ClosingEntries,
  checkCycleClose,
  checkSalaryDay,
  isComingUp,
  leftoverOf,
  paidItOn,
  stillToPayMinor,
  unpaidAtEnd,
  usualDayOf,
} from "../money";
import { current } from "./current";
import {
  commitment,
  commitmentPayment,
  cycle,
  cycleClose,
  income,
  pot,
  potAllocation,
  recurringCommitment,
  savingsMovement,
  spend,
} from "./db/schema";
import { json } from "./json";
import type { SignedIn } from "./user-check";

const name = z.string().transform((n) => n.trim());

const salaryDayBody = z.object({
  cycleId: z.uuid(),
  incomeId: z.uuid(),
  salaryMinor: z.number().int(),
  receivedOn: z.string(),
  expectedSalaryOn: z.string(),
  /** Step 4: this cycle's commitments. */
  commitments: z
    .array(
      z.object({
        id: z.uuid(),
        kind: z.enum(["bill", "savings"]).default("bill"),
        name,
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
        usualAmountMinor: z.number().int().optional(),
      }),
    )
    .max(50),
  /** Steps 2 and 3: last cycle's leftover and unpaid commitments (item 12). */
  close: z.object({
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
        }),
      )
      .max(100),
    inHandMinor: z.number().int().nullable(),
    toSavingsMinor: z.number().int(),
    overspend: z.enum(["take", "ignore"]).nullable(),
  }),
});

/** The current cycle's entries, as the money rules need them, to work out its leftover. */
async function entriesOf(
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
  return {
    spendingCurrency: now.settings.spendingCurrency,
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
  } satisfies ClosingEntries;
}

const changeRecurring = z.object({ active: z.boolean() });

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
        usualAmountMinor: old?.usualAmountMinor ?? p.usualAmountMinor ?? -1,
      };
    });
    const problems = checkSalaryDay(
      { ...b, pots: potRows },
      { today: now.today, cycleStartedOn: now.cycle.startedOn, spendingCurrency: cur },
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

    // Steps 2 and 3: the leftover is worked out here from the ending cycle's rows (spec 6).
    const entries = await entriesOf(c, now);
    const unpaid = unpaidAtEnd(entries.commitments, now.cycle.expectedSalaryOn);
    const leftover = leftoverOf(entries, b.close.unpaid);
    for (const p of checkCycleClose(b.close, { unpaidIds: unpaid.map((k) => k.id), leftover })) {
      problems.push(`close.${p}`);
    }
    const unpaidById = new Map(unpaid.map((k) => [k.id, k]));
    // A carried one is a new row, a Paid it with money still to pay a new payment: ids made on the phone.
    const needsId = (u: (typeof b.close.unpaid)[number]) => {
      const k = unpaidById.get(u.id);
      return k !== undefined && (u.choice === "carry" || (u.choice === "paid" && stillToPayMinor(k) > 0));
    };
    if (b.close.unpaid.some((u) => needsId(u) && !u.newId)) problems.push("close.new_id");
    if (problems.length) return c.json({ error: "invalid" as const, problems }, 400);

    const recurringIds = b.commitments.flatMap((k) => (k.recurringId ? [k.recurringId] : []));
    const templates = recurringIds.length
      ? await db.query.recurringCommitment.findMany({
          where: and(mine(recurringCommitment), inArray(recurringCommitment.id, recurringIds)),
          columns: { id: true },
        })
      : [];
    const haveTemplate = new Set(templates.map((t) => t.id));

    const writes: BatchItem<"sqlite">[] = [
      db.insert(cycle).values({
        id: b.cycleId,
        userId,
        startedOn: b.receivedOn,
        expectedSalaryOn: b.expectedSalaryOn,
      }),
      db.insert(income).values({
        id: b.incomeId,
        userId,
        cycleId: b.cycleId,
        kind: "salary",
        currency: now.settings.salaryCurrency,
        amountMinor: b.salaryMinor,
        receivedOn: b.receivedOn,
      }),
    ];
    for (const k of b.commitments) {
      const template = {
        name: k.name,
        kind: k.kind,
        usualAmountMinor: k.plannedMinor,
        usualDay: usualDayOf(k.dueOn),
      };
      let recurringId: string | null = null;
      if (k.recurringId && k.everyCycle) {
        recurringId = k.recurringId;
        if (!haveTemplate.has(k.recurringId)) {
          writes.push(
            db.insert(recurringCommitment).values({ id: k.recurringId, userId, currency: cur, ...template }),
          );
        } else if (!k.carriedFromId) {
          // The amount and day confirmed today become the last ones (spec 3).
          writes.push(
            db
              .update(recurringCommitment)
              .set(template)
              .where(and(mine(recurringCommitment), eq(recurringCommitment.id, k.recurringId))),
          );
        }
      } else if (k.recurringId && haveTemplate.has(k.recurringId)) {
        // "Every cycle" switched off on a filled one: it stops repeating.
        writes.push(
          db
            .delete(recurringCommitment)
            .where(and(mine(recurringCommitment), eq(recurringCommitment.id, k.recurringId))),
        );
      }
      writes.push(
        db.insert(commitment).values({
          id: k.id,
          userId,
          cycleId: b.cycleId,
          recurringId,
          name: k.name,
          kind: k.kind,
          currency: cur,
          plannedMinor: k.plannedMinor,
          dueOn: k.dueOn,
          carriedFromId: k.carriedFromId ?? null,
        }),
      );
      if (k.carriedFromId) {
        writes.push(
          db
            .update(commitment)
            .set({ state: "carried" })
            .where(and(mine(commitment), eq(commitment.id, k.carriedFromId))),
        );
      }
    }
    // Step 3: last cycle's unpaid commitments. The ended cycle's only writes are these (spec 2).
    for (const u of b.close.unpaid) {
      const k = unpaidById.get(u.id);
      if (!k) continue;
      const rest = stillToPayMinor(k);
      const old = and(mine(commitment), eq(commitment.id, k.id));
      if (u.choice === "paid") {
        if (rest > 0 && u.newId) {
          writes.push(
            db.insert(commitmentPayment).values({
              id: u.newId,
              userId,
              commitmentId: k.id,
              currency: k.currency,
              amountMinor: rest,
              paidOn: paidItOn(k.dueOn, now.cycle.startedOn, b.receivedOn),
            }),
          );
        }
        writes.push(db.update(commitment).set({ state: "finished" }).where(old));
      } else if (u.choice === "drop") {
        writes.push(db.update(commitment).set({ state: "dropped" }).where(old));
      } else if (u.newId) {
        // Carried: its still to pay, due as before, so it shows as late (spec 3).
        writes.push(
          db.insert(commitment).values({
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
          }),
          db.update(commitment).set({ state: "carried" }).where(old),
        );
      }
    }
    // Step 2: the leftover (or what is in hand) to savings and the new cycle, with carried ones' money.
    const brought = broughtIn(b.close, leftover);
    writes.push(
      db.insert(cycleClose).values({
        id: b.close.closeId,
        userId,
        cycleId: now.cycle.id,
        nextCycleId: b.cycleId,
        currency: cur,
        leftoverCorrectionMinor: brought.correctionMinor,
        leftoverToSavingsMinor: brought.toSavingsMinor,
        overspendChoice: b.close.overspend,
      }),
    );
    if (brought.amountMinor !== 0 || brought.toSavingsMinor !== 0) {
      writes.push(
        db.insert(income).values({
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
    for (const p of potRows) {
      if (!p.old) {
        writes.push(
          db.insert(pot).values({
            id: p.id,
            userId,
            name: p.name,
            currency: cur,
            usualAmountMinor: p.usualAmountMinor,
          }),
        );
      }
      writes.push(
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
      // An id is already in use (or the salary was entered twice at once).
      return c.json({ error: "conflict" as const }, 409);
    }
    return c.json({ ok: true as const, cycleId: b.cycleId }, 201);
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
