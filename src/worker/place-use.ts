import { and, inArray } from "drizzle-orm";
import * as z from "zod";
import { placeUsable } from "../money";
import { place } from "./db/schema";
import type { SignedIn } from "./user-check";

/** The place an entry moves (SAB-52, spec 6), as a write sends it; null or none moves no place. */
export const placeId = z.uuid().nullish();

/** A place an entry names, with the currency of the money it moves. */
export interface PlaceUse {
  placeId?: string | null;
  currency: string;
}

/**
 * Can every entry move the place it names (SAB-52, spec 6)? Each place is the
 * signed-in user's, in use, and holds the entry's currency (`placeUsable`).
 * No place named: nothing is read.
 */
export async function placesUsable(c: { var: SignedIn["Variables"] }, uses: PlaceUse[]): Promise<boolean> {
  const { db, mine } = c.var;
  const ids = [...new Set(uses.flatMap((u) => (u.placeId ? [u.placeId] : [])))];
  if (ids.length === 0) return true;
  const rows = await db.query.place.findMany({
    where: and(mine(place), inArray(place.id, ids)),
    columns: { id: true, currency: true, archived: true },
  });
  return uses.every((u) => !u.placeId || placeUsable(u.placeId, u.currency, rows));
}
