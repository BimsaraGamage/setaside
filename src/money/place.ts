import { type Currencies, isUsersCurrency, type Minor } from "./amount";
import { type CardEntry, heldForCardsMinor } from "./card";
import { setAsideMinor } from "./commitment";
import { type CycleEntries, countedMinor, freeIn, otherCurrency } from "./cycle";
import { potView } from "./pot";
import { atRate, minorAtLeast } from "./rate";
import { type SavingsMove, savingsTotal } from "./savings";

/**
 * A place's kind (spec 6): money for spending (in hand, the everyday bank
 * account), or money kept aside (free money is shared out to it last).
 */
export const PLACE_KINDS = ["spending", "kept"] as const;
export type PlaceKind = (typeof PLACE_KINDS)[number];

/** One `place` row with its newest `place_check`, as the money rules need it. */
export interface PlaceEntry {
  id: string;
  currency: string;
  kind: PlaceKind;
  /** "Stop using this place": left out of the totals and of Can spend. */
  archived: boolean;
  /** The balance last typed (Set balance); null while none was typed. */
  balanceMinor: Minor | null;
}

export interface PlaceInput {
  name: string;
  currency: string;
  kind: string;
}

export type PlaceProblem = "name" | "currency" | "kind";

export const PLACE_NAME_MAX = 40;
/** The most places one user keeps: a short list, read whole with Today. */
export const PLACES_MAX = 20;

/** Checks a new or changed place (spec 6). The phone shows the problems; the server refuses them. */
export function checkPlace(input: PlaceInput, ctx: Currencies): PlaceProblem[] {
  const out: PlaceProblem[] = [];
  const name = input.name.trim();
  if (!name || name.length > PLACE_NAME_MAX) out.push("name");
  // Either of the user's currencies (spec 8); fixed once made.
  if (!isUsersCurrency(input.currency, ctx)) out.push("currency");
  if (!(PLACE_KINDS as readonly string[]).includes(input.kind)) out.push("kind");
  return out;
}

/** A typed balance (Set balance): zero or more, whole minor units. */
export function isPlaceBalance(minor: unknown): minor is Minor {
  return typeof minor === "number" && Number.isSafeInteger(minor) && minor >= 0;
}

/** What the app knows about the money held: the current cycle, savings of every cycle, the cards. */
export interface HeldEntries {
  entries: CycleEntries;
  savings: SavingsMove[];
  cards: CardEntry[];
}

/**
 * What the app counts as held in one currency (spec 6): free money + still set
 * aside for commitments + what is left in the pots in use + savings + money
 * held for card balances. It is what the places should add up to. Each currency
 * apart (spec 8): rupees short are counted as short, not covered from dollars.
 */
export function appCountsMinor({ entries, savings, cards }: HeldEntries, currency: string): Minor {
  let total = freeIn(entries, currency);
  total += setAsideMinor(entries.commitments ?? [], entries.expectedSalaryOn, currency);
  for (const p of entries.pots ?? []) {
    if (p.currency === currency && !p.archived) total += potView(p, entries.spends).leftMinor;
  }
  total += savingsTotal(savings, currency);
  total += heldForCardsMinor(cards, entries.spends, entries.commitments ?? [], currency);
  return total;
}

/**
 * The part of free money held in one currency (spec 6, 8): what can be spent
 * out of that currency's places. With one currency it is free money. With two,
 * each currency's own free money, less the dollars reserved for rupee set-asides
 * past the rupees held (bills first, at the reserve rate), as `freeMoney` counts.
 */
export function freeHeldMinor(entries: CycleEntries, currency: string): Minor {
  const cur = entries.spendingCurrency;
  const other = otherCurrency(entries);
  const own = freeIn(entries, cur);
  if (!other) return currency === cur ? own : 0;
  if (currency !== cur && currency !== other) return 0;
  const dollars = freeIn(entries, other);
  const rate = entries.reserveRate ?? entries.countingRate;
  if (own >= 0 || dollars <= 0 || !rate || !entries.countingRate) return currency === other ? dollars : own;
  const reserved = minorAtLeast(-own, rate, other, cur);
  if (dollars >= reserved) return currency === other ? dollars - reserved : 0;
  // Not dollars enough: every dollar is reserved, the rest of the rupees are short.
  return currency === other ? 0 : own + atRate(dollars, rate, other, cur);
}

/** One place in use, as Where my money is shows it (spec 6). */
export interface PlaceLine<P> {
  place: P;
  /** The balance last typed; null: none yet. */
  balanceMinor: Minor | null;
  /** A salary-currency place's balance in the spending currency, at the counting rate, rounded down; null otherwise. */
  countedMinor: Minor | null;
  /** Can spend: the part of its balance that is free money, in its own currency. */
  canSpendMinor: Minor;
  /** Can spend of a salary-currency place in the spending currency; null otherwise. */
  canSpendCountedMinor: Minor | null;
}

/** One currency's places against what the app counts (spec 6). */
export interface PlaceTotal {
  currency: string;
  /** The balances of the places in use. */
  totalMinor: Minor;
  /** What the app counts as held in this currency (`appCountsMinor`). */
  appMinor: Minor;
  /**
   * Places less what the app counts: below zero, spends not entered; above,
   * income not entered. Null while a place in use has no balance yet.
   */
  differenceMinor: Minor | null;
}

export interface PlacesView<P> {
  /** The places in use, in list order. */
  lines: PlaceLine<P>[];
  /** Places no longer in use: listed, counted nowhere. */
  notInUse: P[];
  /** Per currency that has a place in use, the spending currency first. */
  totals: PlaceTotal[];
  /** Every place in use in the spending currency: the other currency's at the counting rate, rounded down. */
  totalCountedMinor: Minor;
}

/**
 * Where my money is (spec 6): each place with its balance and Can spend, the
 * totals, and the difference against what the app counts. Can spend shares each
 * currency's free money out to its places: For spending places first, in list
 * order, each up to its balance, then the Kept aside places; nothing while free
 * money is at zero or below. `places` come in list order.
 */
export function placesView<P extends PlaceEntry>(places: P[], held: HeldEntries): PlacesView<P> {
  const { entries } = held;
  const cur = entries.spendingCurrency;
  const other = otherCurrency(entries);
  const inUse = places.filter((p) => !p.archived);
  const counted = (p: P, minor: Minor) =>
    other && p.currency === other && entries.countingRate
      ? atRate(minor, entries.countingRate, other, cur)
      : null;

  const can = new Map<string, Minor>();
  const totals: PlaceTotal[] = [];
  for (const currency of other ? [cur, other] : [cur]) {
    const mine = inUse.filter((p) => p.currency === currency);
    if (mine.length === 0) continue;
    let left = Math.max(0, freeHeldMinor(entries, currency));
    for (const kind of PLACE_KINDS) {
      for (const p of mine) {
        if (p.kind !== kind) continue;
        const share = Math.min(p.balanceMinor ?? 0, left);
        can.set(p.id, share);
        left -= share;
      }
    }
    const totalMinor = mine.reduce((sum, p) => sum + (p.balanceMinor ?? 0), 0);
    const appMinor = appCountsMinor(held, currency);
    totals.push({
      currency,
      totalMinor,
      appMinor,
      differenceMinor: mine.every((p) => p.balanceMinor !== null) ? totalMinor - appMinor : null,
    });
  }

  const totalOf = (currency: string) => totals.find((t) => t.currency === currency)?.totalMinor ?? 0;
  return {
    lines: inUse.map((p) => {
      const canSpendMinor = can.get(p.id) ?? 0;
      return {
        place: p,
        balanceMinor: p.balanceMinor,
        countedMinor: p.balanceMinor === null ? null : counted(p, p.balanceMinor),
        canSpendMinor,
        canSpendCountedMinor: counted(p, canSpendMinor),
      };
    }),
    notInUse: places.filter((p) => p.archived),
    totals,
    totalCountedMinor: totalOf(cur) + (other ? countedMinor(entries, totalOf(other)) : 0),
  };
}
