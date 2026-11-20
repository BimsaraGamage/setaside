import type { Place } from "./data";

/**
 * The place last paid from (ticket SAB-51, spec 10): the spend sheet and Pay start on it, so naming the
 * place costs no extra tap. Kept on this phone only, one choice per currency the user has places in.
 * "none" is remembered too: the user chose to move no place.
 *
 * Only place ids are stored, under a slot number: the currency's spot among the currencies of the user's
 * places, in a-z order. No currency code or amount is kept.
 */
const KEY = "setaside.lastPlace";
const NONE = "none";

function read(): string[] {
  try {
    const raw = localStorage.getItem(KEY);
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

/** The places an entry in `currency` can come out of: in use, in that currency. */
export function placesFor(places: Place[], currency: string, keepId?: string | null): Place[] {
  return places.filter((p) => p.currency === currency && (!p.archived || p.id === keepId));
}

/**
 * Where a new entry in `currency` starts: the place remembered for it while it is still in use; "no place"
 * when that was chosen last; with nothing remembered, the first For spending place in the list.
 */
export function lastPlace(places: Place[], currency: string): string | null {
  const usable = placesFor(places, currency);
  const remembered = read()[slotOf(places, currency)];
  if (remembered === NONE && usable.length > 0) return null;
  if (remembered && usable.some((p) => p.id === remembered)) return remembered;
  return usable.find((p) => p.kind === "spending")?.id ?? null;
}

export function rememberPlace(places: Place[], currency: string, placeId: string | null): void {
  const slot = slotOf(places, currency);
  if (slot < 0) return;
  try {
    const all = read();
    while (all.length <= slot) all.push("");
    all[slot] = placeId ?? NONE;
    localStorage.setItem(KEY, JSON.stringify(all));
  } catch {
    // Storage full or blocked: not remembered.
  }
}
