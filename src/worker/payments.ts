import { and, eq } from "drizzle-orm";
import { Hono } from "hono";
import * as z from "zod";
import { checkPayment, paymentCovers } from "../money";
import { countingRateOf, current } from "./current";
import { commitment, commitmentPayment } from "./db/schema";
import { json } from "./json";
import type { SignedIn } from "./user-check";

const newPayment = z.object({
  id: z.uuid(),
  amountMinor: z.number().int(),
  paidOn: z.string(),
  /** Either of the user's currencies (item 17); none: the commitment's own. */
  currency: z.string().optional(),
  /** Mark the commitment finished in the same write ("Pay and finish"). */
  finish: z.boolean().optional(),
});

const changePayment = z
  .object({ amountMinor: z.number().int(), paidOn: z.string(), currency: z.string() })
  .partial();

type Now = NonNullable<Awaited<ReturnType<typeof current>>>;

/**
 * The currency a commitment may also be paid in (spec 8): the user's other one,
 * except for a savings set-aside or payback, which moves money within one
 * savings total, and a card bill, which pays its card in the card's currency (item 18).
 */
function otherCurrencyFor(now: Now, owner: { currency: string; kind: string }): string | null {
  if (owner.kind === "savings" || owner.kind === "savings_payback" || owner.kind === "card_bill") return null;
  const { spendingCurrency, salaryCurrency } = now.currencies;
  if (!salaryCurrency) return null;
  return owner.currency === spendingCurrency ? salaryCurrency : spendingCurrency;
}

/** What a payment covers of its commitment, kept on the row when in the other currency. */
async function coversOf(
  c: { var: SignedIn["Variables"] },
  now: Now,
  row: { amountMinor: number; currency: string },
  commitmentCurrency: string,
): Promise<number | null> {
  if (row.currency === commitmentCurrency) return null;
  const countingRate = await countingRateOf(c);
  const rates = { spendingCurrency: now.currencies.spendingCurrency, countingRate };
  return paymentCovers(row.amountMinor, row.currency, commitmentCurrency, rates);
}

/**
 * Paying commitments (backlog item 6, spec 3): payments in full or in parts, in
 * the current cycle only (ended cycles are locked). Paid more or less than
 * planned is allowed; the phone works out every number from the payments.
 * Paid in the other currency (item 17): the row keeps what it covers of the
 * commitment at the counting rate when saved (`covers_minor`).
 */
export const payments = new Hono<SignedIn>()
  .post("/commitments/:id/payments", json(newPayment), async (c) => {
    const { db, mine, userId } = c.var;
    const { finish, ...b } = c.req.valid("json");
    const id = c.req.param("id");
    const now = await current(c);
    const owner = await db.query.commitment.findFirst({
      where: and(mine(commitment), eq(commitment.id, id)),
      columns: { cycleId: true, state: true, currency: true, kind: true },
    });
    if (!now || !owner) return c.json({ error: "not_found" as const }, 404);
    if (owner.cycleId !== now.cycle.id) return c.json({ error: "locked" as const }, 409);
    if (owner.state !== "open") return c.json({ error: "not_open" as const }, 409);
    const row = { ...b, currency: b.currency ?? owner.currency };
    const problems = checkPayment(row, {
      today: now.today,
      cycleStartedOn: now.cycle.startedOn,
      currency: owner.currency,
      otherCurrency: otherCurrencyFor(now, owner),
    });
    if (problems.length) return c.json({ error: "invalid" as const, problems }, 400);
    const coversMinor = await coversOf(c, now, row, owner.currency);
    const insert = db.insert(commitmentPayment).values({ ...row, coversMinor, userId, commitmentId: id });
    try {
      if (finish) {
        await db.batch([
          insert,
          db
            .update(commitment)
            .set({ state: "finished" })
            .where(and(mine(commitment), eq(commitment.id, id))),
        ]);
      } else {
        await insert;
      }
    } catch {
      // The id is already in use.
      return c.json({ error: "conflict" as const }, 409);
    }
    return c.json({ ok: true as const }, 201);
  })
  .patch("/payments/:id", json(changePayment), async (c) => {
    const { db, mine } = c.var;
    const b = c.req.valid("json");
    const id = c.req.param("id");
    const now = await current(c);
    const old = await db.query.commitmentPayment.findFirst({
      where: and(mine(commitmentPayment), eq(commitmentPayment.id, id)),
    });
    const owner = old
      ? await db.query.commitment.findFirst({
          where: and(mine(commitment), eq(commitment.id, old.commitmentId)),
          columns: { cycleId: true, currency: true, kind: true },
        })
      : undefined;
    if (!now || !old || !owner) return c.json({ error: "not_found" as const }, 404);
    if (owner.cycleId !== now.cycle.id) return c.json({ error: "locked" as const }, 409);
    const next = { ...old, ...b };
    const problems = checkPayment(next, {
      today: now.today,
      cycleStartedOn: now.cycle.startedOn,
      currency: owner.currency,
      // A payment already in the other currency keeps it, even on a kind that can't take one now.
      otherCurrency: old.currency !== owner.currency ? old.currency : otherCurrencyFor(now, owner),
    });
    if (problems.length) return c.json({ error: "invalid" as const, problems }, 400);
    // Covers again at today's counting rate only when the amount or currency changed.
    const same = next.amountMinor === old.amountMinor && next.currency === old.currency;
    const coversMinor = same ? old.coversMinor : await coversOf(c, now, next, owner.currency);
    await db
      .update(commitmentPayment)
      .set({ amountMinor: next.amountMinor, paidOn: next.paidOn, currency: next.currency, coversMinor })
      .where(and(mine(commitmentPayment), eq(commitmentPayment.id, id)));
    return c.json({ ok: true as const });
  })
  .delete("/payments/:id", async (c) => {
    const { db, mine } = c.var;
    const id = c.req.param("id");
    const now = await current(c);
    const old = await db.query.commitmentPayment.findFirst({
      where: and(mine(commitmentPayment), eq(commitmentPayment.id, id)),
      columns: { commitmentId: true },
    });
    const owner = old
      ? await db.query.commitment.findFirst({
          where: and(mine(commitment), eq(commitment.id, old.commitmentId)),
          columns: { cycleId: true, currency: true },
        })
      : undefined;
    if (!now || !old || !owner) return c.json({ error: "not_found" as const }, 404);
    if (owner.cycleId !== now.cycle.id) return c.json({ error: "locked" as const }, 409);
    await db.delete(commitmentPayment).where(and(mine(commitmentPayment), eq(commitmentPayment.id, id)));
    return c.json({ ok: true as const });
  });
