import type { Minor } from "./amount";
import { type Day, daysBetween, isDay } from "./days";

/** `commitment.state` (data-model.md). Only open ones are set aside. */
export type CommitmentState = "open" | "finished" | "carried" | "dropped";

/** One `commitment` row, as the money rules need it. */
export interface CommitmentEntry {
  dueOn: Day;
  currency: string;
  plannedMinor: Minor;
  state: CommitmentState;
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

/**
 * Money set aside for this cycle's open commitments, in one currency (spec 1, 3).
 * Payments (item 6) will lower it to "still to pay".
 */
export function setAsideMinor(list: CommitmentEntry[], expectedSalaryOn: Day, currency: string): Minor {
  let total = 0;
  for (const c of list) {
    if (c.currency === currency && isSetAside(c, expectedSalaryOn)) total += c.plannedMinor;
  }
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
  /** Total of `items` in the spending currency: what free money is lowered by. */
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

export interface CommitmentContext {
  cycleStartedOn: Day;
  spendingCurrency: string;
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
  // One currency until item 15 (two currencies).
  if (input.currency !== ctx.spendingCurrency) out.push("currency");
  return out;
}
