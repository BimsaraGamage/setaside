import { type Currencies, isUsersCurrency, type Minor } from "./amount";
import { NAME_MAX } from "./commitment";
import type { Day } from "./days";
import type { SalaryDayDraft } from "./salary-day";

/**
 * A prepayment from savings (spec 5): a long period paid up front from savings
 * (a year of gym), paid back into savings by a commitment in each cycle.
 */
export interface PrepaymentEntry {
  id: string;
  name: string;
  currency: string;
  /** What came out of savings. */
  totalMinor: Minor;
  /** The usual payback each cycle. */
  paybackMinor: Minor;
  /** Moved back into savings so far: payments on its payback commitments, all cycles. */
  paidBackMinor: Minor;
}

export interface PrepaymentInput {
  name: string;
  currency: string;
  totalMinor: number;
  paybackMinor: number;
  /** What it would cost a month without paying up front (optional, for the saving). */
  normalMonthlyMinor?: number | null;
  /** How many months the prepayment covers; given with the monthly price. */
  months?: number | null;
}

export type PrepaymentProblem =
  | "name"
  | "currency"
  | "amount"
  | "payback"
  | "too_much"
  | "monthly"
  | "months";

/** The most months a prepayment can cover (50 years). */
export const MONTHS_MAX = 600;

const whole = (n: number) => Number.isSafeInteger(n) && n > 0;
const given = (n: number | null | undefined): n is number => n !== null && n !== undefined;

/**
 * Checks Take out of savings "for a prepayment" (spec 5): never more than is
 * saved in that currency; the payback each cycle is above zero and at most the whole amount.
 */
export function checkPrepayment(
  input: PrepaymentInput,
  ctx: Currencies & { savingsMinor: Minor },
): PrepaymentProblem[] {
  const out: PrepaymentProblem[] = [];
  const name = input.name.trim();
  if (!name || name.length > NAME_MAX) out.push("name");
  // Either of the user's currencies (spec 8).
  if (!isUsersCurrency(input.currency, ctx)) out.push("currency");
  const amountOk = whole(input.totalMinor);
  if (!amountOk) out.push("amount");
  if (!whole(input.paybackMinor) || (amountOk && input.paybackMinor > input.totalMinor)) out.push("payback");
  if (amountOk && input.totalMinor > ctx.savingsMinor) out.push("too_much");
  // The saving needs both: the monthly price and the months it covers.
  const monthly = input.normalMonthlyMinor;
  const months = input.months;
  if (given(monthly) || given(months)) {
    if (!given(monthly) || !whole(monthly)) out.push("monthly");
    if (!given(months) || !whole(months) || months > MONTHS_MAX) out.push("months");
  }
  return out;
}

/**
 * The prepayment saving (glossary, spec 5): the normal monthly price × the months
 * it covers, less what was paid up front. Below zero: paying up front cost more.
 * Null when no monthly price was given.
 */
export function prepaymentSavingMinor(p: {
  totalMinor: Minor;
  normalMonthlyMinor: Minor | null;
  months: number | null;
}): Minor | null {
  if (p.normalMonthlyMinor === null || p.months === null) return null;
  return p.normalMonthlyMinor * p.months - p.totalMinor;
}

/** How many cycles it takes to pay back `totalMinor` at `paybackMinor` a cycle. */
export function paybackCycles(totalMinor: Minor, paybackMinor: Minor): number {
  return paybackMinor > 0 ? Math.ceil(Math.max(0, totalMinor) / paybackMinor) : 0;
}

/**
 * The payback a new cycle sets aside (spec 5): the usual amount, the last one only
 * what is left. `plannedMinor` is what that cycle already has for it (carried from
 * last cycle). A payback dropped or finished short leaves more to pay back, so the
 * total is always paid back in the end.
 */
export function paybackDueMinor(
  p: Pick<PrepaymentEntry, "totalMinor" | "paybackMinor" | "paidBackMinor">,
  plannedMinor: Minor = 0,
): Minor {
  return Math.max(0, Math.min(p.paybackMinor, p.totalMinor - p.paidBackMinor - plannedMinor));
}

/** A prepayment's payback progress, for Savings (spec 5, 10). */
export function prepaymentProgress(
  p: Pick<PrepaymentEntry, "totalMinor" | "paybackMinor" | "paidBackMinor">,
) {
  const leftMinor = Math.max(0, p.totalMinor - p.paidBackMinor);
  return {
    paidBackMinor: p.paidBackMinor,
    leftMinor,
    cyclesLeft: paybackCycles(leftMinor, p.paybackMinor),
    done: leftMinor === 0,
  };
}

/**
 * Salary day's payback rows (spec 5, 6 step 4): one per prepayment not yet paid
 * back, due on the new cycle's first day. `planned` is what the new cycle already
 * has for each prepayment (by id), such as a payback carried from last cycle.
 */
export function paybackDrafts(
  list: PrepaymentEntry[],
  startedOn: Day,
  planned: Record<string, Minor> = {},
): (SalaryDayDraft & { prepaymentId: string })[] {
  return list.flatMap((p) => {
    const plannedMinor = paybackDueMinor(p, planned[p.id] ?? 0);
    if (plannedMinor <= 0) return [];
    return [
      {
        prepaymentId: p.id,
        recurringId: null,
        carriedFromId: null,
        name: p.name,
        kind: "savings_payback" as const,
        currency: p.currency,
        plannedMinor,
        dueOn: startedOn,
        everyCycle: false,
      },
    ];
  });
}
