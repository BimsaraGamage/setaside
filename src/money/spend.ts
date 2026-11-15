import type { Minor } from "./amount";
import { type Day, isDay } from "./days";
import type { PotEntry } from "./pot";

/** One `spend` row, as the money rules need it. */
export interface SpendEntry {
  spentOn: Day;
  currency: string;
  amountMinor: Minor;
  /** The pot it came from (spec 4); none means free money. */
  potId?: string | null;
}

export interface SpendInput {
  amountMinor: number;
  spentOn: string;
  currency: string;
  note?: string | null;
  potId?: string | null;
}

export interface SpendContext {
  today: Day;
  /** Spends are dated back within the current cycle only (spec 2). */
  cycleStartedOn: Day;
  spendingCurrency: string;
  /** The user's pots; a spend goes to one in use (spec 4). */
  pots?: Pick<PotEntry, "id" | "currency" | "archived">[];
  /** A changed spend may stay in the stopped pot it is already in. */
  keepPotId?: string | null;
}

export type SpendProblem = "amount" | "spent_on" | "currency" | "note" | "pot";

export const NOTE_MAX = 200;

/** Checks a new or changed spend (spec 2, 7). The phone shows the problems; the server refuses them. */
export function checkSpend(input: SpendInput, ctx: SpendContext): SpendProblem[] {
  const out: SpendProblem[] = [];
  if (!Number.isSafeInteger(input.amountMinor) || input.amountMinor <= 0) out.push("amount");
  if (!isDay(input.spentOn) || input.spentOn < ctx.cycleStartedOn || input.spentOn > ctx.today) {
    out.push("spent_on");
  }
  // One currency until item 15 (two currencies).
  if (input.currency !== ctx.spendingCurrency) out.push("currency");
  if (input.note != null && input.note.length > NOTE_MAX) out.push("note");
  if (input.potId != null) {
    const pot = ctx.pots?.find((p) => p.id === input.potId);
    const usable = pot && pot.currency === input.currency && (!pot.archived || pot.id === ctx.keepPotId);
    if (!usable) out.push("pot");
  }
  return out;
}
