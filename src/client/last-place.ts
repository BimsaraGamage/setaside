import type { Place } from "./data";

/**
 * The place last paid from, per currency (ticket SAB-51, spec 10): the spend sheet and Pay start on it, so
 * naming the place costs no extra tap. Kept on this phone only. "none" is remembered too: the user chose to
 * move no place.
 */
const KEY = "setaside.lastPlace";
const NONE = "none";

function read(): Record<string, string> {
  try {
    const raw = localStorage.getItem(KEY);
    const all: unknown = raw ? JSON.parse(raw) : {};
    return all && typeof all === "object" ? (all as Record<string, string>) : {};
  } catch {
    // Unreadable or blocked storage: nothing remembered.
    return {};
  }
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
  const remembered = read()[currency];
  if (remembered === NONE) return null;
  if (remembered && usable.some((p) => p.id === remembered)) return remembered;
  return usable.find((p) => p.kind === "spending")?.id ?? null;
}

export function rememberPlace(currency: string, placeId: string | null): void {
  try {
    localStorage.setItem(KEY, JSON.stringify({ ...read(), [currency]: placeId ?? NONE }));
  } catch {
    // Storage full or blocked: not remembered.
  }
}
