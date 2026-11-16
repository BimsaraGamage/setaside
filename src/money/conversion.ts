import type { Currencies, Minor } from "./amount";
import { type FreeEntries, otherCurrency, uncoveredMinor } from "./cycle";
import { type Day, isDay } from "./days";
import { atRate, minorAtLeast, type Rate, rateOf } from "./rate";

/**
 * One conversion ("Change dollars", spec 8, item 16) as the money rules need it:
 * dollars given out of the salary currency, rupees received into the spending
 * currency. `gainMinor` is the rate gain (above zero, to rupee savings) or loss
 * (below zero, already out of free money) worked out when it was saved.
 */
export interface ConversionEntry {
  givenMinor: Minor;
  receivedMinor: Minor;
  gainMinor: Minor;
}

/** What a conversion's rupees do (spec 8, 10): shown on Change dollars, stored with it. */
export interface ConversionSplit {
  /** The rate actually got. */
  rate: Rate | null;
  /** Rupees that cover rupee set-asides not yet covered (bills first). */
  coveredMinor: Minor;
  /** Rupees to free money: the rest, less a gain. */
  toFreeMinor: Minor;
  /** The rate gain (to rupee savings) or, below zero, the loss (out of free money). */
  gainMinor: Minor;
}

/**
 * Bills first (spec 8): a conversion's rupees first cover the rupee set-asides
 * not yet covered; the rest is free money. The rate gain or loss is worked out
 * on the covering part only: the dollars of this conversion that were reserved
 * for those set-asides (at the reserve rate) against what they actually got.
 * A gain goes to rupee savings; a loss is already out of free money (the bill
 * still short is reserved from the dollars again).
 */
export function conversionSplit(
  entries: FreeEntries,
  givenMinor: Minor,
  receivedMinor: Minor,
): ConversionSplit {
  const other = otherCurrency(entries);
  const cur = entries.spendingCurrency;
  const rate = other ? rateOf(givenMinor, receivedMinor, other, cur) : null;
  const short = uncoveredMinor(entries);
  const reserveRate = entries.reserveRate ?? entries.countingRate;
  if (!other || !rate || short === 0 || !reserveRate) {
    return { rate, coveredMinor: 0, toFreeMinor: Math.max(0, receivedMinor), gainMinor: 0 };
  }
  const reserved = Math.min(givenMinor, minorAtLeast(short, reserveRate, other, cur));
  const got = Number((BigInt(receivedMinor) * BigInt(reserved)) / BigInt(givenMinor));
  const gainMinor = got - atRate(reserved, reserveRate, other, cur);
  const toSavings = Math.max(0, gainMinor);
  const coveredMinor = Math.min(short, receivedMinor - toSavings);
  return { rate, coveredMinor, toFreeMinor: receivedMinor - toSavings - coveredMinor, gainMinor };
}

export interface ConversionInput {
  givenMinor: number;
  receivedMinor: number;
  doneOn: string;
}

export type ConversionProblem = "currency" | "given" | "received" | "done_on" | "rate";

/**
 * Checks Change dollars (spec 8): two currencies, both amounts above zero, a
 * rate that can be kept, dated in the current cycle up to today.
 */
export function checkConversion(
  input: ConversionInput,
  ctx: Currencies & { cycleStartedOn: Day; today: Day },
): ConversionProblem[] {
  const other = otherCurrency(ctx);
  if (!other) return ["currency"];
  const out: ConversionProblem[] = [];
  const given = Number.isSafeInteger(input.givenMinor) && input.givenMinor > 0;
  const received = Number.isSafeInteger(input.receivedMinor) && input.receivedMinor > 0;
  if (!given) out.push("given");
  if (!received) out.push("received");
  if (!isDay(input.doneOn) || input.doneOn < ctx.cycleStartedOn || input.doneOn > ctx.today) {
    out.push("done_on");
  }
  if (given && received && !rateOf(input.givenMinor, input.receivedMinor, other, ctx.spendingCurrency)) {
    out.push("rate");
  }
  return out;
}
