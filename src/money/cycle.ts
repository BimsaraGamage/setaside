import { isCurrency, type Minor, unitMinor } from "./amount";
import { type CommitmentEntry, commitmentsOutMinor } from "./commitment";
import { addDays, type Day, daysBetween, isDay, isTimeZone } from "./days";
import { inAPot, type PotEntry, potOutMinor } from "./pot";
import type { TakeOutEntry } from "./savings";
import { perDayMinor, runOutVerdict, type Speed, speedNow, type Verdict } from "./speed";
import type { SpendEntry } from "./spend";

/** Kinds of `income` rows (data-model.md). */
export type IncomeKind = "salary" | "extra" | "opening" | "loan" | "borrowed" | "paid_back";

export interface IncomeEntry {
  kind: IncomeKind;
  currency: string;
  amountMinor: Minor;
  /** Part sent to savings; the rest is free money. */
  toSavingsMinor: Minor;
  /** Counts in free money from this day on; none: from the cycle's start. */
  receivedOn?: Day;
}

/** The stored entries of the current cycle that the numbers are worked out from. */
export interface CycleEntries {
  spendingCurrency: string;
  expectedSalaryOn: Day;
  incomes: IncomeEntry[];
  spends: SpendEntry[];
  /** This cycle's commitments with their payments; open ones due by the expected salary day are set aside. */
  commitments?: CommitmentEntry[];
  /** The user's pots with this cycle's amounts; their spends come out of the pot first (spec 4). */
  pots?: PotEntry[];
  /** The cycle's first day; the spending speed counts the finished days from it (spec 7). */
  startedOn?: Day;
  /** Last cycle's speed, used in the first 3 days; none on the very first cycle. */
  lastSpeed?: Speed | null;
  /** The stored underspend answers of this cycle (spec 7); the allowance depends on them. */
  dayChoices?: DayChoiceEntry[];
  /** Money taken out of savings into free money in this cycle (spec 5). */
  takenOut?: TakeOutEntry[];
}

/** The morning underspend answer (spec 7): Spread over the days left, or Add to today. */
export type DayChoice = "spread" | "today";

/** One `day_choice` row, as the money rules need it. */
export interface DayChoiceEntry {
  dayOn: Day;
  choice: DayChoice;
}

/**
 * Days left (spec 7): today included, up to the day before the expected salary day.
 * 0 on and after the expected salary day (the late-salary message is item 13).
 */
export function daysLeft(today: Day, expectedSalaryOn: Day): number {
  return Math.max(0, daysBetween(today, expectedSalaryOn));
}

/**
 * Free money (glossary): income to free money less the commitments (paid, and
 * still set aside) and the spends, in the spending currency. With `startOf`, only spends dated before
 * that day count: the free money at the start of that day. Income and commitments
 * always count at once, payments and pot amounts too (spec 7: changes that are
 * not spends recalculate today). A spend in a pot comes out of the pot; only
 * the part past an empty pot comes out of free money (spec 4).
 * Income and money taken out of savings count from the day they came (spec 5):
 * with `startOf`, those dated after it are left out.
 * The counting rate joins in a later item.
 */
export function freeMoney(
  entries: Pick<CycleEntries, "spendingCurrency" | "incomes"> &
    Partial<Pick<CycleEntries, "spends" | "commitments" | "expectedSalaryOn" | "pots" | "takenOut">>,
  startOf?: Day,
): Minor {
  const cur = entries.spendingCurrency;
  const pots = entries.pots ?? [];
  const spends = entries.spends ?? [];
  let total = -potOutMinor(pots, spends, cur, startOf);
  if (entries.commitments && entries.expectedSalaryOn) {
    total -= commitmentsOutMinor(entries.commitments, entries.expectedSalaryOn, cur);
  }
  for (const i of entries.incomes) {
    if (i.currency !== cur || !countsBy(i.receivedOn, startOf)) continue;
    total += i.amountMinor - i.toSavingsMinor;
  }
  for (const t of entries.takenOut ?? []) {
    if (t.currency === cur && countsBy(t.movedOn, startOf)) total += t.amountMinor;
  }
  for (const s of spends) {
    if (s.currency !== cur || inAPot(s, pots)) continue;
    if (startOf !== undefined && s.spentOn >= startOf) continue;
    total -= s.amountMinor;
  }
  return total;
}

/** Money dated `on` counts at the start of `startOf` when it came that day or before. */
function countsBy(on: Day | undefined, startOf: Day | undefined): boolean {
  return startOf === undefined || on === undefined || on <= startOf;
}

/** Income and money taken out of savings that came to free money on that very day. */
function cameOn(entries: CycleEntries, day: Day): Minor {
  const cur = entries.spendingCurrency;
  let total = 0;
  for (const i of entries.incomes) {
    if (i.currency === cur && i.receivedOn === day) total += i.amountMinor - i.toSavingsMinor;
  }
  for (const t of entries.takenOut ?? []) if (t.currency === cur && t.movedOn === day) total += t.amountMinor;
  return total;
}

/**
 * Daily allowance (spec 7): free money ÷ days left, rounded down to a whole unit
 * of the spending currency. 0 when free money is at zero or below. With no days
 * left the whole of it is today's.
 */
export function dailyAllowance(freeMinor: Minor, days: number, currency: string): Minor {
  if (freeMinor <= 0) return 0;
  const unit = unitMinor(currency);
  const perDay = Math.floor(freeMinor / Math.max(1, days));
  return perDay - (perDay % unit);
}

/** The underspend question on Today (spec 7), with what each answer makes today's allowance. */
export interface UnderspendQuestion {
  /** Allowance not spent on the days since the last answer (an overspent day adds nothing). */
  unspentMinor: Minor;
  /** How many days it was added up from (1: yesterday). */
  days: number;
  /** Today's allowance with Spread over the days left: free money at the start of today ÷ days left. */
  spreadMinor: Minor;
  /** Today's allowance with Add to today: the unspent money plus the rest ÷ days left. */
  todayMinor: Minor;
}

/** Today's allowance with the unspent money added on top (spec 7). */
function addedToToday(startMinor: Minor, unspentMinor: Minor, days: number, currency: string): Minor {
  const added = Math.min(unspentMinor, Math.max(0, startMinor));
  return added + dailyAllowance(startMinor - added, days, currency);
}

/**
 * Today's allowance with the underspend answers (spec 7), walking the cycle day by
 * day: each day's allowance is free money at its start ÷ days left, plus the
 * unspent money when that day's answer was Add to today. A day's unspent money is
 * its allowance less its free-money spends, never below zero; days with no answer
 * are added together into the next question. No question on the cycle's first
 * day or its last. `spreadMinor` is the allowance without the added money.
 */
export function allowanceToday(
  entries: CycleEntries,
  today: Day,
): { allowanceMinor: Minor; spreadMinor: Minor; question: UnderspendQuestion | null } {
  const cur = entries.spendingCurrency;
  const choices = new Map((entries.dayChoices ?? []).map((c) => [c.dayOn, c.choice]));
  const first = entries.startedOn && entries.startedOn < today ? entries.startedOn : today;
  let unspent = 0;
  let unspentDays = 0;
  let start = freeMoney(entries, first);
  for (let d = first; ; d = addDays(d, 1)) {
    const days = daysLeft(d, entries.expectedSalaryOn);
    const spread = dailyAllowance(start, days, cur);
    const asks = d > first && days >= 2 && unspent > 0;
    const choice = asks ? choices.get(d) : undefined;
    const allowance = choice === "today" ? addedToToday(start, unspent, days, cur) : spread;
    if (d >= today) {
      const question =
        asks && !choice
          ? {
              unspentMinor: unspent,
              days: unspentDays,
              spreadMinor: spread,
              todayMinor: addedToToday(start, unspent, days, cur),
            }
          : null;
      return { allowanceMinor: allowance, spreadMinor: spread, question };
    }
    if (choice) {
      unspent = 0;
      unspentDays = 0;
    }
    const next = freeMoney(entries, addDays(d, 1));
    // What was spent that day: money that came the next morning is not unspent money.
    const spent = start - (next - cameOn(entries, addDays(d, 1)));
    unspent += Math.max(0, allowance - spent);
    unspentDays += 1;
    start = next;
  }
}

export interface TodayView {
  currency: string;
  /** Free money now, after every spend so far. */
  freeMinor: Minor;
  daysLeft: number;
  /** Today's allowance: from the free money at the start of today, fixed for the day. */
  allowanceMinor: Minor;
  /** Today's spends that came out of free money (a pot's only past its amount). */
  spentTodayMinor: Minor;
  /** Allowance less today's spends; below zero is "Over by". */
  leftTodayMinor: Minor;
  /** Tomorrow's allowance if nothing more is spent today; null on the last day before salary. */
  tomorrowMinor: Minor | null;
  /** Spending speed per day; null while it is too early to tell. */
  speedPerDayMinor: Minor | null;
  /** The speed is last cycle's (first 3 days of a cycle). */
  speedFromLastCycle: boolean;
  /** The run-out verdict, or "Over by" when free money is at zero or below (spec 7). */
  verdict: Verdict;
  /** The underspend question, while it waits for an answer (spec 7). */
  underspend: UnderspendQuestion | null;
}

/** Everything the Today main card shows (spec 7, 10). */
export function todayView(entries: CycleEntries, today: Day): TodayView {
  const cur = entries.spendingCurrency;
  const freeMinor = freeMoney(entries);
  const startMinor = freeMoney(entries, today);
  const days = daysLeft(today, entries.expectedSalaryOn);
  const { allowanceMinor, spreadMinor, question } = allowanceToday(entries, today);
  // Spends are dated up to today, so the start-of-day free money differs only by today's.
  const spentTodayMinor = startMinor - freeMinor;
  const speed = speedNow(entries, today);
  const verdict: Verdict =
    freeMinor <= 0
      ? { kind: "over", overMinor: -freeMinor }
      : // The spread allowance: money added to today does not make the money last longer.
        runOutVerdict({ speed, startMinor, allowanceMinor: spreadMinor, daysLeft: days, today });
  return {
    freeMinor,
    daysLeft: days,
    allowanceMinor,
    spentTodayMinor,
    leftTodayMinor: allowanceMinor - spentTodayMinor,
    tomorrowMinor: days >= 2 ? dailyAllowance(freeMinor, days - 1, cur) : null,
    speedPerDayMinor: speed ? perDayMinor(speed) : null,
    speedFromLastCycle: speed?.lastCycle ?? false,
    verdict,
    underspend: question,
    currency: cur,
  };
}

export interface FirstUseInput {
  salaryCurrency: string;
  spendingCurrency: string;
  homeTimeZone: string;
  usualPayDay: number;
  /** Money held now, in the spending currency (one currency until item 15). */
  heldMinor: Minor;
  expectedSalaryOn: Day;
}

export type FirstUseProblem =
  | "spending_currency"
  | "salary_currency"
  | "home_time_zone"
  | "usual_pay_day"
  | "held"
  | "expected_salary_on";

/** Checks first use (spec 2). The phone shows the problems; the server refuses them. */
export function checkFirstUse(input: FirstUseInput, today: Day): FirstUseProblem[] {
  const out: FirstUseProblem[] = [];
  if (!isCurrency(input.spendingCurrency)) out.push("spending_currency");
  // One currency until item 15 (two currencies).
  if (input.salaryCurrency !== input.spendingCurrency) out.push("salary_currency");
  if (!isTimeZone(input.homeTimeZone)) out.push("home_time_zone");
  if (!Number.isInteger(input.usualPayDay) || input.usualPayDay < 1 || input.usualPayDay > 31) {
    out.push("usual_pay_day");
  }
  if (!Number.isSafeInteger(input.heldMinor) || input.heldMinor < 0) out.push("held");
  if (!isDay(input.expectedSalaryOn) || input.expectedSalaryOn <= today) out.push("expected_salary_on");
  return out;
}
