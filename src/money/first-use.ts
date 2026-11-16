import { isCurrency, type Minor } from "./amount";
import { type CommitmentEntry, checkCommitment, setAsideMinor } from "./commitment";
import { countedMinor, type TodayView, todayView } from "./cycle";
import { type Day, isDay, isTimeZone } from "./days";
import { checkPot, type PotEntry } from "./pot";
import { isRate } from "./rate";

/** One bill of first use's step 4 (spec 2): only ones still unpaid. */
export interface FirstUseBill {
  name: string;
  /** Either currency (spec 8); none: the spending currency. */
  currency?: string;
  plannedMinor: number;
  dueOn: string;
}

/** One pot of first use's step 4: new, its amount this cycle is also its usual amount. */
export interface FirstUsePot {
  name: string;
  /** Either currency (spec 8); none: the spending currency. */
  currency?: string;
  amountMinor: number;
}

export interface FirstUseInput {
  salaryCurrency: string;
  spendingCurrency: string;
  homeTimeZone: string;
  usualPayDay: number;
  /** Money held now, in the spending currency. */
  heldMinor: Minor;
  /** Money held now in the salary currency, when it differs (spec 2, 8). */
  heldSalaryMinor?: Minor;
  /** The counting rate (spec 8): needed when the currencies differ. */
  countingRate?: string | null;
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
  if (!isCurrency(input.salaryCurrency)) out.push("salary_currency");
  const two = input.salaryCurrency !== cur;
  const ctx = two
    ? { spendingCurrency: cur, salaryCurrency: input.salaryCurrency }
    : { spendingCurrency: cur };
  if (two) {
    const held = input.heldSalaryMinor ?? 0;
    if (!Number.isSafeInteger(held) || held < 0) out.push("held_salary");
    if (!isRate(input.countingRate)) out.push("counting_rate");
  } else if (input.heldSalaryMinor || input.countingRate) {
    // One currency: nothing to hold apart and nothing to count (spec 8).
    out.push("held_salary");
  }
  if (!isTimeZone(input.homeTimeZone)) out.push("home_time_zone");
  if (!Number.isInteger(input.usualPayDay) || input.usualPayDay < 1 || input.usualPayDay > 31) {
    out.push("usual_pay_day");
  }
  if (!Number.isSafeInteger(input.heldMinor) || input.heldMinor < 0) out.push("held");
  if (!isDay(input.expectedSalaryOn) || input.expectedSalaryOn <= today) out.push("expected_salary_on");
  // The first cycle starts today: a bill already late is put on today.
  (input.commitments ?? []).forEach((c, i) => {
    const problems = checkCommitment(
      { ...c, currency: c.currency ?? cur },
      { cycleStartedOn: today, ...ctx },
    );
    for (const p of problems) out.push(`commitment.${i}.${p}`);
  });
  (input.pots ?? []).forEach((p, i) => {
    const problems = checkPot({ ...p, usualAmountMinor: p.amountMinor, currency: p.currency ?? cur }, ctx);
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
  /** How much the set-asides pass the money held by; else 0 (spec 2). In the spending currency. */
  gapMinor: Minor;
}

/** First use's summary (spec 2, 6 step 7): the first cycle's numbers and the gap. */
export function firstUseView(a: {
  heldMinor: Minor;
  spendingCurrency: string;
  /** Two currencies (spec 8): the salary currency, money held in it and the counting rate. */
  salaryCurrency?: string;
  heldSalaryMinor?: Minor;
  countingRate?: string | null;
  today: Day;
  expectedSalaryOn: Day;
  commitments: FirstUseBill[];
  pots: FirstUsePot[];
}): FirstUseView {
  const cur = a.spendingCurrency;
  const two = { salaryCurrency: a.salaryCurrency, countingRate: a.countingRate ?? null };
  const salaryCur = a.salaryCurrency && a.salaryCurrency !== cur ? a.salaryCurrency : null;
  const commitments: CommitmentEntry[] = a.commitments.map((c) => ({
    currency: c.currency ?? cur,
    plannedMinor: c.plannedMinor,
    dueOn: c.dueOn,
    state: "open",
  }));
  const pots: PotEntry[] = a.pots.map((p, i) => ({
    id: `new-${i}`,
    currency: p.currency ?? cur,
    amountMinor: p.amountMinor,
    archived: false,
  }));
  const today = todayView(
    {
      spendingCurrency: cur,
      ...two,
      startedOn: a.today,
      expectedSalaryOn: a.expectedSalaryOn,
      incomes: [
        { kind: "opening", currency: cur, amountMinor: a.heldMinor, toSavingsMinor: 0 },
        ...(salaryCur
          ? [
              {
                kind: "opening" as const,
                currency: salaryCur,
                amountMinor: a.heldSalaryMinor ?? 0,
                toSavingsMinor: 0,
              },
            ]
          : []),
      ],
      spends: [],
      commitments,
      pots,
      lastSpeed: null,
    },
    a.today,
  );
  // Both currencies in the spending currency, the salary currency's at the counting rate.
  const inSpending = (own: Minor, other: Minor) =>
    own + countedMinor({ spendingCurrency: cur, ...two }, other);
  const setAside = inSpending(
    setAsideMinor(commitments, a.expectedSalaryOn, cur),
    salaryCur ? setAsideMinor(commitments, a.expectedSalaryOn, salaryCur) : 0,
  );
  const potsIn = (c: string) =>
    pots.reduce((t, p) => t + (p.currency === c ? Math.max(0, p.amountMinor) : 0), 0);
  const potsMinor = inSpending(potsIn(cur), salaryCur ? potsIn(salaryCur) : 0);
  const held = inSpending(a.heldMinor, salaryCur ? (a.heldSalaryMinor ?? 0) : 0);
  return {
    today,
    setAsideMinor: setAside,
    potsMinor,
    gapMinor: Math.max(0, setAside + potsMinor - held),
  };
}
