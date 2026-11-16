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

/**
 * The least money in `from` that counts as at least `target` in `to` at `rate`
 * (rounded up): the dollars reserved for rupee set-asides (spec 8), so free
 * money is never overstated.
 */
export function minorAtLeast(target: Minor, rate: Rate, from: string, to: string): Minor {
  if (target <= 0) return 0;
  const [whole = "0", frac = ""] = rate.split(".");
  const num = BigInt(target) * 10n ** BigInt(frac.length + minorDigits(from));
  const den = BigInt(`${whole}${frac}`) * 10n ** BigInt(minorDigits(to));
  return Number((num + den - 1n) / den);
}

/**
 * Spending-currency money (`from`) counted in the salary currency (`to`) at `rate`
 * (spending units for one salary unit), rounded down: what rupees paid on a dollar
 * bill cover of it (spec 8).
 */
export function fromRate(minor: Minor, rate: Rate, from: string, to: string): Minor {
  if (minor <= 0) return 0;
  const [whole = "0", frac = ""] = rate.split(".");
  const num = BigInt(minor) * 10n ** BigInt(frac.length + minorDigits(to));
  const den = BigInt(`${whole}${frac}`) * 10n ** BigInt(minorDigits(from));
  return Number(num / den);
}

/**
 * The rate a conversion actually got (spec 8): `to` units for one `from` unit,
 * rounded down to 6 decimals, trailing zeros left out; null when either amount
 * is not above zero, or the rate rounds to nothing or is past what a rate holds.
 */
export function rateOf(givenMinor: Minor, receivedMinor: Minor, from: string, to: string): Rate | null {
  if (!Number.isSafeInteger(givenMinor) || !Number.isSafeInteger(receivedMinor)) return null;
  if (givenMinor <= 0 || receivedMinor <= 0) return null;
  const scaled =
    (BigInt(receivedMinor) * 10n ** BigInt(minorDigits(from) + 6)) /
    (BigInt(givenMinor) * 10n ** BigInt(minorDigits(to)));
  const whole = scaled / 1_000_000n;
  const frac = (scaled % 1_000_000n).toString().padStart(6, "0").replace(/0+$/, "");
  return parseRate(frac ? `${whole}.${frac}` : `${whole}`);
}
