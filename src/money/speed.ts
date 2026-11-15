import type { Minor } from "./amount";
import { addDays, type Day, daysBetween } from "./days";
import { inAPot, type PotEntry, potView } from "./pot";
import type { SpendEntry } from "./spend";

/** A spending speed as a sum over days, so the verdict compares exactly (per day = total ÷ days). */
export interface Speed {
  totalMinor: Minor;
  days: number;
}

/** First days of a cycle that use last cycle's speed (spec 7). */
export const EARLY_DAYS = 3;

const counts = (s: SpendEntry, currency: string, before: Day) =>
  s.currency === currency && s.spentOn < before;

/**
 * Spends that make the speed, dated before `before` (spec 7): those out of free
 * money that are not one-off, and each pot's part past its amount. A one-off
 * spend in a pot is taken off that part first. Commitment payments are not spends.
 */
function speedTotal(spends: SpendEntry[], pots: PotEntry[], currency: string, before: Day): Minor {
  let total = 0;
  for (const s of spends) {
    if (!counts(s, currency, before) || s.oneOff || inAPot(s, pots)) continue;
    total += s.amountMinor;
  }
  for (const p of pots) {
    if (p.currency !== currency) continue;
    let spent = 0;
    let oneOff = 0;
    for (const s of spends) {
      if (s.potId !== p.id || !counts(s, currency, before)) continue;
      spent += s.amountMinor;
      if (s.oneOff) oneOff += s.amountMinor;
    }
    total += Math.max(0, Math.max(0, spent - p.amountMinor) - oneOff);
  }
  return total;
}

/** A pot's own speed total: its spends dated before `before`, one-offs left out. */
function potTotal(p: PotEntry, spends: SpendEntry[], before: Day): Minor {
  let total = 0;
  for (const s of spends) {
    if (s.potId === p.id && !s.oneOff && counts(s, p.currency, before)) total += s.amountMinor;
  }
  return total;
}

export interface SpeedEntries {
  spendingCurrency: string;
  spends: SpendEntry[];
  pots?: PotEntry[];
}

/**
 * A cycle's speeds from `startedOn` up to the day before `before`: free money's
 * and each pot's (by id). For an ended cycle `before` is the next cycle's first
 * day; that is "last cycle's speed" (spec 7).
 */
export function cycleSpeeds(
  entries: SpeedEntries,
  startedOn: Day,
  before: Day,
): { speed: Speed; pots: Record<string, Speed> } {
  const days = Math.max(0, daysBetween(startedOn, before));
  const pots = entries.pots ?? [];
  const potSpeeds: Record<string, Speed> = {};
  for (const p of pots) potSpeeds[p.id] = { totalMinor: potTotal(p, entries.spends, before), days };
  return {
    speed: { totalMinor: speedTotal(entries.spends, pots, entries.spendingCurrency, before), days },
    pots: potSpeeds,
  };
}

/**
 * Today's spending speed (spec 7): this cycle's finished days (today's spends
 * count from the next morning). In the first 3 days, last cycle's speed; on the
 * very first cycle none ("Too early to tell").
 */
export function speedNow(
  entries: SpeedEntries & { startedOn?: Day; lastSpeed?: Speed | null },
  today: Day,
): (Speed & { lastCycle: boolean }) | null {
  if (!entries.startedOn) return null;
  const own = cycleSpeeds(entries, entries.startedOn, today).speed;
  if (own.days >= EARLY_DAYS) return { ...own, lastCycle: false };
  return entries.lastSpeed ? { ...entries.lastSpeed, lastCycle: true } : null;
}

/** Speed per day, rounded to the nearest minor unit; 0 with no days. */
export function perDayMinor(s: Speed): Minor {
  return s.days > 0 ? Math.round(s.totalMinor / s.days) : 0;
}

export type Verdict =
  | { kind: "early" }
  | { kind: "on_track" }
  | { kind: "tight" }
  | { kind: "runs_out"; on: Day }
  | { kind: "over"; overMinor: Minor }
  | { kind: "used_up" };

/** a × b ≤ c × d without losing precision on large amounts. */
const atMost = (a: number, b: number, c: number, d: number) => BigInt(a) * BigInt(b) <= BigInt(c) * BigInt(d);

/**
 * The run-out verdict (spec 7) from the money at the start of today, so it is
 * fixed for the day like the allowance. On track: speed at most 90% of the
 * daily amount (`allowanceMinor`, or exactly money ÷ days left when none, as
 * for pots). Tight: above that and the money lasts to the expected salary day.
 * Runs out on today + money ÷ speed, in whole days.
 */
export function runOutVerdict(a: {
  speed: Speed | null;
  startMinor: Minor;
  allowanceMinor?: Minor;
  daysLeft: number;
  today: Day;
}): Verdict {
  const { speed } = a;
  if (!speed) return { kind: "early" };
  if (speed.totalMinor <= 0 || speed.days <= 0) return { kind: "on_track" };
  const days = Math.max(1, a.daysLeft);
  const money = Math.max(0, a.startMinor);
  // speed × 10 ≤ 9 × daily, with speed = total ÷ speed days and daily = allowance (or money ÷ days left).
  const onTrack =
    a.allowanceMinor !== undefined
      ? atMost(speed.totalMinor, 10, 9 * a.allowanceMinor, speed.days)
      : atMost(speed.totalMinor * 10, days, 9 * money, speed.days);
  if (onTrack) return { kind: "on_track" };
  if (atMost(speed.totalMinor, a.daysLeft, money, speed.days)) return { kind: "tight" };
  const lasts = (BigInt(money) * BigInt(speed.days)) / BigInt(speed.totalMinor);
  return { kind: "runs_out", on: addDays(a.today, Number(lasts)) };
}

/**
 * A pot's verdict (spec 7): the same rules from its own speed and what was left
 * in it at the start of today. A used-up pot shows "Used up".
 */
export function potVerdict(
  p: PotEntry,
  spends: SpendEntry[],
  ctx: { startedOn: Day; today: Day; daysLeft: number; lastSpeed?: Speed | null },
): Verdict {
  if (potView(p, spends).usedUp) return { kind: "used_up" };
  const own: Speed = {
    totalMinor: potTotal(p, spends, ctx.today),
    days: Math.max(0, daysBetween(ctx.startedOn, ctx.today)),
  };
  const speed = own.days >= EARLY_DAYS ? own : (ctx.lastSpeed ?? null);
  let spentBefore = 0;
  for (const s of spends) {
    if (s.potId === p.id && counts(s, p.currency, ctx.today)) spentBefore += s.amountMinor;
  }
  return runOutVerdict({
    speed,
    startMinor: p.amountMinor - spentBefore,
    daysLeft: ctx.daysLeft,
    today: ctx.today,
  });
}
