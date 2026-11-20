import { and, eq } from "drizzle-orm";
import { Hono } from "hono";
import { validator } from "hono/validator";
import * as z from "zod";
import { checkPlace, isPlaceBalance, PLACES_MAX } from "../money";
import { current } from "./current";
import { place, placeCheck } from "./db/schema";
import { json } from "./json";
import type { SignedIn } from "./user-check";

const name = z.string().transform((n) => n.trim());

const newPlace = z.object({
  id: z.uuid(),
  name,
  /** Either of the user's currencies (spec 8); none: the spending currency. Fixed once made. */
  currency: z.string().optional(),
  /** `spending` (none given) or `kept`. */
  kind: z.string().optional(),
  /** The balance typed with it, as its first check. */
  balance: z.object({ id: z.uuid(), amountMinor: z.number() }).optional(),
});

const changePlace = z
  .object({
    name,
    kind: z.string(),
    /** "Stop using this place", or use it again. */
    archived: z.boolean(),
  })
  .partial();

const newCheck = z.object({ id: z.uuid(), amountMinor: z.number() });

/** The whole list, in its new order. */
const newOrder = z.object({ ids: z.array(z.uuid()).max(PLACES_MAX) });

/**
 * Places (ticket SAB-50, spec 6 "Where my money is"): add, rename, change kind,
 * reorder, stop using, delete, and Set balance (a new `place_check`; the newest
 * is the balance). Balances, Can spend and the difference are only ever worked
 * out on the phone (`placesView`); Today's one read brings the rows (`today-read.ts`).
 */
export const places = new Hono<SignedIn>()
  .post("/places", json(newPlace), async (c) => {
    const { db, userId, mine } = c.var;
    const b = c.req.valid("json");
    const now = await current(c);
    if (!now) return c.json({ error: "not_set_up" as const }, 404);
    const row = {
      id: b.id,
      name: b.name,
      currency: b.currency ?? now.settings.spendingCurrency,
      kind: b.kind ?? "spending",
    };
    const problems: string[] = checkPlace(row, now.currencies);
    if (b.balance && !isPlaceBalance(b.balance.amountMinor)) problems.push("balance");
    if (problems.length) return c.json({ error: "invalid" as const, problems }, 400);
    const others = await db.query.place.findMany({ where: mine(place), columns: { sortOrder: true } });
    if (others.length >= PLACES_MAX) return c.json({ error: "too_many" as const }, 409);
    const sortOrder = others.reduce((max, p) => Math.max(max, p.sortOrder + 1), 0);
    try {
      const add = db
        .insert(place)
        .values({ ...row, kind: row.kind as "spending" | "kept", sortOrder, userId });
      if (b.balance) {
        await db.batch([
          add,
          db.insert(placeCheck).values({
            id: b.balance.id,
            userId,
            placeId: b.id,
            amountMinor: b.balance.amountMinor,
            checkedAt: new Date(),
          }),
        ]);
      } else await add;
    } catch {
      // An id is already in use.
      return c.json({ error: "conflict" as const }, 409);
    }
    return c.json({ ok: true as const }, 201);
  })
  /** The list's order: every place of the user, once, in the order wanted. */
  .put("/places/order", json(newOrder), async (c) => {
    const { db, mine } = c.var;
    const { ids } = c.req.valid("json");
    const mineNow = await db.query.place.findMany({ where: mine(place), columns: { id: true } });
    const known = new Set(mineNow.map((p) => p.id));
    if (ids.length !== known.size || new Set(ids).size !== ids.length || ids.some((id) => !known.has(id))) {
      return c.json({ error: "invalid" as const }, 400);
    }
    const [first, ...rest] = ids.map((id, i) =>
      db
        .update(place)
        .set({ sortOrder: i })
        .where(and(mine(place), eq(place.id, id))),
    );
    if (first) await db.batch([first, ...rest]);
    return c.json({ ok: true as const });
  })
  .patch("/places/:id", json(changePlace), async (c) => {
    const { db, mine } = c.var;
    const b = c.req.valid("json");
    const id = c.req.param("id");
    const now = await current(c);
    const old = await db.query.place.findFirst({ where: and(mine(place), eq(place.id, id)) });
    if (!now || !old) return c.json({ error: "not_found" as const }, 404);
    const next = { ...old, ...b };
    const problems = checkPlace(next, now.currencies);
    if (problems.length) return c.json({ error: "invalid" as const, problems }, 400);
    await db
      .update(place)
      .set({ name: next.name, kind: next.kind as "spending" | "kept", archived: next.archived })
      .where(and(mine(place), eq(place.id, id)));
    return c.json({ ok: true as const });
  })
  /**
   * Delete: a place with no balance typed goes at once; one with balances only
   * with `?balances=delete` (the phone asks first), and they go with it.
   */
  .delete(
    "/places/:id",
    validator("query", (q) => ({ balances: q.balances })),
    async (c) => {
      const { db, mine } = c.var;
      const id = c.req.param("id");
      const old = await db.query.place.findFirst({
        where: and(mine(place), eq(place.id, id)),
        columns: { id: true },
      });
      if (!old) return c.json({ error: "not_found" as const }, 404);
      const checks = and(mine(placeCheck), eq(placeCheck.placeId, id));
      const has = await db.select({ id: placeCheck.id }).from(placeCheck).where(checks).limit(1);
      if (has.length && c.req.valid("query").balances !== "delete") {
        return c.json({ error: "has_balances" as const }, 409);
      }
      await db.batch([
        db.delete(placeCheck).where(checks),
        db.delete(place).where(and(mine(place), eq(place.id, id))),
      ]);
      return c.json({ ok: true as const });
    },
  )
  /** Set balance: what the place holds now, as typed. */
  .post("/places/:id/checks", json(newCheck), async (c) => {
    const { db, mine, userId } = c.var;
    const b = c.req.valid("json");
    const id = c.req.param("id");
    const old = await db.query.place.findFirst({
      where: and(mine(place), eq(place.id, id)),
      columns: { id: true },
    });
    if (!old) return c.json({ error: "not_found" as const }, 404);
    if (!isPlaceBalance(b.amountMinor)) {
      return c.json({ error: "invalid" as const, problems: ["balance" as const] }, 400);
    }
    try {
      await db
        .insert(placeCheck)
        .values({ id: b.id, userId, placeId: id, amountMinor: b.amountMinor, checkedAt: new Date() });
    } catch {
      // The id is already in use.
      return c.json({ error: "conflict" as const }, 409);
    }
    return c.json({ ok: true as const }, 201);
  })
  /** Undo of Set balance: the balance typed before it counts again. */
  .delete("/places/:id/checks/:checkId", async (c) => {
    const { db, mine } = c.var;
    const row = and(
      mine(placeCheck),
      eq(placeCheck.placeId, c.req.param("id")),
      eq(placeCheck.id, c.req.param("checkId")),
    );
    const old = await db.select({ id: placeCheck.id }).from(placeCheck).where(row).limit(1);
    if (!old.length) return c.json({ error: "not_found" as const }, 404);
    await db.delete(placeCheck).where(row);
    return c.json({ ok: true as const });
  });
