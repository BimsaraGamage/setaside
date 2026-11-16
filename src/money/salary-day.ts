import type { Minor } from "./amount";
import {
  type CommitmentEntry,
  checkCommitment,
  inThisCycle,
  type PaymentEntry,
  setAsideMinor,
  stillToPayMinor,
} from "./commitment";
import { countedMinor, otherCurrency, type TodayView, todayView } from "./cycle";
import { type Day, daysBetween, isDay } from "./days";
import { checkPot, type PotEntry } from "./pot";
import { isRate, type Rate } from "./rate";
import type { Speed } from "./speed";

/** Kinds a recurring ("Every cycle") commitment can be until plans and people (items 19, 20). */
export type RecurringKind = "bill" | "savings" | "card_bill";

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
  /** A card bill's card (item 18): filled from that card's balance, not the last amount. */
  cardId?: string | null;
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
  kind: RecurringKind | "savings_payback" | "plan_payment";
  prepaymentId?: string | null;
  cardId?: string | null;
  planId?: string | null;
  payments?: PaymentEntry[];
}

/** One row of salary day's step 4, before the user changes it. */
export interface SalaryDayDraft {
  /** The template it was filled from, or that "Every cycle" makes. */
  recurringId: string | null;
  /** Last cycle's coming-up commitment it carries on (that one is marked carried). */
  carriedFromId: string | null;
  name: string;
  /** A payback to savings is filled by its prepayment (item 14), a plan payment by its plan (item 19); never Every cycle. */
  kind: RecurringKind | "savings_payback" | "plan_payment";
  /** Its currency (spec 8): the template's or the coming-up commitment's. */
  currency: string;
  plannedMinor: Minor;
  dueOn: Day;
  everyCycle: boolean;
  /** The prepayment a payback to savings pays back (item 14). */
  prepaymentId?: string;
  /** A card bill's card (item 18). */
  cardId?: string;
  /** A plan payment's instalment plan (item 19). */
  planId?: string;
}

/**
 * Step 4's rows (spec 3, 6): last cycle's open commitments due after its salary
 * day, with what is still to pay, then every active recurring commitment with
 * its last amount and day. A coming-up one made from a recurring one stands in
 * for that one. A card bill's template (item 18) is filled from its card:
 * `cardFill` gives the amount (the balance less what other open bills of the
 * card still owe); none or nothing owed leaves it out. By due date, then name.
 */
export function salaryDayDrafts(a: {
  recurring: RecurringEntry[];
  comingUp: ComingUpEntry[];
  startedOn: Day;
  cardFill?: (cardId: string) => Minor;
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
      currency: c.currency,
      plannedMinor: rest,
      dueOn: c.dueOn,
      everyCycle: template !== undefined,
      ...(c.prepaymentId ? { prepaymentId: c.prepaymentId } : {}),
      ...(c.cardId ? { cardId: c.cardId } : {}),
      ...(c.planId ? { planId: c.planId } : {}),
    });
  }
  for (const r of a.recurring) {
    if (!r.active || covered.has(r.id)) continue;
    const card = r.kind === "card_bill" ? r.cardId : undefined;
    const plannedMinor = card ? (a.cardFill?.(card) ?? 0) : r.usualAmountMinor;
    if (r.kind === "card_bill" && (!card || plannedMinor <= 0)) continue;
    rows.push({
      recurringId: r.id,
      carriedFromId: null,
      name: r.name,
      kind: r.kind,
      currency: r.currency,
      plannedMinor,
      dueOn: dueOnFrom(a.startedOn, r.usualDay),
      everyCycle: true,
      ...(card ? { cardId: card } : {}),
    });
  }
  return rows.sort((x, y) =>
    x.dueOn === y.dueOn ? x.name.localeCompare(y.name) : x.dueOn < y.dueOn ? -1 : 1,
  );
}

/**
 * The gap (spec 2): commitments set aside in the new cycle plus pot amounts, less
 * the salary and the free money last cycle brings in (item 12), when they are
 * more; else 0. Savings set-asides are commitments. With two currencies (spec 8)
 * everything is compared in the spending currency, the salary currency's at the
 * counting rate.
 */
export function salaryDayGapMinor(a: {
  salaryMinor: Minor;
  expectedSalaryOn: Day;
  currency: string;
  salaryCurrency?: string;
  countingRate?: Rate | null;
  commitments: CommitmentEntry[];
  pots: PotEntry[];
  /** Free money from last cycle: leftover kept plus carried ones' money (less an overspend taken). */
  broughtInMinor?: Minor;
  /** Two currencies: what last cycle brings in, in the salary currency. */
  broughtInSalaryMinor?: Minor;
}): Minor {
  const two = {
    spendingCurrency: a.currency,
    salaryCurrency: a.salaryCurrency,
    countingRate: a.countingRate,
  };
  const other = otherCurrency(two);
  const netIn = (cur: string, salary: Minor, brought: Minor) => {
    let total = setAsideMinor(a.commitments, a.expectedSalaryOn, cur);
    for (const p of a.pots) if (p.currency === cur && !p.archived) total += p.amountMinor;
    return total - salary - brought;
  };
  if (!other) return Math.max(0, netIn(a.currency, a.salaryMinor, a.broughtInMinor ?? 0));
  const own = netIn(a.currency, 0, a.broughtInMinor ?? 0);
  // Salary-currency set-asides less the salary: what is left over counts toward the rest.
  const fromSalary = -netIn(other, a.salaryMinor, a.broughtInSalaryMinor ?? 0);
  return Math.max(0, own - countedMinor(two, fromSalary));
}

export interface SalaryDayInput {
  /** In the salary currency (spec 2, 8). */
  salaryMinor: number;
  receivedOn: string;
  expectedSalaryOn: string;
  /** Each in either currency (spec 8); none: the spending currency. */
  commitments: { name: string; plannedMinor: number; dueOn: string; currency?: string; kind?: string }[];
  pots: { name: string; usualAmountMinor: number; amountMinor: number; currency?: string }[];
  /** Step 6, two currencies (spec 6, 8): a new counting rate; none keeps the current one. */
  countingRate?: Rate | null;
}

export interface SalaryDayContext {
  today: Day;
  /** The cycle that ends: the salary can't be dated before it started. */
  cycleStartedOn: Day;
  spendingCurrency: string;
  salaryCurrency?: string;
}

/** "salary", "received_on", "expected_salary_on", "counting_rate", "commitment.<i>.<problem>", "pot.<i>.<problem>". */
export type SalaryDayProblem = string;

/** Checks Start new cycle (spec 2, 6). The phone shows the problems; the server refuses them. */
export function checkSalaryDay(input: SalaryDayInput, ctx: SalaryDayContext): SalaryDayProblem[] {
  const out: SalaryDayProblem[] = [];
  out.push(...checkSalaryAmount(input.salaryMinor));
  const receivedOk =
    isDay(input.receivedOn) && input.receivedOn >= ctx.cycleStartedOn && input.receivedOn <= ctx.today;
  if (!receivedOk) out.push("received_on");
  out.push(...checkExpectedSalaryDay(input.expectedSalaryOn, ctx.today));
  // A one-currency user has no counting rate (spec 8).
  const rate = input.countingRate;
  if (rate != null && (!ctx.salaryCurrency || !isRate(rate))) out.push("counting_rate");
  const startedOn = receivedOk ? input.receivedOn : ctx.today;
  const currencies = ctx.salaryCurrency
    ? { spendingCurrency: ctx.spendingCurrency, salaryCurrency: ctx.salaryCurrency }
    : { spendingCurrency: ctx.spendingCurrency };
  input.commitments.forEach((c, i) => {
    const problems = checkCommitment(
      { ...c, currency: c.currency ?? ctx.spendingCurrency },
      { ...currencies, cycleStartedOn: startedOn },
    );
    for (const p of problems) out.push(`commitment.${i}.${p}`);
  });
  input.pots.forEach((p, i) => {
    const problems = checkPot({ ...p, currency: p.currency ?? ctx.spendingCurrency }, currencies);
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
  /** Two currencies (spec 8): the salary is in it; its money counts at the counting rate. */
  salaryCurrency?: string;
  countingRate?: Rate | null;
  today: Day;
  lastSpeed: Speed | null;
  broughtIn?: { amountMinor: Minor; toSavingsMinor: Minor } | null;
  /** What last cycle brings in, in the salary currency (all of it to the new cycle, item 15). */
  broughtInSalaryMinor?: Minor;
  carried?: CommitmentEntry[];
}): SalaryDayView {
  const cur = a.spendingCurrency;
  const { input } = a;
  const two = { salaryCurrency: a.salaryCurrency, countingRate: a.countingRate ?? null };
  const salaryCur = otherCurrency({ spendingCurrency: cur, ...two }) ?? cur;
  const commitments: CommitmentEntry[] = [
    ...input.commitments.map((c) => ({
      kind: c.kind,
      currency: c.currency ?? cur,
      plannedMinor: c.plannedMinor,
      dueOn: c.dueOn,
      state: "open" as const,
    })),
    ...(a.carried ?? []),
  ];
  const pots: PotEntry[] = input.pots.map((p, i) => ({
    id: `new-${i}`,
    currency: p.currency ?? cur,
    amountMinor: p.amountMinor,
    archived: false,
  }));
  const startedOn = input.receivedOn <= a.today ? input.receivedOn : a.today;
  const today = todayView(
    {
      spendingCurrency: cur,
      ...two,
      startedOn,
      expectedSalaryOn: input.expectedSalaryOn,
      incomes: [
        {
          kind: "salary",
          currency: salaryCur,
          amountMinor: input.salaryMinor,
          toSavingsMinor: 0,
          receivedOn: startedOn,
        },
        ...(a.broughtIn
          ? [{ kind: "leftover" as const, currency: cur, ...a.broughtIn, receivedOn: startedOn }]
          : []),
        ...(a.broughtInSalaryMinor && salaryCur !== cur
          ? [
              {
                kind: "leftover" as const,
                currency: salaryCur,
                amountMinor: a.broughtInSalaryMinor,
                toSavingsMinor: 0,
                receivedOn: startedOn,
              },
            ]
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
    ...two,
    commitments,
    pots,
    broughtInMinor: a.broughtIn ? a.broughtIn.amountMinor - a.broughtIn.toSavingsMinor : 0,
    broughtInSalaryMinor: a.broughtInSalaryMinor ?? 0,
  });
  return { today, gapMinor };
}

/** Whether a commitment of the cycle that ends belongs to the next one (spec 3). */
export function isComingUp(c: Pick<CommitmentEntry, "dueOn" | "state">, expectedSalaryOn: Day): boolean {
  return c.state === "open" && !inThisCycle(c.dueOn, expectedSalaryOn);
}
