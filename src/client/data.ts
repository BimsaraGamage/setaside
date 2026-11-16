import { useCallback, useEffect, useState } from "react";
import {
  type CommitmentState,
  cardBalanceMinor,
  type DayChoiceEntry,
  formatMoney,
  type IncomeKind,
  type Speed,
  todayIn,
  type Verdict,
} from "../money";
import { api } from "./api";

export interface Current {
  settings: {
    salaryCurrency: string;
    spendingCurrency: string;
    homeTimeZone: string;
    usualPayDay: number;
    /** The counting rate (spec 8); null with one currency or none set. */
    countingRate: string | null;
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
}

/** The current cycle's settings and cycle, once first use is done. */
export type Ready = Current & {
  settings: NonNullable<Current["settings"]>;
  cycle: NonNullable<Current["cycle"]>;
};

/** The money rules' entries for the current cycle. */
export function entriesOf(data: Ready) {
  return {
    spendingCurrency: data.settings.spendingCurrency,
    salaryCurrency: data.settings.salaryCurrency,
    countingRate: data.settings.countingRate,
    reserveRate: data.cycle.reserveRate,
    conversions: data.conversions,
    startedOn: data.cycle.startedOn,
    expectedSalaryOn: data.cycle.expectedSalaryOn,
    lastSpeed: data.lastCycle?.speed ?? null,
    dayChoices: data.dayChoices,
    incomes: data.incomes,
    spends: data.spends,
    commitments: data.commitments,
    pots: data.pots.map(potEntry),
    takenOut: takenOut(data),
    planExtras: planExtras(data),
  };
}

/** This cycle's Pay extra from free money (item 19): out of free money at once. */
export function planExtras(data: Pick<Ready, "plans" | "cycle">) {
  return data.plans.flatMap((p) =>
    p.extras
      .filter((x) => x.paidFrom === "free" && x.cycleId === data.cycle.id)
      .map((x) => ({ currency: p.currency, amountMinor: x.amountMinor })),
  );
}

/** This cycle's take-outs from savings, as the money rules need them (they are free money). */
export function takenOut(data: Pick<Ready, "savings" | "cycle">) {
  return data.savings
    .filter((l) => l.kind === "take_out" && l.cycleId === data.cycle.id)
    .map((l) => ({ currency: l.currency, amountMinor: -l.amountMinor, movedOn: l.on }));
}

/** A card's balance now (spec 9): what it owed before this cycle, plus this cycle's card spends, less its bills' payments. */
export function cardBalance(data: Pick<Ready, "spends" | "commitments">, card: Card): number {
  return cardBalanceMinor(card, data.spends, data.commitments);
}

/** A pot as the money rules need it. */
export function potEntry(p: Pot) {
  return { id: p.id, currency: p.currency, amountMinor: p.amountMinor ?? 0, archived: p.archived };
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

/** "today", "in 3 days", "2 days late". */
export function inDaysLabel(n: number): string {
  if (n === 0) return "today";
  if (n < 0) return `${-n} day${n === -1 ? "" : "s"} late`;
  return `in ${n} day${n === 1 ? "" : "s"}`;
}

/** Settings, current cycle and its entries (GET /api/current). */
export function useCurrent() {
  const [data, setData] = useState<Current | null>(null);
  const [error, setError] = useState(false);
  const reload = useCallback(async () => {
    try {
      const res = await api.api.current.$get();
      if (!res.ok) throw new Error(String(res.status));
      setData((await res.json()) as Current);
      setError(false);
    } catch {
      setError(true);
    }
  }, []);
  useEffect(() => {
    reload();
  }, [reload]);
  return { data, error, reload };
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

/** The phone's own time zone, as a name the app lists. */
export function phoneTimeZone(): string {
  return Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
}

export function timeZones(current: string): string[] {
  const all = Intl.supportedValuesOf("timeZone");
  return all.includes(current) ? all : [current, ...all];
}

const longDay = new Intl.DateTimeFormat("en-GB", {
  weekday: "short",
  day: "numeric",
  month: "short",
  timeZone: "UTC",
});
const shortDay = new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", timeZone: "UTC" });

/** "Mon 30 Nov" from a plain day. */
export function dayLabel(day: string, weekday = true): string {
  const d = new Date(`${day}T00:00:00Z`);
  return (weekday ? longDay : shortDay).format(d).replace(",", "");
}
