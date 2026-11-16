import { type Minor, minorDigits } from "./amount";

/**
 * A rate between the salary and the spending currency (spec 8): spending-currency
 * units for one salary-currency unit ("302.50": Rs 302.50 a dollar). Stored as
 * decimal text exactly as typed (data-model.md), worked with as whole numbers.
 */
export type Rate = string;

const RATE = /^(\d{1,7})(?:\.(\d{1,6}))?$/;

/** A typed rate, commas and spaces left out; null unless it is a plain number above zero. */
export function parseRate(text: string): Rate | null {
  const t = text.replace(/[,\s]/g, "");
  const m = RATE.exec(t);
  if (!m) return null;
  if (/^0*$/.test(m[1] ?? "") && /^0*$/.test(m[2] ?? "")) return null;
  return t;
}

/** Whether a stored or sent rate is a usable one, exactly as `parseRate` keeps it. */
export function isRate(text: unknown): text is Rate {
  return typeof text === "string" && parseRate(text) === text;
}

/**
 * Money in `from` counted in `to` at `rate` (spec 8, Rounding): rounded down to
 * the minor unit, so free money is never overstated. Below zero it rounds down
 * too (further from zero), for the same reason.
 */
export function atRate(minor: Minor, rate: Rate, from: string, to: string): Minor {
  const [whole = "0", frac = ""] = rate.split(".");
  const num = BigInt(`${whole}${frac}`) * BigInt(minor) * 10n ** BigInt(minorDigits(to));
  const den = 10n ** BigInt(frac.length + minorDigits(from));
  let q = num / den;
  if (num % den !== 0n && num < 0n) q -= 1n;
  return Number(q);
}
