import type { Minor } from "./amount";
import { NAME_MAX } from "./commitment";
import type { Day } from "./days";
import type { SpendEntry } from "./spend";

/** Suggested on Plan while there are no pots yet (spec 4); each can be renamed or deleted. */
export const STARTER_POTS = ["Groceries", "Fuel", "Transport", "Medicine"] as const;

/** One `pot` row with this cycle's `pot_allocation`, as the money rules need it. */
export interface PotEntry {
  id: string;
  currency: string;
  /** Set aside for it this cycle (0 when it has no allocation). */
  amountMinor: Minor;
  /** "Stop using this pot": what is left in it goes back to free money. */
  archived: boolean;
}

/** Spent from one pot, in its currency; with `before`, only spends dated before that day. */
function spentIn(p: PotEntry, spends: SpendEntry[], before?: Day): Minor {
  let total = 0;
  for (const s of spends) {
    if (s.potId !== p.id || s.currency !== p.currency) continue;
    if (before !== undefined && s.spentOn >= before) continue;
    total += s.amountMinor;
  }
  return total;
}

/**
 * What pots and their spends take out of free money, in one currency (spec 4).
 * A pot in use: its amount, or what was spent in it if more (a used-up pot's
 * further spends come from free money). A stopped pot: only what was spent in it.
 * The amount counts at once; with `startOf`, spends past an empty pot count only
 * when dated before that day (they are spends, spec 7).
 */
export function potOutMinor(pots: PotEntry[], spends: SpendEntry[], currency: string, startOf?: Day): Minor {
  let total = 0;
  for (const p of pots) {
    if (p.currency !== currency) continue;
    // Stopping a pot is not a spend: its spends stay the pot's, today's too.
    total += p.archived ? spentIn(p, spends) : Math.max(p.amountMinor, spentIn(p, spends, startOf));
  }
  return total;
}

/** Whether a spend is covered by one of these pots (so not a free-money spend). */
export function inAPot(s: SpendEntry, pots: PotEntry[]): boolean {
  return s.potId != null && pots.some((p) => p.id === s.potId && p.currency === s.currency);
}

export interface PotView {
  spentMinor: Minor;
  /** Amount less spent, never below zero. */
  leftMinor: Minor;
  /** How far past the amount ("Used up · over by"). */
  overMinor: Minor;
  usedUp: boolean;
}

/** A pot's amount left, its bar and "Used up" (spec 4, 10). */
export function potView(p: PotEntry, spends: SpendEntry[]): PotView {
  const spentMinor = spentIn(p, spends);
  return {
    spentMinor,
    leftMinor: Math.max(0, p.amountMinor - spentMinor),
    overMinor: Math.max(0, spentMinor - p.amountMinor),
    usedUp: spentMinor >= p.amountMinor && spentMinor > 0,
  };
}

export interface PotInput {
  name: string;
  currency: string;
  usualAmountMinor: number;
  /** This cycle's amount. */
  amountMinor: number;
}

export type PotProblem = "name" | "usual_amount" | "amount" | "currency";

const minor = (n: number) => Number.isSafeInteger(n) && n >= 0;

/** Checks a new or changed pot (spec 4). The phone shows the problems; the server refuses them. */
export function checkPot(input: PotInput, ctx: { spendingCurrency: string }): PotProblem[] {
  const out: PotProblem[] = [];
  const name = input.name.trim();
  if (!name || name.length > NAME_MAX) out.push("name");
  if (!minor(input.usualAmountMinor)) out.push("usual_amount");
  if (!minor(input.amountMinor)) out.push("amount");
  // One currency until item 15 (two currencies).
  if (input.currency !== ctx.spendingCurrency) out.push("currency");
  return out;
}
