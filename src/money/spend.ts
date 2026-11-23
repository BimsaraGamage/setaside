import type { Currencies, Minor } from "./amount";
import type { CardEntry } from "./card";
import { type Day, isDay } from "./days";
import { type PlaceRef, placeUsable } from "./place";
import type { PotEntry } from "./pot";

/** One `spend` row, as the money rules need it. */
export interface SpendEntry {
  spentOn: Day;
  currency: string;
  amountMinor: Minor;
  /** The pot it came from (spec 4); none means free money. */
  potId?: string | null;
  /** Uses free money but is left out of the spending speed (spec 7). */
  oneOff?: boolean;
  /** The card it was paid with (spec 9): adds to that card's balance. */
  cardId?: string | null;
  /** Saved quickly, to finish later (SAB-76): counts like any spend; the spend nudge asks about it. */
  toFinish?: boolean;
}

/** A spend to finish saved with no amount yet (SAB-83): stored as 0, counts as zero meanwhile. */
export function hasNoAmount(s: { amountMinor: number; toFinish?: boolean | null }): boolean {
  return s.toFinish === true && s.amountMinor === 0;
}

/** How many of these spends have no amount yet (SAB-83). */
export function noAmountCount(spends: { amountMinor: number; toFinish?: boolean | null }[]): number {
  return spends.filter(hasNoAmount).length;
}

const spendsHave = (n: number) => `${n} spend${n === 1 ? " has" : "s have"} no amount`;

/** Today's main card while the cycle has spends with no amount (SAB-83): "May be lower: 1 spend has no amount". */
export function noAmountLine(n: number): string {
  return `May be lower: ${spendsHave(n)}`;
}

/** Salary day step 3 (SAB-83): the leftover counts them as zero, so what is in hand may be less. */
export function noAmountInHandNote(n: number): string {
  return `${spendsHave(n)}: correct in hand for ${n === 1 ? "it" : "them"}.`;
}

export interface SpendInput {
  amountMinor: number;
  spentOn: string;
  currency: string;
  note?: string | null;
  potId?: string | null;
  cardId?: string | null;
  /** The place the money came out of (spec 6); none moves no place. A card spend has none. */
  placeId?: string | null;
  /** Finish later (SAB-76): only a spend to finish may have no amount (0, SAB-83). */
  toFinish?: boolean;
}

export interface SpendContext extends Currencies {
  today: Day;
  /** Spends are dated back within the current cycle only (spec 2). */
  cycleStartedOn: Day;
  /** The user's pots; a spend goes to one in use (spec 4). */
  pots?: Pick<PotEntry, "id" | "currency" | "archived">[];
  /** A changed spend may stay in the stopped pot it is already in. */
  keepPotId?: string | null;
  /** The user's cards; a card spend uses one in use, in the spend's currency (spec 9). */
  cards?: Pick<CardEntry, "id" | "currency" | "archived">[];
  /** A changed spend may stay on the stopped card it is already on. */
  keepCardId?: string | null;
  /** The user's places; a spend comes out of one in use, in the spend's currency (spec 6). */
  places?: PlaceRef[];
  /** A changed spend may stay in the stopped place it already has. */
  keepPlaceId?: string | null;
}

export type SpendProblem = "amount" | "spent_on" | "currency" | "note" | "pot" | "card" | "place";

export const NOTE_MAX = 200;

/**
 * Checks a new or changed spend (spec 2, 7). The phone shows the problems; the server refuses them.
 * The amount is above zero, or 0 for a spend to finish with no amount yet (SAB-83).
 */
export function checkSpend(input: SpendInput, ctx: SpendContext): SpendProblem[] {
  const out: SpendProblem[] = [];
  const least = input.toFinish === true ? 0 : 1;
  if (!Number.isSafeInteger(input.amountMinor) || input.amountMinor < least) out.push("amount");
  if (!isDay(input.spentOn) || input.spentOn < ctx.cycleStartedOn || input.spentOn > ctx.today) {
    out.push("spent_on");
  }
  // In the spending currency; a spend in a salary-currency pot is in the pot's (spec 8).
  const inSalaryPot = input.potId != null && input.currency === ctx.salaryCurrency;
  if (input.currency !== ctx.spendingCurrency && !inSalaryPot) out.push("currency");
  if (input.note != null && input.note.length > NOTE_MAX) out.push("note");
  if (input.potId != null) {
    const pot = ctx.pots?.find((p) => p.id === input.potId);
    const usable = pot && pot.currency === input.currency && (!pot.archived || pot.id === ctx.keepPotId);
    if (!usable) out.push("pot");
  }
  if (input.cardId != null) {
    const card = ctx.cards?.find((k) => k.id === input.cardId);
    const usable = card && card.currency === input.currency && (!card.archived || card.id === ctx.keepCardId);
    if (!usable) out.push("card");
  }
  // A card spend moves no place until the card bill is paid (spec 6).
  if (input.placeId != null) {
    if (input.cardId != null || !placeUsable(input.placeId, input.currency, ctx.places, ctx.keepPlaceId)) {
      out.push("place");
    }
  }
  return out;
}
