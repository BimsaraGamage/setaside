import type { Minor, Money } from "./amount";
import { type CommitmentEntry, coveredMinor, stillToPayMinor } from "./commitment";
import type { IncomeEntry } from "./cycle";
import type { OverspendChoice } from "./cycle-close";
import { addDays, type Day } from "./days";
import { type PotEntry, type PotView, potView } from "./pot";
import { cycleSpeeds, perDayMinor, type Speed } from "./speed";
import type { SpendEntry } from "./spend";

/**
 * An ended cycle's last day: the day before the next cycle started (spec 2);
 * its first day when the next one started that same day.
 */
export function endedOn(startedOn: Day, nextStartedOn: Day): Day {
  const last = addDays(nextStartedOn, -1);
  return last < startedOn ? startedOn : last;
}

/** Each currency's total, the spending currency first; a currency adding up to nothing is left out. */
export function totalsByCurrency(rows: { currency: string; amountMinor: Minor }[], first: string): Money[] {
  const by = new Map<string, Minor>([[first, 0]]);
  for (const r of rows) by.set(r.currency, (by.get(r.currency) ?? 0) + r.amountMinor);
  return [...by].filter(([, minor]) => minor !== 0).map(([currency, minor]) => ({ currency, minor }));
}

/** One `cycle_close` row (one per currency), as the money rules need it. */
export interface CloseEntry {
  currency: string;
  /** The leftover worked out on salary day (below zero: an overspend); null on cycles closed before item 21. */
  leftoverMinor: Minor | null;
  /** "Actually have in hand" less the leftover worked out. */
  correctionMinor: Minor;
  toSavingsMinor: Minor;
  overspendChoice: OverspendChoice | null;
}

/** How a cycle ended, per currency (spec 6, 10). Null amounts: not kept for cycles closed before item 21. */
export type Ending =
  | {
      currency: string;
      kind: "leftover";
      leftoverMinor: Minor | null;
      /** What was actually in hand: the leftover with its correction; this was split. */
      inHandMinor: Minor | null;
      toSavingsMinor: Minor;
      toNewCycleMinor: Minor | null;
    }
  | { currency: string; kind: "overspend"; overMinor: Minor | null; choice: OverspendChoice };

/**
 * How a cycle ended (spec 6): its leftover, corrected and split into savings and
 * the new cycle; or the overspend, taken from the new cycle or ignored. Dollars
 * below zero carry over whole, so they count as taken. Spending currency first.
 */
export function howItEnded(closes: CloseEntry[], spendingCurrency: string): Ending[] {
  const sorted = [...closes].sort(
    (a, b) => Number(b.currency === spendingCurrency) - Number(a.currency === spendingCurrency),
  );
  return sorted.map((c): Ending => {
    const l = c.leftoverMinor;
    if (c.overspendChoice || (l !== null && l < 0)) {
      return {
        currency: c.currency,
        kind: "overspend",
        overMinor: l === null ? null : -l,
        choice: c.overspendChoice ?? "take",
      };
    }
    const inHand = l === null ? null : l + c.correctionMinor;
    return {
      currency: c.currency,
      kind: "leftover",
      leftoverMinor: l,
      inHandMinor: inHand,
      toSavingsMinor: c.toSavingsMinor,
      toNewCycleMinor: inHand === null ? null : inHand - c.toSavingsMinor,
    };
  });
}

/** A commitment at the end of its cycle: planned vs paid, carried (spec 10). */
export interface CommitmentEnding {
  /** paid · finished with less paid · carried to the next cycle · dropped · unpaid (left open). */
  kind: "paid" | "finished" | "carried" | "dropped" | "unpaid";
  /** What its payments cover, in its own currency. */
  paidMinor: Minor;
  /** Planned less paid, never below zero; for a carried one, what went to the next cycle. */
  restMinor: Minor;
}

export function commitmentEnding(c: CommitmentEntry): CommitmentEnding {
  const paidMinor = coveredMinor(c);
  const restMinor = stillToPayMinor(c);
  const kind =
    c.state === "finished"
      ? restMinor === 0
        ? "paid"
        : "finished"
      : c.state === "open"
        ? "unpaid"
        : c.state;
  return { kind, paidMinor, restMinor };
}

/** One ended cycle's rows (read only). */
export interface PastEntries {
  spendingCurrency: string;
  startedOn: Day;
  /** The next cycle's first day: this one ended the day before. */
  nextStartedOn: Day;
  incomes: IncomeEntry[];
  spends: (SpendEntry & { id: string })[];
  pots: (PotEntry & { name: string })[];
  commitments: (CommitmentEntry & { name: string })[];
  closes: CloseEntry[];
}

export interface PastCycleView<E extends PastEntries> {
  endedOn: Day;
  /** Days it lasted. */
  days: number;
  salary: Money[];
  /** The very first cycle has no salary: what it started with (first use). */
  opening: Money[];
  spent: Money[];
  ending: Ending[];
  /** "Average a day": the spending speed over the whole cycle (spec 7). */
  speed: Speed;
  perDayMinor: Minor;
  commitments: (E["commitments"][number] & { ending: CommitmentEnding })[];
  pots: (E["pots"][number] & PotView)[];
  /** Spends by day, newest first, with each day's total in the spending currency. */
  spendDays: { day: Day; totalMinor: Minor; spends: E["spends"] }[];
}

/** One ended cycle (spec 10): salary, spent, how it ended, average a day, commitments, pots, spends. */
export function pastCycleView<E extends PastEntries>(e: E): PastCycleView<E> {
  const cur = e.spendingCurrency;
  const { speed } = cycleSpeeds(e, e.startedOn, e.nextStartedOn);
  const days = new Map<Day, E["spends"]>();
  for (const s of e.spends) days.set(s.spentOn, [...(days.get(s.spentOn) ?? []), s]);
  return {
    endedOn: endedOn(e.startedOn, e.nextStartedOn),
    days: speed.days,
    salary: totalsByCurrency(
      e.incomes.filter((i) => i.kind === "salary"),
      cur,
    ),
    opening: totalsByCurrency(
      e.incomes.filter((i) => i.kind === "opening"),
      cur,
    ),
    spent: totalsByCurrency(e.spends, cur),
    ending: howItEnded(e.closes, cur),
    speed,
    perDayMinor: perDayMinor(speed),
    commitments: [...e.commitments]
      .sort((a, b) => (a.dueOn === b.dueOn ? a.name.localeCompare(b.name) : a.dueOn < b.dueOn ? -1 : 1))
      .map((k) => ({ ...k, ending: commitmentEnding(k) })),
    pots: e.pots.map((p) => ({ ...p, ...potView(p, e.spends) })),
    spendDays: [...days]
      .sort(([a], [b]) => (a < b ? 1 : -1))
      .map(([day, spends]) => ({
        day,
        totalMinor: spends.reduce((n, s) => n + (s.currency === cur ? s.amountMinor : 0), 0),
        spends,
      })),
  };
}
