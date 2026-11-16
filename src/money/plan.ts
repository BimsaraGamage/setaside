import { type Currencies, isUsersCurrency, type Minor } from "./amount";
import { NAME_MAX } from "./commitment";
import { addMonths, type Day, isDay } from "./days";
import { dueOnFrom, type SalaryDayDraft, usualDayOf } from "./salary-day";

/**
 * An instalment plan (spec 9): a bank loan or a card instalment plan, paid back
 * in fixed payments. Each cycle gets a commitment (kind `plan_payment`) for the
 * next payment, so free money only feels the payment.
 */
export interface PlanEntry {
  id: string;
  name: string;
  currency: string;
  /** What the thing cost (or the loan amount). */
  priceMinor: Minor;
  paymentCount: number;
  /** The usual payment; the last one is only what is left. */
  paymentMinor: Minor;
  firstPaymentOn: Day;
  /** The card it is on (shown only; its payments are set aside like a bill). */
  cardId?: string | null;
  /** The normal monthly price, for the prepayment saving; null when not given. */
  normalMonthlyMinor: Minor | null;
  /** Pay it all off was done on this day; nothing more is due. */
  paidOffOn: Day | null;
  /** What payments on its plan payments cover, all cycles. */
  paidMinor: Minor;
  /** Pay extra and Pay it all off, all cycles. */
  extraMinor: Minor;
  /** Its plan payments finished with money paid, all cycles: "N of M". */
  paymentsMade: number;
}

export interface PlanInput {
  name: string;
  currency: string;
  priceMinor: number;
  paymentCount: number;
  paymentMinor: number;
  firstPaymentOn: string;
  cardId?: string | null;
  normalMonthlyMinor?: number | null;
}

export type PlanProblem =
  | "name"
  | "currency"
  | "price"
  | "count"
  | "payment"
  | "total"
  | "first_on"
  | "card"
  | "monthly";

/** The most payments a plan can have (50 years of monthly payments). */
export const PLAN_COUNT_MAX = 600;

const whole = (n: number) => Number.isSafeInteger(n) && n > 0;

/**
 * Checks a new plan (spec 9). All payments together are at least the price
 * (interest is never below zero; 0% instalments are fine). The first payment is
 * in this cycle or later: an older loan is entered with what is left of it.
 */
export function checkPlan(
  input: PlanInput,
  ctx: Currencies & { cycleStartedOn: Day; cards: { id: string; currency: string; archived: boolean }[] },
): PlanProblem[] {
  const out: PlanProblem[] = [];
  const name = input.name.trim();
  if (!name || name.length > NAME_MAX) out.push("name");
  if (!isUsersCurrency(input.currency, ctx)) out.push("currency");
  const priceOk = whole(input.priceMinor);
  if (!priceOk) out.push("price");
  const countOk = whole(input.paymentCount) && input.paymentCount <= PLAN_COUNT_MAX;
  if (!countOk) out.push("count");
  const paymentOk = whole(input.paymentMinor);
  if (!paymentOk) out.push("payment");
  if (priceOk && countOk && paymentOk && input.paymentCount * input.paymentMinor < input.priceMinor) {
    out.push("total");
  }
  if (!isDay(input.firstPaymentOn) || input.firstPaymentOn < ctx.cycleStartedOn) out.push("first_on");
  if (input.cardId) {
    const card = ctx.cards.find((k) => k.id === input.cardId);
    if (!card || card.archived || card.currency !== input.currency) out.push("card");
  }
  const monthly = input.normalMonthlyMinor;
  if (monthly !== null && monthly !== undefined && !whole(monthly)) out.push("monthly");
  return out;
}

/** All the plan's payments together, as entered. */
export function planTotalMinor(p: Pick<PlanEntry, "paymentCount" | "paymentMinor">): Minor {
  return p.paymentCount * p.paymentMinor;
}

type ProgressFields = Pick<
  PlanEntry,
  "priceMinor" | "paymentCount" | "paymentMinor" | "paidOffOn" | "paidMinor" | "extraMinor" | "paymentsMade"
>;

export interface PlanProgress {
  /** Payments and extra payments so far. */
  paidMinor: Minor;
  stillToPayMinor: Minor;
  paymentsMade: number;
  /** Payments still to make at the usual payment (Pay extra makes it drop). */
  paymentsLeft: number;
  /** Interest = all payments − price (spec 9); after Pay it all off, what was paid − price. */
  interestTotalMinor: Minor;
  /** The interest's share of what is paid so far, rounded down. */
  interestSoFarMinor: Minor;
  done: boolean;
}

/** A plan's progress page numbers (spec 9, 10). */
export function planProgress(p: ProgressFields): PlanProgress {
  const paidMinor = p.paidMinor + p.extraMinor;
  const stillToPayMinor = p.paidOffOn ? 0 : Math.max(0, planTotalMinor(p) - paidMinor);
  const allMinor = paidMinor + stillToPayMinor;
  const interestTotalMinor = allMinor - p.priceMinor;
  const interestSoFarMinor =
    allMinor > 0 ? Math.floor((Math.max(0, interestTotalMinor) * paidMinor) / allMinor) : 0;
  return {
    paidMinor,
    stillToPayMinor,
    paymentsMade: p.paymentsMade,
    paymentsLeft: p.paymentMinor > 0 ? Math.ceil(stillToPayMinor / p.paymentMinor) : 0,
    interestTotalMinor,
    interestSoFarMinor,
    done: stillToPayMinor === 0,
  };
}

/**
 * The payment a cycle sets aside (spec 9): the usual payment, the last one only
 * what is left; less `plannedMinor`, what the cycle already has for it (carried
 * from last cycle). A skipped payment leaves more to pay, so the plan is always
 * paid in full in the end. Nothing once paid off.
 */
export function planPaymentDueMinor(p: ProgressFields, plannedMinor: Minor = 0): Minor {
  const left = planProgress(p).stillToPayMinor;
  return Math.max(0, Math.min(p.paymentMinor, left - plannedMinor));
}

/**
 * The due date of a cycle's payment: the first payment's day of the month, on or
 * after the cycle's start, never before the first payment.
 */
export function planDueOn(p: Pick<PlanEntry, "firstPaymentOn">, startedOn: Day): Day {
  const due = dueOnFrom(startedOn, usualDayOf(p.firstPaymentOn));
  return due < p.firstPaymentOn ? p.firstPaymentOn : due;
}

/**
 * The next payment's day: this cycle's open one when there is one, else the
 * next cycle's (counted from the expected salary day).
 */
export function planNextDueOn(
  p: Pick<PlanEntry, "firstPaymentOn">,
  cycle: { expectedSalaryOn: Day },
  openDueOn: Day | null,
): Day {
  return openDueOn ?? planDueOn(p, cycle.expectedSalaryOn);
}

/** The last payment date (spec 9): the next payment plus a month for each one after it; null when done. */
export function planLastPaymentOn(p: ProgressFields & Pick<PlanEntry, "firstPaymentOn">, nextDueOn: Day) {
  const g = planProgress(p);
  if (g.done) return null;
  return addMonths(nextDueOn, g.paymentsLeft - 1, usualDayOf(p.firstPaymentOn));
}

/**
 * The prepayment saving (spec 9, glossary): the normal monthly price for each
 * payment, less all the plan's payments (so after interest). Null without a monthly price.
 */
export function planSavingMinor(p: ProgressFields & Pick<PlanEntry, "normalMonthlyMinor">): Minor | null {
  if (p.normalMonthlyMinor === null) return null;
  const g = planProgress(p);
  return p.normalMonthlyMinor * p.paymentCount - (g.paidMinor + g.stillToPayMinor);
}

/**
 * Salary day's plan rows (spec 9, 6 step 4): one per plan with money left whose
 * payment falls by the new cycle's expected salary day. `planned` is what the new
 * cycle already has for each plan (by id), such as a payment carried from last cycle.
 */
export function planDrafts(
  list: PlanEntry[],
  startedOn: Day,
  expectedSalaryOn: Day,
  planned: Record<string, Minor> = {},
): (SalaryDayDraft & { planId: string })[] {
  return list.flatMap((p) => {
    const plannedMinor = planPaymentDueMinor(p, planned[p.id] ?? 0);
    const dueOn = planDueOn(p, startedOn);
    if (plannedMinor <= 0 || dueOn > expectedSalaryOn) return [];
    return [
      {
        planId: p.id,
        recurringId: null,
        carriedFromId: null,
        name: p.name,
        kind: "plan_payment" as const,
        currency: p.currency,
        plannedMinor,
        dueOn,
        everyCycle: false,
      },
    ];
  });
}

/** Where Pay extra and Pay it all off take the money from (spec 9). */
export type PlanExtraFrom = "free" | "savings";

export interface PlanExtraInput {
  amountMinor: number;
  from: string;
  /** Pay it all off: the plan ends; this cycle's open payment is finished. */
  paysOff: boolean;
}

export type PlanExtraProblem = "amount" | "from" | "too_much" | "savings";

/**
 * Checks Pay extra and Pay it all off (spec 9). Pay extra is at most what is
 * left past this cycle's open payment (`setAsideMinor`, still to pay on it). Pay
 * it all off takes any amount (the bank may take some interest off). From
 * savings: never more than is saved in the plan's currency.
 */
export function checkPlanExtra(
  input: PlanExtraInput,
  ctx: { stillToPayMinor: Minor; setAsideMinor: Minor; savingsMinor: Minor },
): PlanExtraProblem[] {
  const out: PlanExtraProblem[] = [];
  const amountOk = whole(input.amountMinor);
  if (!amountOk) out.push("amount");
  if (input.from !== "free" && input.from !== "savings") out.push("from");
  if (amountOk && !input.paysOff && input.amountMinor > ctx.stillToPayMinor - ctx.setAsideMinor) {
    out.push("too_much");
  }
  if (amountOk && input.from === "savings" && input.amountMinor > ctx.savingsMinor) out.push("savings");
  return out;
}
