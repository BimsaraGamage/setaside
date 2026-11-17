import { formatMoney, type Minor } from "./amount";
import type { CommitmentEntry } from "./commitment";
import type { ConversionEntry } from "./conversion";
import type { CycleEntries, DayChoiceEntry, IncomeEntry } from "./cycle";
import type { Day } from "./days";
import { type Reminder, type ReminderSettings, reminders } from "./reminders";
import type { Speed } from "./speed";
import type { SpendEntry } from "./spend";

/**
 * The reminders in words and the cycle's entries from what GET /api/current gives
 * (spec 12). The phone's list on Today and the cron's phone notifications (item 26)
 * both use these, so they say the same thing.
 */

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

/** "today", "in 3 days", "2 days late". */
export function inDaysLabel(n: number): string {
  if (n === 0) return "today";
  if (n < 0) return `${-n} day${n === -1 ? "" : "s"} late`;
  return `in ${n} day${n === 1 ? "" : "s"}`;
}

/** One reminder in words, as the list and the morning summary say it (spec 12). */
export function reminderText(r: Reminder): string {
  switch (r.kind) {
    case "due_today":
      return `${r.name} ${r.lateDays === 0 ? "due today" : inDaysLabel(-r.lateDays)} · ${formatMoney(r.stillMinor, r.currency)}`;
    case "due_soon":
      return `${r.name} ${inDaysLabel(r.inDays)} · ${formatMoney(r.stillMinor, r.currency)}`;
    case "running_out": {
      const who = r.name ?? "Free money";
      const v = r.verdict;
      if (v.kind === "tight") return `${who}: tight`;
      if (v.kind === "runs_out") return `${who}: runs out on ${dayLabel(v.on)}`;
      return `${who}: over by ${formatMoney(v.overMinor, r.currency)}`;
    }
    case "salary_late":
      return `Salary late: expected ${dayLabel(r.expectedOn)}, ${r.lateDays} day${r.lateDays === 1 ? "" : "s"} ago`;
    case "questions": {
      const parts: string[] = [];
      if (r.unspentDays > 0) {
        const when = r.unspentDays === 1 ? "yesterday" : `in the last ${r.unspentDays} days`;
        parts.push(
          `${formatMoney(r.unspentMinor, r.currency)} not spent ${when}: spread it or add to today?`,
        );
      }
      const asks: string[] = [];
      if (r.unpaid > 0) asks.push(`${r.unpaid} unpaid bill${r.unpaid === 1 ? "" : "s"}`);
      if (r.overMinor > 0) asks.push(`an overspend of ${formatMoney(r.overMinor, r.currency)}`);
      if (asks.length > 0) parts.push(`Salary day will ask about ${asks.join(" and ")}`);
      return parts.join(" · ");
    }
    case "spend_nudge":
      return "Any spends today? Add them with +";
  }
}

/** A reminder's subject, for "send once" (spec 12): the commitment, the pot or free money, or none. */
export function reminderSubject(r: Reminder): string | null {
  if (r.kind === "due_today" || r.kind === "due_soon") return r.id;
  if (r.kind === "running_out") return r.potId ?? "free";
  return null;
}

/** The current cycle as GET /api/current gives it: what the reminders need. */
export interface CurrentData {
  settings: {
    spendingCurrency: string;
    salaryCurrency: string;
    countingRate: string | null;
    reminders: ReminderSettings;
  };
  cycle: { id: string; startedOn: Day; expectedSalaryOn: Day; reserveRate: string | null };
  conversions: ConversionEntry[];
  lastCycle: { speed: Speed; pots: Record<string, Speed> } | null;
  dayChoices: DayChoiceEntry[];
  incomes: IncomeEntry[];
  spends: SpendEntry[];
  commitments: (CommitmentEntry & { id: string; name: string })[];
  pots: { id: string; name: string; currency: string; amountMinor: number | null; archived: boolean }[];
  savings: { kind: string; cycleId: string; currency: string; amountMinor: Minor; on: Day }[];
  plans: {
    currency: string;
    extras: { cycleId: string; amountMinor: Minor; paidFrom: "free" | "savings" }[];
  }[];
  people: { direction: "lent" | "borrowed"; cycleId: string; currency: string; amountMinor: Minor }[];
}

/** A pot as the money rules need it. */
export function potEntry(p: CurrentData["pots"][number]) {
  return { id: p.id, currency: p.currency, amountMinor: p.amountMinor ?? 0, archived: p.archived };
}

/** Money lent to people this cycle (item 20): out of free money at once. */
export function lentNow(data: Pick<CurrentData, "people" | "cycle">) {
  return data.people
    .filter((p) => p.direction === "lent" && p.cycleId === data.cycle.id)
    .map((p) => ({ currency: p.currency, amountMinor: p.amountMinor }));
}

/** This cycle's Pay extra from free money (item 19): out of free money at once. */
export function planExtras(data: Pick<CurrentData, "plans" | "cycle">) {
  return data.plans.flatMap((p) =>
    p.extras
      .filter((x) => x.paidFrom === "free" && x.cycleId === data.cycle.id)
      .map((x) => ({ currency: p.currency, amountMinor: x.amountMinor })),
  );
}

/** This cycle's take-outs from savings, as the money rules need them (they are free money). */
export function takenOut(data: Pick<CurrentData, "savings" | "cycle">) {
  return data.savings
    .filter((l) => l.kind === "take_out" && l.cycleId === data.cycle.id)
    .map((l) => ({ currency: l.currency, amountMinor: -l.amountMinor, movedOn: l.on }));
}

/** The money rules' entries for the current cycle. */
export function entriesOf(data: CurrentData) {
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
    lent: lentNow(data),
  } satisfies CycleEntries;
}

/** Today's reminders from the current cycle (spec 12): the list on Today and the cron use this. */
export function remindersOfCurrent(data: CurrentData, today: Day, time: string): Reminder[] {
  return reminders({
    entries: entriesOf(data),
    commitments: data.commitments,
    pots: data.pots.map((p) => ({ ...potEntry(p), name: p.name })),
    potLastSpeeds: data.lastCycle?.pots,
    today,
    time,
    settings: data.settings.reminders,
  });
}
