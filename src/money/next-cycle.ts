import type { Minor } from "./amount";
import { type CommitmentEntry, inThisCycle, stillToPayMinor } from "./commitment";
import { countedMinor, otherCurrency } from "./cycle";
import { type Day, suggestSalaryDay } from "./days";
import { type PlanEntry, planDrafts } from "./plan";
import { type PrepaymentEntry, paybackDrafts } from "./prepayment";
import type { Rate } from "./rate";
import { type ComingUpEntry, type RecurringEntry, salaryDayDrafts } from "./salary-day";

/** Where a set-aside of the next cycle belongs in the preview (spec 6). */
export type NextCycleGroup = "bills" | "pots" | "savings" | "people" | "plans";

export interface NextCycleItem {
  group: NextCycleGroup;
  name: string;
  currency: string;
  minor: Minor;
}

export interface NextCyclePreview {
  /** The next cycle is counted as starting on this cycle's expected salary day. */
  startsOn: Day;
  items: NextCycleItem[];
  /** Per group, counted in the spending currency (the salary currency's at the counting rate). */
  groups: Record<NextCycleGroup, Minor>;
  /** All set-asides, counted in the spending currency. */
  totalMinor: Minor;
  /** This cycle's salary, counted in the spending currency; null when none came yet (first cycle). */
  salaryMinor: Minor | null;
  /** Salary less the set-asides; null without a salary. Below zero: over. */
  freeMinor: Minor | null;
}

/** A commitment of this cycle as the preview needs it: the salary-day fields plus its links. */
export type PreviewCommitment = CommitmentEntry & Omit<ComingUpEntry, "kind"> & { kind: string };

const GROUP: Record<string, NextCycleGroup> = {
  bill: "bills",
  savings: "savings",
  savings_payback: "savings",
  person_payback: "people",
  plan_payment: "plans",
};

/**
 * Next cycle preview (spec 6): what salary day would set aside if it came on the
 * expected day and this cycle's open commitments were paid as planned. The same
 * rows salary day's step 4 fills (coming-up commitments, active Every cycle ones,
 * prepayment paybacks, plan payments) plus the pots in use at their usual amounts,
 * against this cycle's salary. Card bills are left out: their money is already held
 * (spec 9), as in the salary-day gap.
 */
export function nextCyclePreview(a: {
  spendingCurrency: string;
  salaryCurrency?: string;
  countingRate?: Rate | null;
  expectedSalaryOn: Day;
  usualPayDay: number;
  /** This cycle's salary in the salary currency; null when none came yet. */
  salaryMinor: Minor | null;
  commitments: PreviewCommitment[];
  recurring: RecurringEntry[];
  pots: { name: string; currency: string; usualAmountMinor: Minor; archived: boolean }[];
  prepayments: PrepaymentEntry[];
  plans: PlanEntry[];
}): NextCyclePreview {
  const startsOn = a.expectedSalaryOn;
  const open = a.commitments.filter((c) => c.state === "open");
  const comingUp: ComingUpEntry[] = open
    .filter((c) => !inThisCycle(c.dueOn, a.expectedSalaryOn) && c.kind in GROUP)
    .map((c) => ({ ...c, kind: c.kind as ComingUpEntry["kind"] }));
  const drafts = salaryDayDrafts({ recurring: a.recurring, comingUp, startedOn: startsOn });

  // Paid as planned this cycle; coming-up ones are counted by the drafts above (as salary day does).
  const add = (to: Record<string, Minor>, id: string | null | undefined, m: Minor) => {
    if (id) to[id] = (to[id] ?? 0) + m;
  };
  const paid: Record<string, Minor> = {};
  const planPaid: Record<string, Minor> = {};
  for (const c of open) {
    if (!inThisCycle(c.dueOn, a.expectedSalaryOn)) continue;
    add(paid, c.prepaymentId, stillToPayMinor(c));
    add(planPaid, c.planId, stillToPayMinor(c));
  }
  const planned: Record<string, Minor> = {};
  const planPlanned: Record<string, Minor> = {};
  for (const d of drafts) add(planned, d.prepaymentId, d.plannedMinor);
  for (const d of drafts) add(planPlanned, d.planId, d.plannedMinor);
  const prepayments = a.prepayments.map((p) => ({
    ...p,
    paidBackMinor: p.paidBackMinor + (paid[p.id] ?? 0),
  }));
  const plans = a.plans.map((p) => ({ ...p, paidMinor: p.paidMinor + (planPaid[p.id] ?? 0) }));
  const nextSalaryOn = suggestSalaryDay(startsOn, a.usualPayDay);

  const items: NextCycleItem[] = [
    ...[
      ...drafts,
      ...paybackDrafts(prepayments, startsOn, planned),
      ...planDrafts(plans, startsOn, nextSalaryOn, planPlanned),
    ].flatMap((d) => {
      const group = GROUP[d.kind];
      return group && d.plannedMinor > 0
        ? [{ group, name: d.name, currency: d.currency, minor: d.plannedMinor }]
        : [];
    }),
    ...a.pots
      .filter((p) => !p.archived && p.usualAmountMinor > 0)
      .map((p) => ({
        group: "pots" as const,
        name: p.name,
        currency: p.currency,
        minor: p.usualAmountMinor,
      })),
  ];

  const two = {
    spendingCurrency: a.spendingCurrency,
    salaryCurrency: a.salaryCurrency,
    countingRate: a.countingRate ?? null,
  };
  const other = otherCurrency(two);
  const counted = (minor: Minor, currency: string) =>
    currency === a.spendingCurrency ? minor : currency === other ? countedMinor(two, minor) : 0;
  const groups: Record<NextCycleGroup, Minor> = { bills: 0, pots: 0, savings: 0, people: 0, plans: 0 };
  for (const i of items) groups[i.group] += counted(i.minor, i.currency);
  const totalMinor = Object.values(groups).reduce((n, m) => n + m, 0);
  const salaryMinor = a.salaryMinor === null ? null : counted(a.salaryMinor, other ?? a.spendingCurrency);
  return {
    startsOn,
    items,
    groups,
    totalMinor,
    salaryMinor,
    freeMinor: salaryMinor === null ? null : salaryMinor - totalMinor,
  };
}
