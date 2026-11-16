import { type Currencies, isUsersCurrency, type Minor } from "./amount";
import type { Day } from "./days";
import { atRate, type Rate } from "./rate";

/**
 * One movement into or out of savings, as the money rules need it: `amountMinor`
 * is above zero when money went in, below zero when it came out (spec 5).
 * Movements come from savings set-asides moved, extra income sent to savings,
 * Put in and Take out; later items add saved leftover, rate gains and prepayments.
 */
export interface SavingsMove {
  currency: string;
  amountMinor: Minor;
}

/** The savings total in one currency (spec 5): everything that went in less what came out. */
export function savingsTotal(moves: SavingsMove[], currency: string): Minor {
  let total = 0;
  for (const m of moves) if (m.currency === currency) total += m.amountMinor;
  return total;
}

/** Money taken out of savings into free money in the current cycle (spec 5). */
export interface TakeOutEntry {
  currency: string;
  /** Above zero: what came out of savings. */
  amountMinor: Minor;
  /** Counts in free money from this day on (spec 7: not money left over on the days before). */
  movedOn: Day;
}

/** Kinds of Add income (spec 5). Loan money, borrowed and paid back to me come with items 19 and 20. */
export const ADD_INCOME_KINDS = ["extra"] as const;

export interface IncomeInput {
  kind: string;
  currency: string;
  amountMinor: number;
  toSavingsMinor: number;
}

export type IncomeProblem = "kind" | "currency" | "amount" | "to_savings";

/** Checks Add income (spec 5): the split is to savings, the rest to free money. */
export function checkIncome(input: IncomeInput, ctx: Currencies): IncomeProblem[] {
  const out: IncomeProblem[] = [];
  if (!(ADD_INCOME_KINDS as readonly string[]).includes(input.kind)) out.push("kind");
  // Either of the user's currencies (spec 8).
  if (!isUsersCurrency(input.currency, ctx)) out.push("currency");
  const amountOk = Number.isSafeInteger(input.amountMinor) && input.amountMinor > 0;
  if (!amountOk) out.push("amount");
  if (
    !Number.isSafeInteger(input.toSavingsMinor) ||
    input.toSavingsMinor < 0 ||
    (amountOk && input.toSavingsMinor > input.amountMinor)
  ) {
    out.push("to_savings");
  }
  return out;
}

export interface SavingsMoveInput {
  kind: "put_in" | "take_out";
  currency: string;
  amountMinor: number;
  /** The savings total in that currency now. */
  totalMinor: Minor;
}

export type SavingsMoveProblem = "currency" | "amount" | "too_much";

/** Checks Put in and Take out (spec 5). Take out can't go past what is saved. */
export function checkSavingsMove(input: SavingsMoveInput, ctx: Currencies): SavingsMoveProblem[] {
  const out: SavingsMoveProblem[] = [];
  // Either of the user's currencies (spec 8).
  if (!isUsersCurrency(input.currency, ctx)) out.push("currency");
  if (!Number.isSafeInteger(input.amountMinor) || input.amountMinor <= 0) out.push("amount");
  else if (input.kind === "take_out" && input.amountMinor > input.totalMinor) out.push("too_much");
  return out;
}

/**
 * The combined savings total (spec 5, 8): the spending currency's total plus the
 * salary currency's at the counting rate, rounded down; just the one total with
 * one currency, and the spending currency's alone without a rate.
 */
export function combinedSavingsMinor(
  moves: SavingsMove[],
  ctx: Currencies & { countingRate?: Rate | null },
): Minor {
  const own = savingsTotal(moves, ctx.spendingCurrency);
  const other = ctx.salaryCurrency;
  if (!other || other === ctx.spendingCurrency || !ctx.countingRate) return own;
  return own + atRate(savingsTotal(moves, other), ctx.countingRate, other, ctx.spendingCurrency);
}
