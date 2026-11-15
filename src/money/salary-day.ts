import type { Minor } from "./amount";
import {
  type CommitmentEntry,
  checkCommitment,
  inThisCycle,
  type PaymentEntry,
  setAsideMinor,
  stillToPayMinor,
} from "./commitment";
import { type TodayView, todayView } from "./cycle";
import { type Day, daysBetween, isDay } from "./days";
import { checkPot, type PotEntry } from "./pot";
import type { Speed } from "./speed";

/** Kinds a recurring ("Every cycle") commitment can be until cards, plans and people (items 18–20). */
export type RecurringKind = "bill" | "savings";

/** One `recurring_commitment` row: the "Every cycle" template (spec 3). */
export interface RecurringEntry {
  id: string;
  name: string;
  kind: RecurringKind;
  currency: string;
  /** The last amount. */
  usualAmountMinor: Minor;
  /** The last due date's day of the month (1–31). */
  usualDay: number;
  /** Off: paused, not filled in on salary day. */
  active: boolean;
}

/** The day of the month a due date falls on: what "Every cycle" keeps (spec 3). */
export function usualDayOf(dueOn: Day): number {
  return Number(dueOn.slice(8, 10));
}

function lastDayOfMonth(year: number, month0: number): number {
  return new Date(Date.UTC(year, month0 + 1, 0)).getUTCDate();
}

/**
 * The due date a recurring commitment gets in a new cycle: the first day on or
 * after the cycle's start with its usual day of the month (a day past the month's
 * end falls on its last day).
 */
export function dueOnFrom(startedOn: Day, usualDay: number): Day {
  const [y, m] = startedOn.split("-").map(Number) as [number, number];
  for (let off = 0; off < 2; off++) {
    const first = new Date(Date.UTC(y, m - 1 + off, 1));
    const yy = first.getUTCFullYear();
    const mm = first.getUTCMonth();
    const dd = Math.min(usualDay, lastDayOfMonth(yy, mm));
    const candidate = new Date(Date.UTC(yy, mm, dd)).toISOString().slice(0, 10);
    if (candidate >= startedOn) return candidate;
  }
  throw new Error("unreachable");
}

/** A last-cycle commitment due after its expected salary day: it belongs to the new cycle (spec 3). */
export interface ComingUpEntry extends CommitmentEntry {
  id: string;
  recurringId: string | null;
  name: string;
  kind: RecurringKind | "savings_payback";
  prepaymentId?: string | null;
  payments?: PaymentEntry[];
}

/** One row of salary day's step 4, before the user changes it. */
export interface SalaryDayDraft {
  /** The template it was filled from, or that "Every cycle" makes. */
  recurringId: string | null;
  /** Last cycle's coming-up commitment it carries on (that one is marked carried). */
  carriedFromId: string | null;
  name: string;
  /** A payback to savings is filled by its prepayment (item 14), never Every cycle. */
  kind: RecurringKind | "savings_payback";
  plannedMinor: Minor;
  dueOn: Day;
  everyCycle: boolean;
  /** The prepayment a payback to savings pays back (item 14). */
  prepaymentId?: string;
}

/**
 * Step 4's rows (spec 3, 6): last cycle's open commitments due after its salary
 * day, with what is still to pay, then every active recurring commitment with
 * its last amount and day. A coming-up one made from a recurring one stands in
 * for that one. By due date, then name.
 */
export function salaryDayDrafts(a: {
  recurring: RecurringEntry[];
  comingUp: ComingUpEntry[];
  startedOn: Day;
}): SalaryDayDraft[] {
  const rows: SalaryDayDraft[] = [];
  const covered = new Set<string>();
  for (const c of a.comingUp) {
    if (c.state !== "open") continue;
    const rest = stillToPayMinor(c);
    if (c.recurringId) covered.add(c.recurringId);
    if (rest <= 0) continue;
    const template = a.recurring.find((r) => r.id === c.recurringId);
    rows.push({
      recurringId: template ? template.id : null,
      carriedFromId: c.id,
      name: c.name,
      kind: c.kind,
      plannedMinor: rest,
      dueOn: c.dueOn,
      everyCycle: template !== undefined,
      ...(c.prepaymentId ? { prepaymentId: c.prepaymentId } : {}),
    });
  }
  for (const r of a.recurring) {
    if (!r.active || covered.has(r.id)) continue;
    rows.push({
      recurringId: r.id,
      carriedFromId: null,
      name: r.name,
      kind: r.kind,
      plannedMinor: r.usualAmountMinor,
      dueOn: dueOnFrom(a.startedOn, r.usualDay),
      everyCycle: true,
    });
  }
  return rows.sort((x, y) =>
    x.dueOn === y.dueOn ? x.name.localeCompare(y.name) : x.dueOn < y.dueOn ? -1 : 1,
  );
}

/**
 * The gap (spec 2): commitments set aside in the new cycle plus pot amounts, less
 * the salary and the free money last cycle brings in (item 12), when they are
 * more; else 0. Savings set-asides are commitments.
 */
export function salaryDayGapMinor(a: {
  salaryMinor: Minor;
  expectedSalaryOn: Day;
  currency: string;
  commitments: CommitmentEntry[];
  pots: PotEntry[];
  /** Free money from last cycle: leftover kept plus carried ones' money (less an overspend taken). */
  broughtInMinor?: Minor;
}): Minor {
  let total = setAsideMinor(a.commitments, a.expectedSalaryOn, a.currency);
  for (const p of a.pots) if (p.currency === a.currency && !p.archived) total += p.amountMinor;
  return Math.max(0, total - a.salaryMinor - (a.broughtInMinor ?? 0));
}

export interface SalaryDayInput {
  /** In the salary currency (one currency until item 15). */
  salaryMinor: number;
  receivedOn: string;
  expectedSalaryOn: string;
  commitments: { name: string; plannedMinor: number; dueOn: string }[];
  pots: { name: string; usualAmountMinor: number; amountMinor: number }[];
}

export interface SalaryDayContext {
  today: Day;
  /** The cycle that ends: the salary can't be dated before it started. */
  cycleStartedOn: Day;
  spendingCurrency: string;
}

/** "salary", "received_on", "expected_salary_on", "commitment.<i>.<problem>", "pot.<i>.<problem>". */
export type SalaryDayProblem = string;

/** Checks Start new cycle (spec 2, 6). The phone shows the problems; the server refuses them. */
export function checkSalaryDay(input: SalaryDayInput, ctx: SalaryDayContext): SalaryDayProblem[] {
  const out: SalaryDayProblem[] = [];
  out.push(...checkSalaryAmount(input.salaryMinor));
  const receivedOk =
    isDay(input.receivedOn) && input.receivedOn >= ctx.cycleStartedOn && input.receivedOn <= ctx.today;
  if (!receivedOk) out.push("received_on");
  out.push(...checkExpectedSalaryDay(input.expectedSalaryOn, ctx.today));
  const startedOn = receivedOk ? input.receivedOn : ctx.today;
  input.commitments.forEach((c, i) => {
    const problems = checkCommitment(
      { ...c, currency: ctx.spendingCurrency },
      { cycleStartedOn: startedOn, spendingCurrency: ctx.spendingCurrency },
    );
    for (const p of problems) out.push(`commitment.${i}.${p}`);
  });
  input.pots.forEach((p, i) => {
    const problems = checkPot({ ...p, currency: ctx.spendingCurrency }, ctx);
    for (const q of problems) out.push(`pot.${i}.${q}`);
  });
  return out;
}

/** The salary amount, on salary day or changed later in the current cycle (spec 2): above zero. */
export function checkSalaryAmount(salaryMinor: number): "salary"[] {
  return Number.isSafeInteger(salaryMinor) && salaryMinor > 0 ? [] : ["salary"];
}

/**
 * The expected salary day, on salary day or changed later (spec 2): after today,
 * so today at least is left to count. A late salary's new day is the same check.
 */
export function checkExpectedSalaryDay(day: string, today: Day): "expected_salary_on"[] {
  return isDay(day) && day > today ? [] : ["expected_salary_on"];
}

/** Salary late (spec 2): the expected salary day has come with no salary entered in this cycle. */
export function isSalaryLate(today: Day, expectedSalaryOn: Day): boolean {
  return today >= expectedSalaryOn;
}

/** How many days late the salary is: 0 on the expected day itself. */
export function lateSalaryDays(today: Day, expectedSalaryOn: Day): number {
  return Math.max(0, daysBetween(expectedSalaryOn, today));
}

export interface SalaryDayView {
  /** The new cycle's Today numbers on its first day. */
  today: TodayView;
  gapMinor: Minor;
}

/**
 * Step 7's summary (spec 6): the new cycle's free money, daily allowance and
 * verdict (from the cycle that ends in the first days), and the gap. With what
 * last cycle brings in (its `leftover` income) and the commitments carried from
 * step 2, set aside again in the new cycle.
 */
export function salaryDayView(a: {
  input: SalaryDayInput;
  spendingCurrency: string;
  today: Day;
  lastSpeed: Speed | null;
  broughtIn?: { amountMinor: Minor; toSavingsMinor: Minor } | null;
  carried?: CommitmentEntry[];
}): SalaryDayView {
  const cur = a.spendingCurrency;
  const { input } = a;
  const commitments: CommitmentEntry[] = [
    ...input.commitments.map((c) => ({
      currency: cur,
      plannedMinor: c.plannedMinor,
      dueOn: c.dueOn,
      state: "open" as const,
    })),
    ...(a.carried ?? []),
  ];
  const pots: PotEntry[] = input.pots.map((p, i) => ({
    id: `new-${i}`,
    currency: cur,
    amountMinor: p.amountMinor,
    archived: false,
  }));
  const startedOn = input.receivedOn <= a.today ? input.receivedOn : a.today;
  const today = todayView(
    {
      spendingCurrency: cur,
      startedOn,
      expectedSalaryOn: input.expectedSalaryOn,
      incomes: [
        {
          kind: "salary",
          currency: cur,
          amountMinor: input.salaryMinor,
          toSavingsMinor: 0,
          receivedOn: startedOn,
        },
        ...(a.broughtIn
          ? [{ kind: "leftover" as const, currency: cur, ...a.broughtIn, receivedOn: startedOn }]
          : []),
      ],
      spends: [],
      commitments,
      pots,
      lastSpeed: a.lastSpeed,
    },
    a.today,
  );
  const gapMinor = salaryDayGapMinor({
    salaryMinor: input.salaryMinor,
    expectedSalaryOn: input.expectedSalaryOn,
    currency: cur,
    commitments,
    pots,
    broughtInMinor: a.broughtIn ? a.broughtIn.amountMinor - a.broughtIn.toSavingsMinor : 0,
  });
  return { today, gapMinor };
}

/** Whether a commitment of the cycle that ends belongs to the next one (spec 3). */
export function isComingUp(c: Pick<CommitmentEntry, "dueOn" | "state">, expectedSalaryOn: Day): boolean {
  return c.state === "open" && !inThisCycle(c.dueOn, expectedSalaryOn);
}
