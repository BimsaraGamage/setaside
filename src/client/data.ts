import { useCallback, useEffect, useState } from "react";
import { type CommitmentState, type IncomeKind, todayIn } from "../money";
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
}

export interface Commitment {
  id: string;
  name: string;
  kind: string;
  currency: string;
  plannedMinor: number;
  dueOn: string;
  state: CommitmentState;
}

export interface Spend {
  id: string;
  spentOn: string;
  currency: string;
  amountMinor: number;
  note: string | null;
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
    expectedSalaryOn: data.cycle.expectedSalaryOn,
    incomes: data.incomes,
    spends: data.spends,
    commitments: data.commitments,
  };
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
