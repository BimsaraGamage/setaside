/**
 * Days are plain calendar days, "YYYY-MM-DD", in the home time zone (glossary).
 * "Today" always comes from the home time zone, never from server UTC (ADR 0003).
 */
export type Day = string;

const DAY_MS = 86_400_000;

export function isDay(text: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(text)) return false;
  return toUtcMs(text) !== null && fromUtcMs(toUtcMs(text) as number) === text;
}

/** A time zone name the runtime knows ("Asia/Colombo"). */
export function isTimeZone(timeZone: string): boolean {
  try {
    new Intl.DateTimeFormat("en", { timeZone });
    return true;
  } catch {
    return false;
  }
}

/**
 * The phone's time zone to ask about switching to (spec 10, item 22), or null.
 * Asked once: when the phone is in a zone the app knows that is not home and
 * not the zone last asked about (`asked`, saved whatever the answer).
 */
export function zoneToAsk(z: { home: string; phone: string; asked: string | null }): string | null {
  if (!z.phone || !isTimeZone(z.phone)) return null;
  if (z.phone === z.home || z.phone === z.asked) return null;
  return z.phone;
}

const dayFormatters = new Map<string, Intl.DateTimeFormat>();

/** The calendar day at `instant` (ms since epoch) in `timeZone`. */
export function todayIn(timeZone: string, instant: number): Day {
  let f = dayFormatters.get(timeZone);
  if (!f) {
    f = new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" });
    dayFormatters.set(timeZone, f);
  }
  const parts = Object.fromEntries(f.formatToParts(instant).map((p) => [p.type, p.value]));
  return `${parts.year}-${parts.month}-${parts.day}`;
}

function toUtcMs(day: Day): number | null {
  const [y, m, d] = day.split("-").map(Number);
  if (!y || !m || !d) return null;
  return Date.UTC(y, m - 1, d);
}

function fromUtcMs(ms: number): Day {
  return new Date(ms).toISOString().slice(0, 10);
}

export function addDays(day: Day, n: number): Day {
  return fromUtcMs((toUtcMs(day) as number) + n * DAY_MS);
}

/** Whole days from `a` to `b` (positive when `b` is later). */
export function daysBetween(a: Day, b: Day): number {
  return Math.round(((toUtcMs(b) as number) - (toUtcMs(a) as number)) / DAY_MS);
}

function lastDayOfMonth(year: number, month0: number): number {
  return new Date(Date.UTC(year, month0 + 1, 0)).getUTCDate();
}

/**
 * Expected salary day suggested from the usual pay day (spec 2): the next one
 * strictly after today; a pay day past the month's end falls on its last day.
 */
export function suggestSalaryDay(today: Day, usualPayDay: number): Day {
  const [y, m] = today.split("-").map(Number) as [number, number];
  for (let off = 0; off < 3; off++) {
    const month0 = m - 1 + off;
    const date = new Date(Date.UTC(y, month0, 1));
    const yy = date.getUTCFullYear();
    const mm = date.getUTCMonth();
    const dd = Math.min(usualPayDay, lastDayOfMonth(yy, mm));
    const candidate = fromUtcMs(Date.UTC(yy, mm, dd));
    if (candidate > today) return candidate;
  }
  throw new Error("unreachable");
}

/**
 * `n` months after `day`, on `dayOfMonth` (1–31); a day past a month's end falls
 * on its last day. Monthly instalments keep their day this way (spec 9).
 */
export function addMonths(day: Day, n: number, dayOfMonth: number): Day {
  const [y, m] = day.split("-").map(Number) as [number, number];
  const first = new Date(Date.UTC(y, m - 1 + n, 1));
  const yy = first.getUTCFullYear();
  const mm = first.getUTCMonth();
  return fromUtcMs(Date.UTC(yy, mm, Math.min(dayOfMonth, lastDayOfMonth(yy, mm))));
}
