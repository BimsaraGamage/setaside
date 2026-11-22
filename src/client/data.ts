import { useCallback, useEffect, useState } from "react";
import {
  type CommitmentState,
  cardBalanceMinor,
  currentZoneName,
  currentZoneNames,
  type DayChoiceEntry,
  dayLabel,
  formatMoney,
  type IncomeKind,
  type PlaceKind,
  type ReminderSettings,
  type Speed,
  timeIn,
  todayIn,
  type Verdict,
} from "../money";
import { api } from "./api";

export {
  currentZoneName,
  dayLabel,
  entriesOf,
  inDaysLabel,
  lentNow,
  planExtras,
  potEntry,
  takenOut,
} from "../money";

import { clearCopy, readCopy, saveCopy } from "./offline-copy";

export interface Current {
  settings: {
    salaryCurrency: string;
    spendingCurrency: string;
    homeTimeZone: string;
    usualPayDay: number;
    /** The phone's zone last asked about switching to (item 22); null: never asked. */
    askedTimeZone: string | null;
    /** The counting rate (spec 8); null with one currency or none set. */
    countingRate: string | null;
    /** Settings → Reminders (spec 12, item 25). */
    reminders: ReminderSettings;
    /** The turn-on banner above Today's reminders was dismissed. */
    reminderBannerDismissed: boolean;
  } | null;
  cycle: {
    id: string;
    startedOn: string;
    expectedSalaryOn: string;
    /** Rupee set-asides past the rupees are reserved from the dollars at it (spec 8); null: the counting rate. */
    reserveRate: string | null;
  } | null;
  incomes: {
    id: string;
    kind: IncomeKind;
    currency: string;
    amountMinor: number;
    toSavingsMinor: number;
    receivedOn: string;
  }[];
  spends: Spend[];
  commitments: Commitment[];
  /** Every pot, in use or not, with this cycle's amount (item 7). */
  pots: Pot[];
  /** Every card, in use or not, with what it owed before this cycle (item 18). */
  cards: Card[];
  /** Every instalment plan, oldest first, with what is paid so far (item 19). */
  plans: Plan[];
  /** Money lent to and borrowed from people, oldest first, with what is back so far (item 20). */
  people: Person[];
  /** Places money sits in, in list order, with the balance last typed (ticket SAB-50). */
  places: Place[];
  /** This cycle's conversions, newest first (item 16). */
  conversions: Conversion[];
  /** Last cycle's speeds, used in a cycle's first 3 days; null on the very first cycle (item 8). */
  lastCycle: { speed: Speed; pots: Record<string, Speed> } | null;
  /** This cycle's underspend answers (item 9). */
  dayChoices: DayChoiceEntry[];
  /** Every movement into and out of savings, all cycles, newest first (item 10). */
  savings: SavingsLine[];
  /** Prepayments from savings with their payback so far, oldest first (item 14). */
  prepayments: Prepayment[];
  /** Savings goals, oldest first, with what is moved toward each and their shares (SAB-68). */
  goals: Goal[];
  /** The "Every cycle" templates, paused ones too (item 11). */
  recurring: Recurring[];
  /** Undo salary day is allowed: nothing new entered since salary day started this cycle (item 13). */
  undoSalaryDay: boolean;
}

/** Dollars changed into rupees (item 16, spec 8), with what its rupees did when saved. */
export interface Conversion {
  id: string;
  givenMinor: number;
  receivedMinor: number;
  /** The rate actually got. */
  rate: string;
  /** Rupees that covered rupee set-asides not yet covered (bills first). */
  coveredMinor: number;
  /** The rate gain (to rupee savings) or, below zero, the loss (out of free money). */
  gainMinor: number;
  doneOn: string;
}

/** A place money sits in (spec 6): a bank account or cash, in one currency. */
export interface Place {
  id: string;
  name: string;
  currency: string;
  /** Money for spending, or kept aside (free money is shared out to it last). */
  kind: PlaceKind;
  /** "Stop using this place": counted nowhere. */
  archived: boolean;
  /** The balance last typed; null while none was. */
  balanceMinor: number | null;
  /** When it was typed (ms since 1970). */
  checkedAt: number | null;
  /**
   * What the entries saved since it was typed moved (ticket SAB-51): spends and payments out of it,
   * Move money in and out. Below zero: money out. The balance now is `placeBalanceMinor`.
   */
  movedMinor?: number;
}

/** A credit card (item 18, spec 9). */
export interface Card {
  id: string;
  name: string;
  currency: string;
  /** "Stop using this card": not offered on the spend sheet. */
  archived: boolean;
  /** Card spends less card bill payments of ended cycles; this cycle's rows are added on the phone. */
  earlierMinor: number;
}

/** An instalment plan (item 19, spec 9) with what is paid so far, all cycles. */
export interface Plan {
  id: string;
  name: string;
  currency: string;
  priceMinor: number;
  paymentCount: number;
  paymentMinor: number;
  firstPaymentOn: string;
  /** The card it is on; null for a bank loan. */
  cardId: string | null;
  normalMonthlyMinor: number | null;
  /** Pay it all off was done on this day. */
  paidOffOn: string | null;
  /** What payments on its plan payments cover, all cycles. */
  paidMinor: number;
  /** Its plan payments finished with money paid. */
  paymentsMade: number;
  /** Pay extra and Pay it all off, all cycles. */
  extraMinor: number;
  extras: PlanExtra[];
}

/** Money lent to or borrowed from a person (item 20, spec 9), in its own currency. */
export interface Person {
  id: string;
  cycleId: string;
  personName: string;
  direction: "lent" | "borrowed";
  currency: string;
  amountMinor: number;
  madeOn: string;
  /** Settled on this day: closed, whatever is still owed. */
  settledOn: string | null;
  /** Lent: got back so far. Borrowed: what payments on its paybacks cover. All cycles. */
  backMinor: number;
  /** Lent: each Got it back (a `paid_back` income), oldest first. */
  gotBack: { id: string; cycleId: string; amountMinor: number; toSavingsMinor: number; on: string }[];
  /** Borrowed: the income it came in as. */
  incomeId: string | null;
}

/** One Pay extra or Pay it all off (item 19). */
export interface PlanExtra {
  id: string;
  cycleId: string;
  amountMinor: number;
  paidFrom: "free" | "savings";
  paysOff: boolean;
  paidOn: string;
}

export interface Recurring {
  id: string;
  name: string;
  kind: "bill" | "savings" | "card_bill";
  currency: string;
  usualAmountMinor: number;
  usualDay: number;
  /** Off: paused, not filled in on salary day. */
  active: boolean;
  /** A card bill's card (item 18): salary day fills it from the card's balance. */
  cardId: string | null;
}

export interface Prepayment {
  id: string;
  name: string;
  currency: string;
  totalMinor: number;
  /** The usual payback each cycle. */
  paybackMinor: number;
  /** The normal monthly price and months covered, for the prepayment saving; null when not given. */
  normalMonthlyMinor: number | null;
  months: number | null;
  /** Moved back into savings so far, all cycles. */
  paidBackMinor: number;
  /** The day its money came out of savings. */
  startedOn: string;
}

/** A savings goal (SAB-68, spec 5): a target to save by a day; its shares are savings set-asides. */
export interface Goal {
  id: string;
  name: string;
  currency: string;
  targetMinor: number;
  byOn: string;
  /** "Already saved for it". */
  startMinor: number;
  stopped: boolean;
  /** What payments on its shares cover, all cycles. */
  movedMinor: number;
  shareCount: number;
  /** Every share, newest cycle first. */
  shares: GoalShare[];
}

export interface GoalShare {
  id: string;
  cycleId: string;
  /** Its cycle's first day. */
  startedOn: string;
  plannedMinor: number;
  state: CommitmentState;
  coveredMinor: number;
}

export interface SavingsLine {
  id: string;
  /** Put in, Take out, extra income to savings, a savings set-aside moved, a prepayment and its paybacks, Pay extra on a plan. */
  kind:
    | "put_in"
    | "take_out"
    | "income"
    | "leftover"
    | "set_aside"
    | "prepayment"
    | "payback"
    | "rate_gain"
    | "plan_extra";
  cycleId: string;
  currency: string;
  /** Below zero: money out of savings. */
  amountMinor: number;
  on: string;
  /** The commitment's name for a set-aside or payback moved; the prepayment's name. */
  name: string | null;
  /** Take out "from a goal" (SAB-69): the savings goal it took from; none: from no goal. */
  goalId?: string;
}

export interface Pot {
  id: string;
  name: string;
  currency: string;
  usualAmountMinor: number;
  /** "Stop using this pot". */
  archived: boolean;
  /** Set aside this cycle; null when it has no amount in this cycle. */
  amountMinor: number | null;
}

export interface Commitment {
  id: string;
  name: string;
  /** "bill", "savings" (a savings set-aside, item 10) or "savings_payback" (item 14); more with later items. */
  kind: string;
  currency: string;
  plannedMinor: number;
  dueOn: string;
  state: CommitmentState;
  /** Its "Every cycle" template, when the switch is on (item 11). */
  recurringId: string | null;
  /** Last cycle's commitment it carries on (item 11). */
  carriedFromId: string | null;
  /** The prepayment a payback to savings pays back (item 14). */
  prepaymentId: string | null;
  /** A card bill's card (item 18). */
  cardId: string | null;
  /** A plan payment's instalment plan (item 19). */
  planId: string | null;
  /** A payback to a person: the money borrowed (item 20). */
  personDebtId: string | null;
  /** A goal share: the savings goal it saves toward (SAB-68). */
  goalId?: string | null;
  /** Payments so far, oldest first (item 6). */
  payments: Payment[];
}

export interface Payment {
  id: string;
  amountMinor: number;
  currency: string;
  /** Paid in the other currency (item 17): what it covers of the commitment; null in its own. */
  coversMinor: number | null;
  paidOn: string;
  /** The place the money came out of (SAB-51); null or none moves no place. */
  placeId?: string | null;
  /** Made on this phone and not sent yet (item 24). */
  unsent?: boolean;
}

export interface Spend {
  id: string;
  spentOn: string;
  currency: string;
  amountMinor: number;
  note: string | null;
  /** The pot it came from; null means free money. */
  potId: string | null;
  /** Left out of the spending speed (item 8). */
  oneOff: boolean;
  /** The card it was paid with; null means cash (item 18). */
  cardId: string | null;
  /** The place the money came out of (SAB-51); null or none moves no place. */
  placeId?: string | null;
  /** Made on this phone and not sent yet (item 24). */
  unsent?: boolean;
}

/** The current cycle's settings and cycle, once first use is done. */
export type Ready = Current & {
  settings: NonNullable<Current["settings"]>;
  cycle: NonNullable<Current["cycle"]>;
};

/** A card's balance now (spec 9): what it owed before this cycle, plus this cycle's card spends, less its bills' payments. */
export function cardBalance(data: Pick<Ready, "spends" | "commitments">, card: Card): number {
  return cardBalanceMinor(card, data.spends, data.commitments);
}

/** The verdict chip's words (spec 7): "On track", "Runs out on Tue 24 Nov", "Over by Rs 1,000". */
export function verdictLabel(v: Verdict, currency: string): string {
  switch (v.kind) {
    case "early":
      return "Too early to tell";
    case "on_track":
      return "On track";
    case "tight":
      return "Tight";
    case "runs_out":
      return `Runs out on ${dayLabel(v.on)}`;
    case "over":
      return `Over by ${formatMoney(v.overMinor, currency)}`;
    case "used_up":
      return "Used up";
  }
}

/**
 * Settings, current cycle and its entries (GET /api/current). Each load is saved on the phone; when the server
 * can't be reached the saved copy is shown and `offlineSince` is when it was saved (item 23, spec 11).
 */
export function useCurrent(userId: string) {
  const [data, setData] = useState<Current | null>(null);
  const [error, setError] = useState(false);
  const [offlineSince, setOfflineSince] = useState<number | null>(null);
  const reload = useCallback(async () => {
    let res: Response;
    try {
      res = await api.api.current.$get();
    } catch {
      // No connection: the saved copy, if any.
      const copy = readCopy(userId);
      if (copy) {
        setData(copy.data);
        setOfflineSince(copy.savedAt);
        setError(false);
      } else setError(true);
      return;
    }
    try {
      // Signed out or cut off on the server: the saved copy is no longer this user's to see.
      if (res.status === 401 || res.status === 403) clearCopy();
      if (!res.ok) throw new Error(String(res.status));
      const fresh = (await res.json()) as Current;
      saveCopy(userId, fresh);
      setData(fresh);
      setOfflineSince(null);
      setError(false);
    } catch {
      setError(true);
    }
  }, [userId]);
  useEffect(() => {
    reload();
    const back = () => reload();
    window.addEventListener("online", back);
    return () => window.removeEventListener("online", back);
  }, [reload]);
  return { data, error, offlineSince, reload };
}

/** Today's date in the home time zone; moves on at midnight there. */
export function useToday(timeZone: string): string {
  const [today, setToday] = useState(() => todayIn(timeZone, Date.now()));
  useEffect(() => {
    const tick = () => setToday(todayIn(timeZone, Date.now()));
    tick();
    const t = setInterval(tick, 30_000);
    document.addEventListener("visibilitychange", tick);
    return () => {
      clearInterval(t);
      document.removeEventListener("visibilitychange", tick);
    };
  }, [timeZone]);
  return today;
}

/** The time of day in `timeZone`, "HH:MM", kept current like `useToday`. */
export function useTimeOfDay(timeZone: string): string {
  const [time, setTime] = useState(() => timeIn(timeZone, Date.now()));
  useEffect(() => {
    const tick = () => setTime(timeIn(timeZone, Date.now()));
    tick();
    const t = setInterval(tick, 30_000);
    document.addEventListener("visibilitychange", tick);
    return () => {
      clearInterval(t);
      document.removeEventListener("visibilitychange", tick);
    };
  }, [timeZone]);
  return time;
}

/** The phone's own time zone, as a name the app lists. */
export function phoneTimeZone(): string {
  return currentZoneName(Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC");
}

/** The zones to pick from, by current name; `current` (shown as its current name) is always in it. */
export function timeZones(current: string): string[] {
  const all = currentZoneNames(Intl.supportedValuesOf("timeZone"));
  const now = currentZoneName(current);
  return all.includes(now) ? all : [now, ...all];
}
