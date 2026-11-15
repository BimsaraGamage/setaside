import { isCurrency, type Minor, unitMinor } from "./amount";
import { type CommitmentEntry, commitmentsOutMinor } from "./commitment";
import { type Day, daysBetween, isDay, isTimeZone } from "./days";
import { inAPot, type PotEntry, potOutMinor } from "./pot";
import type { SpendEntry } from "./spend";

/** Kinds of `income` rows (data-model.md). */
export type IncomeKind = "salary" | "extra" | "opening" | "loan" | "borrowed" | "paid_back";

export interface IncomeEntry {
  kind: IncomeKind;
  currency: string;
  amountMinor: Minor;
  /** Part sent to savings; the rest is free money. */
  toSavingsMinor: Minor;
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
 * The counting rate joins in a later item.
 */
export function freeMoney(
  entries: Pick<CycleEntries, "spendingCurrency" | "incomes"> &
    Partial<Pick<CycleEntries, "spends" | "commitments" | "expectedSalaryOn" | "pots">>,
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
    if (i.currency !== cur) continue;
    total += i.amountMinor - i.toSavingsMinor;
  }
  for (const s of spends) {
    if (s.currency !== cur || inAPot(s, pots)) continue;
    if (startOf !== undefined && s.spentOn >= startOf) continue;
    total -= s.amountMinor;
  }
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
}

/** Everything the Today main card shows (spec 7, 10). */
export function todayView(entries: CycleEntries, today: Day): TodayView {
  const cur = entries.spendingCurrency;
  const freeMinor = freeMoney(entries);
  const startMinor = freeMoney(entries, today);
  const days = daysLeft(today, entries.expectedSalaryOn);
  const allowanceMinor = dailyAllowance(startMinor, days, cur);
  // Spends are dated up to today, so the start-of-day free money differs only by today's.
  const spentTodayMinor = startMinor - freeMinor;
  return {
    freeMinor,
    daysLeft: days,
    allowanceMinor,
    spentTodayMinor,
    leftTodayMinor: allowanceMinor - spentTodayMinor,
    tomorrowMinor: days >= 2 ? dailyAllowance(freeMinor, days - 1, cur) : null,
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
