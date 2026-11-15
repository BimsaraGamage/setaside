import { isCurrency, type Minor } from "./amount";
import { type CommitmentEntry, checkCommitment, setAsideMinor } from "./commitment";
import { type TodayView, todayView } from "./cycle";
import { type Day, isDay, isTimeZone } from "./days";
import { checkPot, type PotEntry } from "./pot";

/** One bill of first use's step 4 (spec 2): only ones still unpaid. */
export interface FirstUseBill {
  name: string;
  plannedMinor: number;
  dueOn: string;
}

/** One pot of first use's step 4: new, its amount this cycle is also its usual amount. */
export interface FirstUsePot {
  name: string;
  amountMinor: number;
}

export interface FirstUseInput {
  salaryCurrency: string;
  spendingCurrency: string;
  homeTimeZone: string;
  usualPayDay: number;
  /** Money held now, in the spending currency (one currency until item 15). */
  heldMinor: Minor;
  expectedSalaryOn: Day;
  commitments?: FirstUseBill[];
  pots?: FirstUsePot[];
}

/**
 * "spending_currency", "salary_currency", "home_time_zone", "usual_pay_day",
 * "held", "expected_salary_on", "commitment.<i>.<problem>", "pot.<i>.<problem>".
 */
export type FirstUseProblem = string;

/** Checks first use (spec 2). The phone shows the problems; the server refuses them. */
export function checkFirstUse(input: FirstUseInput, today: Day): FirstUseProblem[] {
  const out: FirstUseProblem[] = [];
  const cur = input.spendingCurrency;
  if (!isCurrency(cur)) out.push("spending_currency");
  // One currency until item 15 (two currencies).
  if (input.salaryCurrency !== cur) out.push("salary_currency");
  if (!isTimeZone(input.homeTimeZone)) out.push("home_time_zone");
  if (!Number.isInteger(input.usualPayDay) || input.usualPayDay < 1 || input.usualPayDay > 31) {
    out.push("usual_pay_day");
  }
  if (!Number.isSafeInteger(input.heldMinor) || input.heldMinor < 0) out.push("held");
  if (!isDay(input.expectedSalaryOn) || input.expectedSalaryOn <= today) out.push("expected_salary_on");
  // The first cycle starts today: a bill already late is put on today.
  (input.commitments ?? []).forEach((c, i) => {
    const problems = checkCommitment(
      { ...c, currency: cur },
      { cycleStartedOn: today, spendingCurrency: cur },
    );
    for (const p of problems) out.push(`commitment.${i}.${p}`);
  });
  (input.pots ?? []).forEach((p, i) => {
    const problems = checkPot(
      { ...p, usualAmountMinor: p.amountMinor, currency: cur },
      { spendingCurrency: cur },
    );
    for (const q of problems) out.push(`pot.${i}.${q}`);
  });
  return out;
}

export interface FirstUseView {
  /** The first cycle's Today numbers on its first day. */
  today: TodayView;
  /** Bills due by the expected salary day (later ones are coming up only). */
  setAsideMinor: Minor;
  potsMinor: Minor;
  /** How much the set-asides pass the money held by; else 0 (spec 2). */
  gapMinor: Minor;
}

/** First use's summary (spec 2, 6 step 7): the first cycle's numbers and the gap. */
export function firstUseView(a: {
  heldMinor: Minor;
  spendingCurrency: string;
  today: Day;
  expectedSalaryOn: Day;
  commitments: FirstUseBill[];
  pots: FirstUsePot[];
}): FirstUseView {
  const cur = a.spendingCurrency;
  const commitments: CommitmentEntry[] = a.commitments.map((c) => ({
    currency: cur,
    plannedMinor: c.plannedMinor,
    dueOn: c.dueOn,
    state: "open",
  }));
  const pots: PotEntry[] = a.pots.map((p, i) => ({
    id: `new-${i}`,
    currency: cur,
    amountMinor: p.amountMinor,
    archived: false,
  }));
  const today = todayView(
    {
      spendingCurrency: cur,
      startedOn: a.today,
      expectedSalaryOn: a.expectedSalaryOn,
      incomes: [{ kind: "opening", currency: cur, amountMinor: a.heldMinor, toSavingsMinor: 0 }],
      spends: [],
      commitments,
      pots,
      lastSpeed: null,
    },
    a.today,
  );
  const setAside = setAsideMinor(commitments, a.expectedSalaryOn, cur);
  const potsMinor = pots.reduce((t, p) => t + Math.max(0, p.amountMinor), 0);
  return {
    today,
    setAsideMinor: setAside,
    potsMinor,
    gapMinor: Math.max(0, setAside + potsMinor - a.heldMinor),
  };
}
