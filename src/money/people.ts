import { type Currencies, isUsersCurrency, type Minor } from "./amount";
import { NAME_MAX } from "./commitment";
import { type Day, isDay } from "./days";

/** `person_debt.direction` (spec 9): money lent to a person, or borrowed from one. */
export type DebtDirection = "lent" | "borrowed";

/**
 * Money lent to or borrowed from a person (spec 9), in its own currency.
 * Lent: free money fell when it was lent; what came back is `paid_back` income.
 * Borrowed: it came in as `borrowed` income; it is paid back by `person_payback`
 * commitments with dates the user sets.
 */
export interface PersonDebtEntry {
  id: string;
  personName: string;
  direction: DebtDirection;
  currency: string;
  amountMinor: Minor;
  /** The day it was lent or borrowed. */
  madeOn: Day;
  /** Settled on this day: closed, whatever is still owed. */
  settledOn: Day | null;
  /**
   * Back so far, all cycles. Lent: Got it back (`paid_back` incomes). Borrowed:
   * what payments on its paybacks cover, in its currency.
   */
  backMinor: Minor;
}

export interface DebtProgress {
  /** Still owed: the amount less what is back, never below zero. */
  owedMinor: Minor;
  /** Settled, or nothing is owed any more: listed under Settled. */
  closed: boolean;
}

/** Who owes what on one entry (spec 9). An entry with nothing owed closes by itself. */
export function debtProgress(
  d: Pick<PersonDebtEntry, "amountMinor" | "backMinor" | "settledOn">,
): DebtProgress {
  const owedMinor = Math.max(0, d.amountMinor - d.backMinor);
  return { owedMinor, closed: d.settledOn !== null || owedMinor === 0 };
}

/** The usual name of a payback commitment: "Pay back Nimal". */
export function paybackName(personName: string): string {
  return `Pay back ${personName.trim()}`.slice(0, NAME_MAX);
}

/** The longest person name; room is left for "Pay back " in the payback's name. */
export const PERSON_NAME_MAX = 60;

export interface PersonDebtInput {
  personName: string;
  direction: string;
  currency: string;
  amountMinor: number;
  /** Borrowed: the part sent to savings; the rest is free money (like extra income). */
  toSavingsMinor?: number;
  /** Borrowed: the payback commitment, when a date is given. */
  payback?: { plannedMinor: number; dueOn: string } | null;
}

export type PersonDebtProblem =
  | "name"
  | "direction"
  | "currency"
  | "amount"
  | "to_savings"
  | "payback_amount"
  | "payback_on";

const whole = (n: number) => Number.isSafeInteger(n) && n > 0;

/**
 * Checks I lent money and I borrowed (spec 9). Either of the user's currencies.
 * Lent money comes out of free money, so it has no split and no payback. Borrowed
 * money is split like extra income; its payback is due in this cycle or later and
 * is at most what was borrowed.
 */
export function checkPersonDebt(
  input: PersonDebtInput,
  ctx: Currencies & { cycleStartedOn: Day },
): PersonDebtProblem[] {
  const out: PersonDebtProblem[] = [];
  const name = input.personName.trim();
  if (!name || name.length > PERSON_NAME_MAX) out.push("name");
  const lent = input.direction === "lent";
  if (!lent && input.direction !== "borrowed") out.push("direction");
  if (!isUsersCurrency(input.currency, ctx)) out.push("currency");
  const amountOk = whole(input.amountMinor);
  if (!amountOk) out.push("amount");
  const toSavings = input.toSavingsMinor ?? 0;
  if (
    !Number.isSafeInteger(toSavings) ||
    toSavings < 0 ||
    (lent && toSavings > 0) ||
    (amountOk && toSavings > input.amountMinor)
  ) {
    out.push("to_savings");
  }
  const p = input.payback;
  if (p) {
    if (lent || !whole(p.plannedMinor) || (amountOk && p.plannedMinor > input.amountMinor)) {
      out.push("payback_amount");
    }
    if (lent || !isDay(p.dueOn) || p.dueOn < ctx.cycleStartedOn) out.push("payback_on");
  }
  return out;
}

export interface GotBackInput {
  amountMinor: number;
  toSavingsMinor: number;
}

export type GotBackProblem = "entry" | "amount" | "too_much" | "to_savings";

/**
 * Checks Got it back (spec 9): only on money lent and not closed, at most what is
 * still owed, split between savings and free money like extra income.
 */
export function checkGotBack(
  input: GotBackInput,
  d: Pick<PersonDebtEntry, "direction" | "amountMinor" | "backMinor" | "settledOn">,
): GotBackProblem[] {
  const out: GotBackProblem[] = [];
  const g = debtProgress(d);
  if (d.direction !== "lent" || g.closed) out.push("entry");
  const amountOk = whole(input.amountMinor);
  if (!amountOk) out.push("amount");
  else if (input.amountMinor > g.owedMinor) out.push("too_much");
  if (
    !Number.isSafeInteger(input.toSavingsMinor) ||
    input.toSavingsMinor < 0 ||
    (amountOk && input.toSavingsMinor > input.amountMinor)
  ) {
    out.push("to_savings");
  }
  return out;
}

export interface PaybackInput {
  plannedMinor: number;
  dueOn: string;
}

export type PaybackProblem = "entry" | "amount" | "too_much" | "due_on";

/**
 * What a new payback is filled with (spec 9): still owed less what open paybacks
 * already set aside, never below zero.
 */
export function paybackFillMinor(owedMinor: Minor, setAsideMinor: Minor): Minor {
  return Math.max(0, owedMinor - setAsideMinor);
}

/**
 * Checks a payback added on a borrowed entry (spec 9): not closed, due in this
 * cycle or later, at most what is owed past the open paybacks.
 */
export function checkPayback(
  input: PaybackInput,
  d: Pick<PersonDebtEntry, "direction" | "amountMinor" | "backMinor" | "settledOn">,
  ctx: { cycleStartedOn: Day; setAsideMinor: Minor },
): PaybackProblem[] {
  const out: PaybackProblem[] = [];
  const g = debtProgress(d);
  if (d.direction !== "borrowed" || g.closed) out.push("entry");
  if (!whole(input.plannedMinor)) out.push("amount");
  else if (input.plannedMinor > paybackFillMinor(g.owedMinor, ctx.setAsideMinor)) out.push("too_much");
  if (!isDay(input.dueOn) || input.dueOn < ctx.cycleStartedOn) out.push("due_on");
  return out;
}
