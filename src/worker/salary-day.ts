import { and, eq, inArray } from "drizzle-orm";
import type { BatchItem } from "drizzle-orm/batch";
import { Hono } from "hono";
import * as z from "zod";
import { checkSalaryDay, isComingUp, usualDayOf } from "../money";
import { current } from "./current";
import { commitment, cycle, income, pot, potAllocation, recurringCommitment } from "./db/schema";
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
});

const changeRecurring = z.object({ active: z.boolean() });

/**
 * Salary day (backlog item 11, spec 2, 3, 6): Start new cycle makes the new
 * cycle with its salary, commitments (filled from the recurring ones and last
 * cycle's coming-up ones) and pot amounts in one write; the old cycle ends and
 * is locked. Last cycle's leftover and unpaid commitments come with item 12.
 * Also the Every cycle page's paused switch.
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
