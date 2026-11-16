import type { Currencies, Minor } from "./amount";
import type { CardEntry } from "./card";
import { type Day, isDay } from "./days";
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
}

export interface SpendInput {
  amountMinor: number;
  spentOn: string;
  currency: string;
  note?: string | null;
  potId?: string | null;
  cardId?: string | null;
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
}

export type SpendProblem = "amount" | "spent_on" | "currency" | "note" | "pot" | "card";

export const NOTE_MAX = 200;

/** Checks a new or changed spend (spec 2, 7). The phone shows the problems; the server refuses them. */
export function checkSpend(input: SpendInput, ctx: SpendContext): SpendProblem[] {
  const out: SpendProblem[] = [];
  if (!Number.isSafeInteger(input.amountMinor) || input.amountMinor <= 0) out.push("amount");
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
  return out;
}
