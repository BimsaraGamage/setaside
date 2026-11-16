import { type Currencies, isUsersCurrency, type Minor } from "./amount";
import { type Day, daysBetween, isDay } from "./days";

/** `commitment.state` (data-model.md). Only open ones are set aside. */
export type CommitmentState = "open" | "finished" | "carried" | "dropped";

/** One `commitment_payment` row, as the money rules need it. */
export interface PaymentEntry {
  amountMinor: Minor;
  currency: string;
  paidOn: Day;
}

/** One `commitment` row with its payments, as the money rules need it. */
export interface CommitmentEntry {
  dueOn: Day;
  currency: string;
  plannedMinor: Minor;
  state: CommitmentState;
  /** Payments so far (parts allowed); none means unpaid. */
  payments?: PaymentEntry[];
}

/**
 * Due on or before the expected salary day: belongs to this cycle and is set aside.
 * Due after it: belongs to the next cycle, shown as coming up only (spec 3).
 */
export function inThisCycle(dueOn: Day, expectedSalaryOn: Day): boolean {
  return dueOn <= expectedSalaryOn;
}

function isSetAside(c: CommitmentEntry, expectedSalaryOn: Day): boolean {
  return c.state === "open" && inThisCycle(c.dueOn, expectedSalaryOn);
}

/** What has been paid on a commitment so far, in one currency (spec 3). */
export function paidMinor(c: Pick<CommitmentEntry, "payments">, currency: string): Minor {
  let total = 0;
  for (const p of c.payments ?? []) if (p.currency === currency) total += p.amountMinor;
  return total;
}

/** "Still to pay": planned less paid, never below zero (spec 3). */
export function stillToPayMinor(c: CommitmentEntry): Minor {
  return Math.max(0, c.plannedMinor - paidMinor(c, c.currency));
}

/**
 * Money still set aside for this cycle's open commitments, in one currency
 * (spec 1, 3): what is still to pay on each. It is Next up's total.
 */
export function setAsideMinor(list: CommitmentEntry[], expectedSalaryOn: Day, currency: string): Minor {
  let total = 0;
  for (const c of list) {
    if (c.currency === currency && isSetAside(c, expectedSalaryOn)) total += stillToPayMinor(c);
  }
  return total;
}

/**
 * What commitments take out of free money, in one currency (spec 3): every payment
 * made, plus what is still set aside. So paying as planned changes nothing, paying
 * more lowers free money by the gap at once, and marking one finished after paying
 * less gives the rest back.
 */
export function commitmentsOutMinor(list: CommitmentEntry[], expectedSalaryOn: Day, currency: string): Minor {
  let total = setAsideMinor(list, expectedSalaryOn, currency);
  for (const c of list) total += paidMinor(c, currency);
  return total;
}

export interface NextUpItem<C> {
  commitment: C;
  /** Days from today to the due day; below zero when late. */
  inDays: number;
}

export interface NextUp<C> {
  /** Open commitments of this cycle by due day (late ones first), then name. */
  items: NextUpItem<C>[];
  /** What is still to pay on `items`, in the spending currency: the money still set aside. */
  totalMinor: Minor;
  /** Days from today to "Salary expected". */
  salaryInDays: number;
  /** Open commitments due after the expected salary day: next cycle's, outside the total. */
  comingUp: NextUpItem<C>[];
}

/** Today's "Next up · already set aside" list (spec 10); `currency` is the spending currency. */
export function nextUp<C extends CommitmentEntry & { name: string }>(
  list: C[],
  today: Day,
  expectedSalaryOn: Day,
  currency: string,
): NextUp<C> {
  const open = list
    .filter((c) => c.state === "open")
    .sort((a, b) => (a.dueOn === b.dueOn ? a.name.localeCompare(b.name) : a.dueOn < b.dueOn ? -1 : 1))
    .map((commitment) => ({ commitment, inDays: daysBetween(today, commitment.dueOn) }));
  const items = open.filter((i) => inThisCycle(i.commitment.dueOn, expectedSalaryOn));
  return {
    items,
    totalMinor: setAsideMinor(list, expectedSalaryOn, currency),
    salaryInDays: daysBetween(today, expectedSalaryOn),
    comingUp: open.filter((i) => !inThisCycle(i.commitment.dueOn, expectedSalaryOn)),
  };
}

export interface CommitmentInput {
  name: string;
  plannedMinor: number;
  dueOn: string;
  currency: string;
}

export interface CommitmentContext extends Currencies {
  cycleStartedOn: Day;
}

export type CommitmentProblem = "name" | "amount" | "due_on" | "currency";

export const NAME_MAX = 80;

/** Checks a new or changed commitment (spec 3). The phone shows the problems; the server refuses them. */
export function checkCommitment(input: CommitmentInput, ctx: CommitmentContext): CommitmentProblem[] {
  const out: CommitmentProblem[] = [];
  const name = input.name.trim();
  if (!name || name.length > NAME_MAX) out.push("name");
  if (!Number.isSafeInteger(input.plannedMinor) || input.plannedMinor <= 0) out.push("amount");
  if (!isDay(input.dueOn) || input.dueOn < ctx.cycleStartedOn) out.push("due_on");
  // Either of the user's currencies (spec 8).
  if (!isUsersCurrency(input.currency, ctx)) out.push("currency");
  return out;
}

export interface PaymentInput {
  amountMinor: number;
  paidOn: string;
  currency: string;
}

export interface PaymentContext {
  today: Day;
  /** Payments are dated within the current cycle, up to today (spec 2, 3). */
  cycleStartedOn: Day;
  /** The commitment's currency. */
  currency: string;
}

export type PaymentProblem = "amount" | "paid_on" | "currency";

/** Checks a new or changed payment (spec 3). Paid more or less than planned is fine. */
export function checkPayment(input: PaymentInput, ctx: PaymentContext): PaymentProblem[] {
  const out: PaymentProblem[] = [];
  if (!Number.isSafeInteger(input.amountMinor) || input.amountMinor <= 0) out.push("amount");
  if (!isDay(input.paidOn) || input.paidOn < ctx.cycleStartedOn || input.paidOn > ctx.today) {
    out.push("paid_on");
  }
  // In the commitment's own currency until item 17 (paid in the other currency).
  if (input.currency !== ctx.currency) out.push("currency");
  return out;
}
