import type { Minor } from "./amount";
import type { Day } from "./days";

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
export function checkIncome(input: IncomeInput, ctx: { spendingCurrency: string }): IncomeProblem[] {
  const out: IncomeProblem[] = [];
  if (!(ADD_INCOME_KINDS as readonly string[]).includes(input.kind)) out.push("kind");
  // One currency until item 15 (two currencies).
  if (input.currency !== ctx.spendingCurrency) out.push("currency");
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
export function checkSavingsMove(
  input: SavingsMoveInput,
  ctx: { spendingCurrency: string },
): SavingsMoveProblem[] {
  const out: SavingsMoveProblem[] = [];
  // One currency until item 15 (two currencies).
  if (input.currency !== ctx.spendingCurrency) out.push("currency");
  if (!Number.isSafeInteger(input.amountMinor) || input.amountMinor <= 0) out.push("amount");
  else if (input.kind === "take_out" && input.amountMinor > input.totalMinor) out.push("too_much");
  return out;
}
