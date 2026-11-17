import { and, eq, ne, sql } from "drizzle-orm";
import { Hono } from "hono";
import * as z from "zod";
import { checkCard } from "../money";
import { current } from "./current";
import { card, commitment, commitmentPayment, recurringCommitment, spend } from "./db/schema";
import { json } from "./json";
import type { SignedIn } from "./user-check";

const name = z.string().transform((n) => n.trim());

const newCard = z.object({
  id: z.uuid(),
  name,
  /** Either of the user's currencies (spec 8); none: the spending currency. Fixed once made. */
  currency: z.string().optional(),
});

const changeCard = z
  .object({
    name,
    /** "Stop using this card", or use it again. */
    archived: z.boolean(),
  })
  .partial();

/**
 * The user's cards, each with what it owed at the end of the cycles before
 * `cycleId` (spec 9): card spends less payments on its card bills there. The
 * phone adds the current cycle's own rows, so its balance moves at once.
 */
export async function cardLines(c: { var: SignedIn["Variables"] }, cycleId: string) {
  const { db, mine } = c.var;
  const cards = await db.query.card.findMany({
    where: mine(card),
    columns: { id: true, name: true, currency: true, archived: true },
    orderBy: [card.createdAt, card.id],
  });
  if (cards.length === 0) return [];
  const spent = await db
    .select({ cardId: spend.cardId, total: sql<number>`sum(${spend.amountMinor})` })
    .from(spend)
    .where(and(mine(spend), ne(spend.cycleId, cycleId), sql`${spend.cardId} is not null`))
    .groupBy(spend.cardId);
  // A card bill is paid in its own currency (item 18); another currency counts what it covers.
  const paid = await db
    .select({
      cardId: commitment.cardId,
      total: sql<number>`sum(case when ${commitmentPayment.currency} = ${commitment.currency} then ${commitmentPayment.amountMinor} else coalesce(${commitmentPayment.coversMinor}, 0) end)`,
    })
    .from(commitmentPayment)
    .innerJoin(commitment, eq(commitment.id, commitmentPayment.commitmentId))
    .where(
      and(
        mine(commitmentPayment),
        eq(commitment.kind, "card_bill"),
        ne(commitment.cycleId, cycleId),
        sql`${commitment.cardId} is not null`,
      ),
    )
    .groupBy(commitment.cardId);
  return cardLinesOf(cards, spent, paid);
}

/** What one card spent or had paid before the cycle, per card. */
export type CardTotal = { cardId: string | null; total: number };

/** Card lines from the cards and their totals before the cycle (also Today's one batch, `today-read.ts`). */
export function cardLinesOf(
  cards: { id: string; name: string; currency: string; archived: boolean }[],
  spent: CardTotal[],
  paid: CardTotal[],
) {
  const sum = (rows: CardTotal[], id: string) => Number(rows.find((r) => r.cardId === id)?.total ?? 0);
  return cards.map((k) => ({ ...k, earlierMinor: sum(spent, k.id) - sum(paid, k.id) }));
}

/**
 * Cards (backlog item 18, spec 9 and 10): add, rename, stop using, use again,
 * and delete while nothing uses it. A card's balance is only ever worked out
 * (`cardLines` and the money rules); card bills are commitments (commitments.ts).
 */
export const cards = new Hono<SignedIn>()
  .post("/cards", json(newCard), async (c) => {
    const { db, userId } = c.var;
    const b = c.req.valid("json");
    const now = await current(c);
    if (!now) return c.json({ error: "not_set_up" as const }, 404);
    const row = { ...b, currency: b.currency ?? now.settings.spendingCurrency };
    const problems = checkCard(row, now.currencies);
    if (problems.length) return c.json({ error: "invalid" as const, problems }, 400);
    try {
      await db.insert(card).values({ ...row, userId });
    } catch {
      // The id is already in use.
      return c.json({ error: "conflict" as const }, 409);
    }
    return c.json({ ok: true as const }, 201);
  })
  .patch("/cards/:id", json(changeCard), async (c) => {
    const { db, mine } = c.var;
    const b = c.req.valid("json");
    const id = c.req.param("id");
    const now = await current(c);
    const old = await db.query.card.findFirst({ where: and(mine(card), eq(card.id, id)) });
    if (!now || !old) return c.json({ error: "not_found" as const }, 404);
    const next = { ...old, ...b };
    const problems = checkCard(next, now.currencies);
    if (problems.length) return c.json({ error: "invalid" as const, problems }, 400);
    await db
      .update(card)
      .set({ name: next.name, archived: next.archived })
      .where(and(mine(card), eq(card.id, id)));
    return c.json({ ok: true as const });
  })
  .delete("/cards/:id", async (c) => {
    const { db, mine } = c.var;
    const id = c.req.param("id");
    const old = await db.query.card.findFirst({
      where: and(mine(card), eq(card.id, id)),
      columns: { id: true },
    });
    if (!old) return c.json({ error: "not_found" as const }, 404);
    // Its spends and bills would lose their card: stop using it instead.
    const [spends, bills, templates] = await db.batch([
      db
        .select({ id: spend.id })
        .from(spend)
        .where(and(mine(spend), eq(spend.cardId, id)))
        .limit(1),
      db
        .select({ id: commitment.id })
        .from(commitment)
        .where(and(mine(commitment), eq(commitment.cardId, id)))
        .limit(1),
      db
        .select({ id: recurringCommitment.id })
        .from(recurringCommitment)
        .where(and(mine(recurringCommitment), eq(recurringCommitment.cardId, id)))
        .limit(1),
    ]);
    if (spends.length || bills.length || templates.length) return c.json({ error: "in_use" as const }, 409);
    await db.delete(card).where(and(mine(card), eq(card.id, id)));
    return c.json({ ok: true as const });
  });
