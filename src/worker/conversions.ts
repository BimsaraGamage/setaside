import { and, desc, eq } from "drizzle-orm";
import { Hono } from "hono";
import * as z from "zod";
import { checkConversion, conversionSplit } from "../money";
import { current } from "./current";
import { conversion, countingRate } from "./db/schema";
import { json } from "./json";
import { placeId, placesUsable } from "./place-use";
import { entriesOf } from "./salary-day";
import type { SignedIn } from "./user-check";

const newConversion = z.object({
  id: z.uuid(),
  givenMinor: z.number().int(),
  receivedMinor: z.number().int(),
  doneOn: z.string(),
  /** The place the dollars came out of and the one the rupees went into (SAB-52); null moves no place. */
  fromPlaceId: placeId,
  toPlaceId: placeId,
});

/** One line of "This cycle's conversions" (spec 10), newest first. */
export async function conversionLines(c: { var: SignedIn["Variables"] }, cycleId: string) {
  const { db, mine } = c.var;
  return db.query.conversion.findMany({
    where: and(mine(conversion), eq(conversion.cycleId, cycleId)),
    columns: {
      id: true,
      givenMinor: true,
      receivedMinor: true,
      rate: true,
      coveredMinor: true,
      gainMinor: true,
      doneOn: true,
    },
    orderBy: [desc(conversion.doneOn), desc(conversion.createdAt)],
  });
}

/**
 * Change dollars (backlog item 16, spec 8): a conversion of the current cycle,
 * dollars given and rupees received. Bills first and the rate gain or loss are
 * worked out here with the money rules from the cycle's rows and kept with it;
 * its rate becomes the counting rate (a `counting_rate` row with the same id).
 * Delete is the toast's Undo, current cycle only.
 */
export const conversions = new Hono<SignedIn>()
  .post("/conversions", json(newConversion), async (c) => {
    const { db, userId } = c.var;
    const b = c.req.valid("json");
    const now = await current(c);
    if (!now) return c.json({ error: "not_set_up" as const }, 404);
    const problems = checkConversion(b, {
      ...now.currencies,
      cycleStartedOn: now.cycle.startedOn,
      today: now.today,
    });
    if (problems.includes("currency")) return c.json({ error: "one_currency" as const }, 409);
    if (problems.length) return c.json({ error: "invalid" as const, problems }, 400);
    const places = [
      // Two currencies here (checked above): dollars are the salary currency's.
      { placeId: b.fromPlaceId, currency: now.settings.salaryCurrency },
      { placeId: b.toPlaceId, currency: now.settings.spendingCurrency },
    ];
    if (!(await placesUsable(c, places))) {
      return c.json({ error: "invalid" as const, problems: ["place"] }, 400);
    }
    const split = conversionSplit(await entriesOf(c), b.givenMinor, b.receivedMinor);
    if (!split.rate) return c.json({ error: "invalid" as const, problems: ["rate"] }, 400);
    const at = new Date();
    try {
      await db.batch([
        db.insert(conversion).values({
          ...b,
          fromPlaceId: b.fromPlaceId ?? null,
          toPlaceId: b.toPlaceId ?? null,
          userId,
          cycleId: now.cycle.id,
          rate: split.rate,
          coveredMinor: split.coveredMinor,
          gainMinor: split.gainMinor,
          createdAt: at,
          updatedAt: at,
        }),
        db.insert(countingRate).values({ id: b.id, userId, rate: split.rate, setAt: at }),
      ]);
    } catch {
      // The id is already in use.
      return c.json({ error: "conflict" as const }, 409);
    }
    return c.json({ ok: true as const, ...split }, 201);
  })
  .delete("/conversions/:id", async (c) => {
    const { db, mine } = c.var;
    const id = c.req.param("id");
    const now = await current(c);
    const old = await db.query.conversion.findFirst({
      where: and(mine(conversion), eq(conversion.id, id)),
      columns: { cycleId: true },
    });
    if (!now || !old) return c.json({ error: "not_found" as const }, 404);
    if (old.cycleId !== now.cycle.id) return c.json({ error: "locked" as const }, 409);
    await db.batch([
      db.delete(conversion).where(and(mine(conversion), eq(conversion.id, id))),
      db.delete(countingRate).where(and(mine(countingRate), eq(countingRate.id, id))),
    ]);
    return c.json({ ok: true as const });
  });
