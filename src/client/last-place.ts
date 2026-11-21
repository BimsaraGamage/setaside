import type { Place } from "./data";

/**
 * The place used last (tickets SAB-51 and SAB-52, spec 10): a sheet starts on it, so naming the place
 * costs no extra tap. Kept on this phone only, one choice per currency the user has places in, and apart
 * for money out (a spend, a payment) and money in (income, the salary): cash is spent from one place and
 * lands in another. "none" is remembered too: the user chose to move no place.
 *
 * Only place ids are stored, under a slot number: the currency's spot among the currencies of the user's
 * places, in a-z order. No currency code or amount is kept.
 */
const KEYS = { out: "setaside.lastPlace", in: "setaside.lastPlaceIn" } as const;
const NONE = "none";

/** Which way the money goes: out of the place, or into it. */
export type PlaceWay = keyof typeof KEYS;

function read(way: PlaceWay): string[] {
  try {
    const raw = localStorage.getItem(KEYS[way]);
    const all: unknown = raw ? JSON.parse(raw) : [];
    return Array.isArray(all) ? all.map((x) => (typeof x === "string" ? x : "")) : [];
  } catch {
    // Unreadable or blocked storage: nothing remembered.
    return [];
  }
}

/** The currency's slot: its spot among the currencies the places hold; -1 with no place in it. */
function slotOf(places: Place[], currency: string): number {
  const held = [...new Set(places.map((p) => p.currency))].sort();
  return held.findIndex((c) => c === currency);
}

/** The places an entry in `currency` can move: in use, in that currency. */
export function placesFor(places: Place[], currency: string, keepId?: string | null): Place[] {
  return places.filter((p) => p.currency === currency && (!p.archived || p.id === keepId));
}

/**
 * Where a new entry in `currency` starts: the place remembered for it while it is still in use; "no place"
 * when that was chosen last; with nothing remembered, the first For spending place in the list.
 */
export function lastPlace(places: Place[], currency: string, way: PlaceWay = "out"): string | null {
  const usable = placesFor(places, currency);
  const remembered = read(way)[slotOf(places, currency)];
  if (remembered === NONE && usable.length > 0) return null;
  if (remembered && usable.some((p) => p.id === remembered)) return remembered;
  return usable.find((p) => p.kind === "spending")?.id ?? null;
}

export function rememberPlace(
  places: Place[],
  currency: string,
  placeId: string | null,
  way: PlaceWay = "out",
): void {
  const slot = slotOf(places, currency);
  if (slot < 0) return;
  try {
    const all = read(way);
    while (all.length <= slot) all.push("");
    all[slot] = placeId ?? NONE;
    localStorage.setItem(KEYS[way], JSON.stringify(all));
  } catch {
    // Storage full or blocked: not remembered.
  }
}
