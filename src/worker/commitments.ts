import { and, eq } from "drizzle-orm";
import { Hono } from "hono";
import * as z from "zod";
import { checkCommitment, usualDayOf } from "../money";
import { current } from "./current";
import { card, commitment, recurringCommitment } from "./db/schema";
import { json } from "./json";
import type { SignedIn } from "./user-check";

const name = z.string().transform((n) => n.trim());

/** Kinds a commitment page can switch between (spec 3, 5). */
const kind = z.enum(["bill", "savings"]);

/** Kinds made here: a card bill is made from its card's page (item 18, spec 9). */
const newKind = z.enum(["bill", "savings", "card_bill"]);

type RepeatKind = "bill" | "savings" | "card_bill";
const repeats = (k: string): k is RepeatKind => k === "bill" || k === "savings" || k === "card_bill";

const newCommitment = z.object({
  id: z.uuid(),
  /** Either of the user's currencies (spec 8); none: the spending currency. Fixed once made. */
  currency: z.string().optional(),
  kind: newKind.default("bill"),
  /** A card bill's card (item 18): one of the user's, and the bill is in its currency. */
  cardId: z.uuid().optional(),
  name,
  plannedMinor: z.number().int(),
  dueOn: z.string(),
  /** "Every cycle" on: the id of the template it makes (item 11). */
  recurringId: z.uuid().optional(),
});

const changeCommitment = z
  .object({
    name,
    plannedMinor: z.number().int(),
    dueOn: z.string(),
    kind,
    /** Mark finished, or reopen (item 6). Carried and dropped come with salary day (item 12). */
    state: z.enum(["open", "finished"]),
    /** The "Every cycle" switch (item 11); turning it on needs `recurringId`. */
    everyCycle: z.boolean(),
    recurringId: z.uuid(),
  })
  .partial();

/**
 * The "Every cycle" template's fields, from its commitment: the last amount and
 * day (spec 3); a card bill's card, whose balance fills it on salary day (item 18).
 */
const templateOf = (k: {
  name: string;
  kind: RepeatKind;
  plannedMinor: number;
  dueOn: string;
  cardId?: string | null;
}) => ({
  name: k.name,
  kind: k.kind,
  usualAmountMinor: k.plannedMinor,
  usualDay: usualDayOf(k.dueOn),
  cardId: k.kind === "card_bill" ? (k.cardId ?? null) : null,
});

/**
 * Commitments (backlog items 5, 6 and 11, spec 3 and 10): add, change, mark
 * finished, reopen and delete bills and savings set-asides (item 10) in the
 * current cycle only (ended cycles are locked). The "Every cycle" switch keeps a
 * `recurring_commitment` in step with the commitment; deleting the commitment
 * stops it repeating. Payments are in payments.ts. The phone works out every number.
 */
export const commitments = new Hono<SignedIn>()
  .post("/commitments", json(newCommitment), async (c) => {
    const { db, userId } = c.var;
    const { recurringId, cardId, ...b } = c.req.valid("json");
    const now = await current(c);
    if (!now) return c.json({ error: "not_set_up" as const }, 404);
    const theCard =
      b.kind === "card_bill" && cardId
        ? await c.var.db.query.card.findFirst({
            where: and(c.var.mine(card), eq(card.id, cardId)),
            columns: { id: true, currency: true },
          })
        : undefined;
    const row = {
      ...b,
      // A card bill is in its card's currency (item 18).
      currency: theCard?.currency ?? b.currency ?? now.settings.spendingCurrency,
      cardId: theCard?.id ?? null,
    };
    const problems: string[] = checkCommitment(row, {
      cycleStartedOn: now.cycle.startedOn,
      ...now.currencies,
    });
    if ((b.kind === "card_bill") !== (theCard !== undefined) || (cardId && b.kind !== "card_bill")) {
      problems.push("card");
    }
    if (problems.length) return c.json({ error: "invalid" as const, problems }, 400);
    const insert = db
      .insert(commitment)
      .values({ ...row, userId, cycleId: now.cycle.id, recurringId: recurringId ?? null });
    try {
      if (recurringId) {
        await db.batch([
          db
            .insert(recurringCommitment)
            .values({ id: recurringId, userId, currency: row.currency, ...templateOf(row) }),
          insert,
        ]);
      } else {
        await insert;
      }
    } catch {
      // An id is already in use.
      return c.json({ error: "conflict" as const }, 409);
    }
    return c.json({ ok: true as const, cycleId: now.cycle.id }, 201);
  })
  .patch("/commitments/:id", json(changeCommitment), async (c) => {
    const { db, mine, userId } = c.var;
    const { everyCycle, recurringId, ...b } = c.req.valid("json");
    const id = c.req.param("id");
    const now = await current(c);
    const old = await db.query.commitment.findFirst({ where: and(mine(commitment), eq(commitment.id, id)) });
    if (!now || !old) return c.json({ error: "not_found" as const }, 404);
    if (old.cycleId !== now.cycle.id) return c.json({ error: "locked" as const }, 409);
    // Only a bill and a savings set-aside can be switched into each other.
    if (b.kind && old.kind !== "bill" && old.kind !== "savings") {
      return c.json({ error: "invalid" as const, problems: ["kind"] }, 400);
    }
    const next = { ...old, ...b };
    // A carried one keeps its due day from last cycle (shown as late, item 12) until it is moved.
    const keptDue = next.dueOn === old.dueOn && old.dueOn < now.cycle.startedOn;
    const problems = checkCommitment(next, {
      cycleStartedOn: keptDue ? old.dueOn : now.cycle.startedOn,
      ...now.currencies,
    });
    if (problems.length) return c.json({ error: "invalid" as const, problems }, 400);
    const linked = old.recurringId
      ? await db.query.recurringCommitment.findFirst({
          where: and(mine(recurringCommitment), eq(recurringCommitment.id, old.recurringId)),
          columns: { id: true },
        })
      : undefined;
    const repeat = everyCycle ?? linked !== undefined;
    const newTemplate = repeat && !linked;
    if (newTemplate && !recurringId) return c.json({ error: "bad_request" as const }, 400);
    if (repeat && !repeats(next.kind)) return c.json({ error: "invalid" as const, problems: ["kind"] }, 400);
    const fields = templateOf({ ...next, kind: next.kind as RepeatKind });
    const update = db
      .update(commitment)
      .set({
        name: next.name,
        kind: next.kind,
        plannedMinor: next.plannedMinor,
        dueOn: next.dueOn,
        state: next.state,
        recurringId: repeat ? (linked?.id ?? recurringId) : null,
      })
      .where(and(mine(commitment), eq(commitment.id, id)));
    const template = linked
      ? and(mine(recurringCommitment), eq(recurringCommitment.id, linked.id))
      : undefined;
    try {
      if (newTemplate) {
        await db.batch([
          db.insert(recurringCommitment).values({
            id: recurringId as string,
            userId,
            currency: next.currency,
            ...fields,
          }),
          update,
        ]);
      } else if (linked && repeat) {
        await db.batch([db.update(recurringCommitment).set(fields).where(template), update]);
      } else if (linked) {
        await db.batch([db.delete(recurringCommitment).where(template), update]);
      } else {
        await update;
      }
    } catch {
      // The template id is already in use.
      return c.json({ error: "conflict" as const }, 409);
    }
    return c.json({ ok: true as const });
  })
  .delete("/commitments/:id", async (c) => {
    const { db, mine } = c.var;
    const id = c.req.param("id");
    const now = await current(c);
    const old = await db.query.commitment.findFirst({
      where: and(mine(commitment), eq(commitment.id, id)),
      columns: { cycleId: true, recurringId: true, kind: true },
    });
    if (!now || !old) return c.json({ error: "not_found" as const }, 404);
    if (old.cycleId !== now.cycle.id) return c.json({ error: "locked" as const }, 409);
    // A payback to savings belongs to its prepayment (item 14): mark it finished to skip a cycle.
    if (old.kind === "savings_payback") return c.json({ error: "linked" as const }, 409);
    const remove = db.delete(commitment).where(and(mine(commitment), eq(commitment.id, id)));
    if (old.recurringId) {
      // Deleting an "Every cycle" commitment stops it repeating.
      await db.batch([
        db
          .delete(recurringCommitment)
          .where(and(mine(recurringCommitment), eq(recurringCommitment.id, old.recurringId))),
        remove,
      ]);
    } else {
      await remove;
    }
    return c.json({ ok: true as const });
  });
