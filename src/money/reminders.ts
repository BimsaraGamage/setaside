import type { Minor } from "./amount";
import { type CommitmentEntry, inThisCycle, stillToPayMinor } from "./commitment";
import { type CycleEntries, daysLeft, todayView } from "./cycle";
import { addDays, type Day, daysBetween } from "./days";
import type { PotEntry } from "./pot";
import { potVerdict, type Speed, type Verdict } from "./speed";

/**
 * The six reminders (spec 12), worked out from the current cycle's entries.
 * The phone lists them at the top of Today; the cron (item 26) sends the same.
 */

/** `settings` reminder columns: six switches, the two times and the days-ahead number. */
export interface ReminderSettings {
  dueSoon: boolean;
  dueToday: boolean;
  runningOut: boolean;
  salaryLate: boolean;
  questions: boolean;
  spendNudge: boolean;
  /** Bill due soon: due in this many days or fewer. */
  dueSoonDays: number;
  /** Morning summary, HH:MM in the home time zone, 15-minute steps. */
  morningAt: string;
  /** Spend nudge, HH:MM in the home time zone, 15-minute steps. */
  nudgeAt: string;
}

/** All on at first (spec 12). */
export const DEFAULT_REMINDERS: ReminderSettings = {
  dueSoon: true,
  dueToday: true,
  runningOut: true,
  salaryLate: true,
  questions: true,
  spendNudge: true,
  dueSoonDays: 3,
  morningAt: "08:00",
  nudgeAt: "21:00",
};

/** Days-ahead number allowed in Settings. */
export const DUE_SOON_DAYS_MAX = 14;

/** "HH:MM" on a quarter hour (spec 12: times change in 15-minute steps). */
export function isReminderTime(text: string): boolean {
  const m = /^([01]\d|2[0-3]):(00|15|30|45)$/.exec(text);
  return m !== null;
}

/** Every quarter hour of a day, "00:00" to "23:45". */
export function reminderTimes(): string[] {
  const out: string[] = [];
  for (let h = 0; h < 24; h++) {
    for (const m of ["00", "15", "30", "45"]) out.push(`${String(h).padStart(2, "0")}:${m}`);
  }
  return out;
}

const timeFormatters = new Map<string, Intl.DateTimeFormat>();

/** The time of day at `instant` in `timeZone`, "HH:MM" on a 24-hour clock. */
export function timeIn(timeZone: string, instant: number): string {
  let f = timeFormatters.get(timeZone);
  if (!f) {
    f = new Intl.DateTimeFormat("en-GB", { timeZone, hour: "2-digit", minute: "2-digit", hourCycle: "h23" });
    timeFormatters.set(timeZone, f);
  }
  const parts = Object.fromEntries(f.formatToParts(instant).map((p) => [p.type, p.value]));
  return `${parts.hour}:${parts.minute}`;
}

type Named = CommitmentEntry & { id: string; name: string };
type NamedPot = PotEntry & { name: string };

export type Reminder =
  /** 2 · Bill due today or overdue (`lateDays` 0: today). */
  | {
      kind: "due_today";
      id: string;
      name: string;
      dueOn: Day;
      lateDays: number;
      stillMinor: Minor;
      currency: string;
    }
  /** 1 · Bill due soon: in 1 to N days. */
  | {
      kind: "due_soon";
      id: string;
      name: string;
      dueOn: Day;
      inDays: number;
      stillMinor: Minor;
      currency: string;
    }
  /** 3 · Free money (`potId` null) or a pot is Tight (on the day it changed), runs out, or is over. */
  | {
      kind: "running_out";
      potId: string | null;
      name: string | null;
      /** The spending currency, or the pot's: an "over by" amount is in it. */
      currency: string;
      verdict: Extract<Verdict, { kind: "tight" | "runs_out" | "over" }>;
    }
  /** 4 · Salary late, from the morning after the expected salary day. */
  | { kind: "salary_late"; expectedOn: Day; lateDays: number }
  /**
   * 5 · Questions waiting: the underspend question (`unspentDays` > 0), and from the
   * expected salary day what salary day will ask: unpaid bills and an overspend.
   */
  | {
      kind: "questions";
      unspentMinor: Minor;
      unspentDays: number;
      unpaid: number;
      overMinor: Minor;
      currency: string;
    }
  /**
   * 6 · Spend nudge: from the nudge time on a day with no spend, or while this cycle has
   * spends to finish (SAB-76).
   */
  | { kind: "spend_nudge"; spentToday: boolean; toFinish: number };

export interface ReminderInput {
  entries: CycleEntries;
  /** This cycle's commitments with names; they are also the entries' commitments. */
  commitments: Named[];
  /** The user's pots with names and this cycle's amounts; also the entries' pots. */
  pots: NamedPot[];
  /** Last cycle's speed of each pot, used in a cycle's first 3 days. */
  potLastSpeeds?: Record<string, Speed>;
  today: Day;
  /** The time of day in the home time zone, "HH:MM". */
  time: string;
  settings: ReminderSettings;
}

const byDue = (a: Named, b: Named) =>
  a.dueOn === b.dueOn ? a.name.localeCompare(b.name) : a.dueOn < b.dueOn ? -1 : 1;

/** Today's reminders (spec 12), in the morning summary's order (2, 1, 3, 4, 5), then the spend nudge. */
export function reminders(input: ReminderInput): Reminder[] {
  const { today, settings: on } = input;
  const entries: CycleEntries = { ...input.entries, commitments: input.commitments, pots: input.pots };
  const out: Reminder[] = [];
  const open = input.commitments.filter((c) => c.state === "open" && stillToPayMinor(c) > 0).sort(byDue);

  if (on.dueToday) {
    for (const c of open) {
      const inDays = daysBetween(today, c.dueOn);
      if (inDays > 0) continue;
      out.push({
        kind: "due_today",
        id: c.id,
        name: c.name,
        dueOn: c.dueOn,
        lateDays: daysBetween(c.dueOn, today),
        stillMinor: stillToPayMinor(c),
        currency: c.currency,
      });
    }
  }

  if (on.dueSoon) {
    for (const c of open) {
      const inDays = daysBetween(today, c.dueOn);
      if (inDays < 1 || inDays > on.dueSoonDays) continue;
      out.push({
        kind: "due_soon",
        id: c.id,
        name: c.name,
        dueOn: c.dueOn,
        inDays,
        stillMinor: stillToPayMinor(c),
        currency: c.currency,
      });
    }
  }

  const view = todayView(entries, today);
  const yesterday = addDays(today, -1);
  // Tight only on the day it changes: yesterday was not Tight (or was last cycle).
  const firstDay = entries.startedOn === undefined || yesterday < entries.startedOn;
  if (on.runningOut) {
    const v = view.verdict;
    const tightIsNew = () => firstDay || todayView(entries, yesterday).verdict.kind !== "tight";
    if (v.kind === "runs_out" || v.kind === "over" || (v.kind === "tight" && tightIsNew())) {
      out.push({ kind: "running_out", potId: null, name: null, currency: view.currency, verdict: v });
    }
    for (const p of input.pots) {
      if (p.archived) continue;
      const verdictOn = (day: Day) =>
        potVerdict(p, entries.spends, {
          startedOn: entries.startedOn ?? day,
          today: day,
          daysLeft: daysLeft(day, entries.expectedSalaryOn),
          lastSpeed: input.potLastSpeeds?.[p.id] ?? null,
        });
      const pv = verdictOn(today);
      const potTightIsNew = () => firstDay || verdictOn(yesterday).kind !== "tight";
      if (pv.kind === "runs_out" || (pv.kind === "tight" && potTightIsNew())) {
        out.push({ kind: "running_out", potId: p.id, name: p.name, currency: p.currency, verdict: pv });
      }
    }
  }

  if (on.salaryLate && today > entries.expectedSalaryOn) {
    out.push({
      kind: "salary_late",
      expectedOn: entries.expectedSalaryOn,
      lateDays: daysBetween(entries.expectedSalaryOn, today),
    });
  }

  if (on.questions) {
    const ended = today >= entries.expectedSalaryOn;
    const unpaid = ended ? open.filter((c) => inThisCycle(c.dueOn, entries.expectedSalaryOn)).length : 0;
    const overMinor = ended && view.freeMinor < 0 ? -view.freeMinor : 0;
    const q = view.underspend;
    if (q || unpaid > 0 || overMinor > 0) {
      out.push({
        kind: "questions",
        unspentMinor: q?.unspentMinor ?? 0,
        unspentDays: q?.days ?? 0,
        unpaid,
        overMinor,
        currency: view.currency,
      });
    }
  }

  if (on.spendNudge && input.time >= on.nudgeAt) {
    const spentToday = entries.spends.some((s) => s.spentOn === today);
    // The entries are the current cycle's: an ended cycle's spends to finish are not asked about.
    const toFinish = entries.spends.filter((s) => s.toFinish).length;
    if (!spentToday || toFinish > 0) out.push({ kind: "spend_nudge", spentToday, toFinish });
  }
  return out;
}
