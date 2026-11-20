import { and, eq } from "drizzle-orm";
import { Hono } from "hono";
import * as z from "zod";
import { checkPayment, paymentCovers, staysInPlaces } from "../money";
import { commitment, commitmentPayment } from "./db/schema";
import { json } from "./json";
import { bool } from "./today-read";
import type { SignedIn } from "./user-check";
import { readForWrite, type WriteNow } from "./write-read";

const newPayment = z.object({
  id: z.uuid(),
  amountMinor: z.number().int(),
  paidOn: z.string(),
  /** Either of the user's currencies (item 17); none: the commitment's own. */
  currency: z.string().optional(),
  /** The place the money came out of (SAB-51), in the currency paid in; null moves no place. */
  placeId: z.uuid().nullish(),
  /** Mark the commitment finished in the same write ("Pay and finish"). */
  finish: z.boolean().optional(),
});

const changePayment = z
  .object({
    amountMinor: z.number().int(),
    paidOn: z.string(),
    currency: z.string(),
    placeId: z.uuid().nullable(),
  })
  .partial();

type Now = WriteNow;

/** The signed-in user's payment with this id. */
const PAYMENT = `select id, commitment_id as commitmentId, amount_minor as amountMinor, currency,
    covers_minor as coversMinor, paid_on as paidOn, place_id as placeId
  from commitment_payment where user_id = ?1 and id = ?2`;

/** The signed-in user's place `?2` and, on a change, the one payment `?3` has now (null ids match none). */
const PLACES = `select id, currency, archived from place where user_id = ?1
  and id in (?2, (select place_id from commitment_payment where user_id = ?1 and id = ?3))`;

interface PlaceRow {
  id: string;
  currency: string;
  archived: number;
}

const placesOf = (rows: PlaceRow[]) => rows.map((p) => ({ ...p, archived: bool(p.archived) }));

/** The signed-in user's commitment with this id. */
const OWNER = `select cycle_id as cycleId, state, currency, kind from commitment where user_id = ?1 and id = ?2`;

/** The commitment of the signed-in user's payment `?2`. */
const OWNER_OF_PAYMENT = `select k.cycle_id as cycleId, k.state, k.currency, k.kind
  from commitment k join commitment_payment cp on cp.commitment_id = k.id
  where k.user_id = ?1 and cp.user_id = ?1 and cp.id = ?2`;

interface PaymentRow {
  id: string;
  commitmentId: string;
  amountMinor: number;
  currency: string;
  coversMinor: number | null;
  paidOn: string;
  placeId: string | null;
}

interface OwnerRow {
  cycleId: string;
  state: string;
  currency: string;
  kind: string;
}

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
function coversOf(
  now: Now,
  row: { amountMinor: number; currency: string },
  commitmentCurrency: string,
): number | null {
  if (row.currency === commitmentCurrency) return null;
  const rates = { spendingCurrency: now.currencies.spendingCurrency, countingRate: now.countingRate };
  return paymentCovers(row.amountMinor, row.currency, commitmentCurrency, rates);
}

/**
 * Paying commitments (backlog item 6, spec 3): payments in full or in parts, in
 * the current cycle only (ended cycles are locked). Paid more or less than
 * planned is allowed; the phone works out every number from the payments.
 * Paid in the other currency (item 17): the row keeps what it covers of the
 * commitment at the counting rate when saved (`covers_minor`).
 * A payment may name the place its money came out of (SAB-51), in the currency
 * paid in; a savings set-aside moved to savings takes none.
 */
export const payments = new Hono<SignedIn>()
  .post("/commitments/:id/payments", json(newPayment), async (c) => {
    const { db, mine, userId } = c.var;
    const { finish, ...b } = c.req.valid("json");
    const id = c.req.param("id");
    // Saved once (item 24, spec 11): a resend of this payment is answered as saved, even if its commitment
    // was finished by it (pay and finish) or its cycle has ended since.
    // One D1 batch for every read (SAB-45).
    const { now, ...r } = await readForWrite<{
      saved: PaymentRow[];
      owners: OwnerRow[];
      places: PlaceRow[];
    }>(c, {
      saved: [PAYMENT, b.id],
      owners: [OWNER, id],
      places: [PLACES, b.placeId ?? null, null],
    });
    const saved = r.saved[0];
    if (saved?.commitmentId === id) return c.json({ ok: true as const, already: true as const }, 200);
    if (saved) return c.json({ error: "conflict" as const }, 409);
    const owner = r.owners[0];
    if (!now || !owner) return c.json({ error: "not_found" as const }, 404);
    if (owner.cycleId !== now.cycle.id) return c.json({ error: "locked" as const }, 409);
    if (owner.state !== "open") return c.json({ error: "not_open" as const }, 409);
    const row = { ...b, currency: b.currency ?? owner.currency, placeId: b.placeId ?? null };
    const problems = checkPayment(row, {
      today: now.today,
      cycleStartedOn: now.cycle.startedOn,
      currency: owner.currency,
      otherCurrency: otherCurrencyFor(now, owner),
      places: placesOf(r.places),
      noPlace: staysInPlaces(owner.kind),
    });
    if (problems.length) return c.json({ error: "invalid" as const, problems }, 400);
    const coversMinor = coversOf(now, row, owner.currency);
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
    const { now, ...r } = await readForWrite<{
      found: PaymentRow[];
      owners: OwnerRow[];
      places: PlaceRow[];
    }>(c, {
      found: [PAYMENT, id],
      owners: [OWNER_OF_PAYMENT, id],
      places: [PLACES, b.placeId ?? null, id],
    });
    const old = r.found[0];
    const owner = r.owners[0];
    if (!now || !old || !owner) return c.json({ error: "not_found" as const }, 404);
    if (owner.cycleId !== now.cycle.id) return c.json({ error: "locked" as const }, 409);
    const next = { ...old, ...b };
    const problems = checkPayment(next, {
      today: now.today,
      cycleStartedOn: now.cycle.startedOn,
      currency: owner.currency,
      // A payment already in the other currency keeps it, even on a kind that can't take one now.
      otherCurrency: old.currency !== owner.currency ? old.currency : otherCurrencyFor(now, owner),
      places: placesOf(r.places),
      keepPlaceId: old.placeId,
      noPlace: staysInPlaces(owner.kind),
    });
    if (problems.length) return c.json({ error: "invalid" as const, problems }, 400);
    // Covers again at today's counting rate only when the amount or currency changed.
    const same = next.amountMinor === old.amountMinor && next.currency === old.currency;
    const coversMinor = same ? old.coversMinor : coversOf(now, next, owner.currency);
    await db
      .update(commitmentPayment)
      .set({
        amountMinor: next.amountMinor,
        paidOn: next.paidOn,
        currency: next.currency,
        coversMinor,
        placeId: next.placeId,
      })
      .where(and(mine(commitmentPayment), eq(commitmentPayment.id, id)));
    return c.json({ ok: true as const });
  })
  .delete("/payments/:id", async (c) => {
    const { db, mine } = c.var;
    const id = c.req.param("id");
    const { now, owners } = await readForWrite<{ owners: OwnerRow[] }>(c, { owners: [OWNER_OF_PAYMENT, id] });
    const owner = owners[0];
    if (!now || !owner) return c.json({ error: "not_found" as const }, 404);
    if (owner.cycleId !== now.cycle.id) return c.json({ error: "locked" as const }, 409);
    await db.delete(commitmentPayment).where(and(mine(commitmentPayment), eq(commitmentPayment.id, id)));
    return c.json({ ok: true as const });
  });
