import { useCallback, useEffect, useState } from "react";
import {
  type CommitmentState,
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
  } | null;
  cycle: { id: string; startedOn: string; expectedSalaryOn: string } | null;
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
  /** Last cycle's speeds, used in a cycle's first 3 days; null on the very first cycle (item 8). */
  lastCycle: { speed: Speed; pots: Record<string, Speed> } | null;
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
  kind: string;
  currency: string;
  plannedMinor: number;
  dueOn: string;
  state: CommitmentState;
  /** Payments so far, oldest first (item 6). */
  payments: Payment[];
}

export interface Payment {
  id: string;
  amountMinor: number;
  currency: string;
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
    startedOn: data.cycle.startedOn,
    expectedSalaryOn: data.cycle.expectedSalaryOn,
    lastSpeed: data.lastCycle?.speed ?? null,
    incomes: data.incomes,
    spends: data.spends,
    commitments: data.commitments,
    pots: data.pots.map(potEntry),
  };
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
