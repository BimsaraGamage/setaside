import { and, eq } from "drizzle-orm";
import { Hono } from "hono";
import * as z from "zod";
import { checkSpend, moveIntoCycle } from "../money";
import { spend } from "./db/schema";
import { json } from "./json";
import { bool } from "./today-read";
import type { SignedIn } from "./user-check";
import { readForWrite } from "./write-read";

const note = z
  .string()
  .nullish()
  .transform((n) => n?.trim() || null);

/** The pot it comes from (item 7); null means free money. */
const potId = z.uuid().nullish();

/** The card it was paid with (item 18); null means cash. */
const cardId = z.uuid().nullish();

const newSpend = z.object({
  id: z.uuid(),
  spentOn: z.string(),
  amountMinor: z.number().int(),
  note,
  potId,
  cardId,
  /** Left out of the spending speed (item 8). */
  oneOff: z.boolean().optional(),
  /** Sent from the phone's unsent queue (item 24): a spend from an ended cycle moves into this one. */
  queued: z.boolean().optional(),
});

const changeSpend = z
  .object({ spentOn: z.string(), amountMinor: z.number().int(), note, potId, cardId, oneOff: z.boolean() })
  .partial();

/** A pot or card as `checkSpend` needs it (0/1 `archived` as stored). */
interface Holder {
  id: string;
  currency: string;
  archived: number;
}

/**
 * The signed-in user's pot or card `?2` and, on a change, the one spend `?3` has now
 * (null ids match none).
 */
const HOLDERS = (table: "pot" | "card", also = "?3") =>
  `select id, currency, archived from ${table} where user_id = ?1 and id in (?2, ${also})`;
const HOLDERS_OF_SPEND = (table: "pot" | "card") =>
  HOLDERS(table, `(select ${table}_id from spend where user_id = ?1 and id = ?3)`);

/** The signed-in user's spend with this id. */
const SPEND = `select id, cycle_id as cycleId, spent_on as spentOn, amount_minor as amountMinor, currency, note,
    pot_id as potId, card_id as cardId, one_off as oneOff
  from spend where user_id = ?1 and id = ?2`;

interface SpendRow {
  id: string;
  cycleId: string;
  spentOn: string;
  amountMinor: number;
  currency: string;
  note: string | null;
  potId: string | null;
  cardId: string | null;
  oneOff: number;
}

/** The holder with this id, as the one-item list `checkSpend` takes; none when there is no such one. */
function only(rows: Holder[], id: string | null | undefined) {
  const found = id ? rows.find((r) => r.id === id) : undefined;
  return found ? [{ id: found.id, currency: found.currency, archived: bool(found.archived) }] : [];
}

/**
 * Spends (backlog items 4, 7 and 8, spec 4, 7 and 10): add, change and delete, in
 * the current cycle only (ended cycles are locked), from free money or a pot in
 * use, marked one-off or not. The phone works out every number.
 */
export const spends = new Hono<SignedIn>()
  .post("/spends", json(newSpend), async (c) => {
    const { db, userId } = c.var;
    const { queued, ...b } = c.req.valid("json");
    // One D1 batch for every read (SAB-45).
    const { now, saved, pots, cards } = await readForWrite<{
      saved: SpendRow[];
      pots: Holder[];
      cards: Holder[];
    }>(c, {
      saved: [SPEND, b.id],
      pots: [HOLDERS("pot"), b.potId ?? null, null],
      cards: [HOLDERS("card"), b.cardId ?? null, null],
    });
    // Saved once (item 24, spec 11): a resend of this user's spend is answered as saved, whatever its cycle now.
    if (saved[0])
      return c.json({ ok: true as const, cycleId: saved[0].cycleId, already: true as const }, 200);
    if (!now) return c.json({ error: "not_set_up" as const }, 404);
    const inPot = only(pots, b.potId);
    const moved = queued
      ? moveIntoCycle(b.spentOn, now.cycle.startedOn)
      : { spentOn: b.spentOn, movedFrom: null };
    const row = {
      ...b,
      spentOn: moved.spentOn,
      potId: b.potId ?? null,
      cardId: b.cardId ?? null,
      oneOff: b.oneOff ?? false,
      // A spend is in its pot's currency (a salary-currency pot's, spec 8), else the spending currency.
      currency: inPot[0]?.currency ?? now.settings.spendingCurrency,
    };
    const problems = checkSpend(row, {
      today: now.today,
      cycleStartedOn: now.cycle.startedOn,
      ...now.currencies,
      pots: inPot,
      cards: only(cards, row.cardId),
    });
    if (problems.length) return c.json({ error: "invalid" as const, problems }, 400);
    try {
      await db.insert(spend).values({ ...row, userId, cycleId: now.cycle.id });
    } catch {
      // The id is already in use.
      return c.json({ error: "conflict" as const }, 409);
    }
    return c.json(
      {
        ok: true as const,
        cycleId: now.cycle.id,
        ...(moved.movedFrom ? { movedFrom: moved.movedFrom } : {}),
      },
      201,
    );
  })
  .patch("/spends/:id", json(changeSpend), async (c) => {
    const { db, mine } = c.var;
    const b = c.req.valid("json");
    const id = c.req.param("id");
    // One D1 batch for every read (SAB-45): the pot and card it moves to and the ones it has now.
    const { now, found, pots, cards } = await readForWrite<{
      found: SpendRow[];
      pots: Holder[];
      cards: Holder[];
    }>(c, {
      found: [SPEND, id],
      pots: [HOLDERS_OF_SPEND("pot"), b.potId ?? null, id],
      cards: [HOLDERS_OF_SPEND("card"), b.cardId ?? null, id],
    });
    const row = found[0];
    if (!now || !row) return c.json({ error: "not_found" as const }, 404);
    if (row.cycleId !== now.cycle.id) return c.json({ error: "locked" as const }, 409);
    const old = { ...row, oneOff: bool(row.oneOff) };
    const nextPotId = b.potId === undefined ? old.potId : b.potId;
    const inPot = only(pots, nextPotId);
    const nextCardId = b.cardId === undefined ? old.cardId : b.cardId;
    const next = {
      ...old,
      ...b,
      potId: nextPotId,
      cardId: nextCardId,
      currency: inPot[0]?.currency ?? now.settings.spendingCurrency,
    };
    const problems = checkSpend(next, {
      today: now.today,
      cycleStartedOn: now.cycle.startedOn,
      ...now.currencies,
      pots: inPot,
      keepPotId: old.potId,
      cards: only(cards, nextCardId),
      keepCardId: old.cardId,
    });
    if (problems.length) return c.json({ error: "invalid" as const, problems }, 400);
    await db
      .update(spend)
      .set({
        spentOn: next.spentOn,
        amountMinor: next.amountMinor,
        currency: next.currency,
        note: next.note,
        potId: next.potId,
        cardId: next.cardId,
        oneOff: next.oneOff,
      })
      .where(and(mine(spend), eq(spend.id, id)));
    return c.json({ ok: true as const });
  })
  .delete("/spends/:id", async (c) => {
    const { db, mine } = c.var;
    const id = c.req.param("id");
    const { now, found } = await readForWrite<{ found: SpendRow[] }>(c, { found: [SPEND, id] });
    const old = found[0];
    if (!now || !old) return c.json({ error: "not_found" as const }, 404);
    if (old.cycleId !== now.cycle.id) return c.json({ error: "locked" as const }, 409);
    await db.delete(spend).where(and(mine(spend), eq(spend.id, id)));
    return c.json({ ok: true as const });
  });
