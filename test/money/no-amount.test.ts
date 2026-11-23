import { describe, expect, it } from "vitest";
import {
  addDays,
  type CycleEntries,
  checkSpend,
  hasNoAmount,
  noAmountCount,
  noAmountInHandNote,
  noAmountLine,
  type SpendEntry,
  spendsCsv,
  todayView,
} from "../../src/money";

// SAB-83 · A spend to finish saved with no amount (SAB-82). Each case names the rule it checks (spec 7, 10, 14).

const START = "2026-11-01";
const SALARY = "2026-11-11"; // 10 days: 1–10 Nov; Rs 100,000 held → Rs 10,000 a day
const day = (n: number) => addDays(START, n - 1);

const spend = (amountMinor: number, spentOn: string, more: Partial<SpendEntry> = {}): SpendEntry => ({
  spentOn,
  currency: "LKR",
  amountMinor,
  ...more,
});
const blank = (spentOn: string) => spend(0, spentOn, { toFinish: true });

function cycle(spends: SpendEntry[], more: Partial<CycleEntries> = {}): CycleEntries {
  return {
    spendingCurrency: "LKR",
    startedOn: START,
    expectedSalaryOn: SALARY,
    incomes: [{ kind: "opening", currency: "LKR", amountMinor: 10_000_000, toSavingsMinor: 0 }],
    spends,
    commitments: [],
    pots: [],
    dayChoices: [],
    ...more,
  };
}

describe("a spend to finish may have no amount (spec 10)", () => {
  const ctx = { today: "2026-11-20", cycleStartedOn: "2026-11-12", spendingCurrency: "LKR" };
  const ok = { amountMinor: 0, spentOn: "2026-11-20", currency: "LKR", note: null };

  it("saves with no amount only with Finish later on", () => {
    expect(checkSpend({ ...ok, toFinish: true }, ctx)).toEqual([]);
    expect(checkSpend({ ...ok, toFinish: false }, ctx)).toEqual(["amount"]);
    expect(checkSpend(ok, ctx)).toEqual(["amount"]);
  });

  it("still never takes an amount below zero or a part of a unit", () => {
    expect(checkSpend({ ...ok, amountMinor: -5, toFinish: true }, ctx)).toEqual(["amount"]);
    expect(checkSpend({ ...ok, amountMinor: 1.5, toFinish: true }, ctx)).toEqual(["amount"]);
  });

  it("has no amount only while it is to finish and at zero", () => {
    expect(hasNoAmount({ amountMinor: 0, toFinish: true })).toBe(true);
    expect(hasNoAmount({ amountMinor: 500, toFinish: true })).toBe(false);
    expect(hasNoAmount({ amountMinor: 0, toFinish: false })).toBe(false);
    expect(hasNoAmount({ amountMinor: 0 })).toBe(false);
    expect(noAmountCount([blank(day(2)), spend(500, day(2), { toFinish: true }), blank(day(3))])).toBe(2);
  });
});

describe("a spend with no amount counts as zero (spec 7)", () => {
  it("leaves free money, the allowance and the verdict as they were", () => {
    const without = todayView(cycle([spend(300_000, day(3))]), day(3));
    const with_ = todayView(cycle([spend(300_000, day(3)), blank(day(3))]), day(3));
    expect(with_).toEqual(without);
  });

  it("re-counts once it is finished with its amount, like any change", () => {
    const v = todayView(cycle([spend(250_000, day(3), { toFinish: false })]), day(3));
    expect(v.spentTodayMinor).toBe(250_000);
    // Day 3: Rs 100,000 ÷ 8 days = Rs 12,500.
    expect(v.leftTodayMinor).toBe(1_000_000);
  });
});

describe("the underspend question waits for a spend with no amount (spec 7)", () => {
  it("is not asked while a day it covers has one", () => {
    expect(todayView(cycle([spend(400_000, day(1))]), day(2)).underspend).not.toBeNull();
    const held = todayView(cycle([spend(400_000, day(1)), blank(day(1))]), day(2));
    expect(held.underspend).toBeNull();
    // Unanswered, the allowance is the spread one.
    expect(held.allowanceMinor).toBe(1_066_600);
  });

  it("rolls the held days into the next question once it is finished", () => {
    // Day 1 held, day 2 spent nothing: on day 3 still held; finished, both days are asked about.
    expect(todayView(cycle([blank(day(1))]), day(3)).underspend).toBeNull();
    const asked = todayView(cycle([spend(200_000, day(1))]), day(3)).underspend;
    expect(asked?.days).toBe(2);
  });

  it("is asked again for days after an answered one, without the spend's day", () => {
    const spends = [blank(day(1)), spend(1_000_000, day(2)), spend(400_000, day(3))];
    // Day 1 held into day 2's question; answered on day 2 (Spread), day 3's own question is asked on day 4.
    const choices = [{ dayOn: day(2), choice: "spread" as const }];
    expect(todayView(cycle(spends), day(2)).underspend).toBeNull();
    expect(todayView(cycle(spends, { dayChoices: choices }), day(4)).underspend?.days).toBe(2);
  });

  it("is asked for the spends of today only from the next morning", () => {
    expect(todayView(cycle([spend(400_000, day(1)), blank(day(2))]), day(2)).underspend).not.toBeNull();
  });
});

describe("words for a spend with no amount (spec 6, 10)", () => {
  it("says free money may be lower", () => {
    expect(noAmountLine(1)).toBe("May be lower: 1 spend has no amount");
    expect(noAmountLine(3)).toBe("May be lower: 3 spends have no amount");
  });

  it("asks salary day to correct what is in hand for it", () => {
    expect(noAmountInHandNote(1)).toBe("1 spend has no amount: correct in hand for it.");
    expect(noAmountInHandNote(2)).toBe("2 spends have no amount: correct in hand for them.");
  });
});

describe("spends CSV (spec 14)", () => {
  const row = {
    spentOn: "2026-11-12",
    currency: "LKR",
    note: null,
    pot: null,
    card: null,
    oneOff: false,
    cycleStartedOn: "2026-10-25",
  };

  it("leaves the amount cell empty for a spend with no amount", () => {
    const out = spendsCsv([{ ...row, amountMinor: 0, toFinish: true }]).split("\r\n");
    expect(out[1]).toBe("2026-11-12,,LKR,,,,,2026-10-25");
  });

  it("writes a guessed amount of a spend to finish as it is", () => {
    const out = spendsCsv([{ ...row, amountMinor: 75_000, toFinish: true }]).split("\r\n");
    expect(out[1]).toBe("2026-11-12,750.00,LKR,,,,,2026-10-25");
  });
});
