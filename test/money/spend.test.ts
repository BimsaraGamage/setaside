import fc from "fast-check";
import { describe, expect, it } from "vitest";
import {
  addDays,
  type CycleEntries,
  checkSpend,
  freeMoney,
  type SpendEntry,
  todayView,
} from "../../src/money";

// Item 4 · Add a spend. Each case names the rule it checks (spec 16).

const opening = (amountMinor: number) => ({
  kind: "opening" as const,
  currency: "LKR",
  amountMinor,
  toSavingsMinor: 0,
});
const spend = (spentOn: string, amountMinor: number): SpendEntry => ({
  spentOn,
  currency: "LKR",
  amountMinor,
});

/** Rs 90,000 held, salary expected 30 Nov: on 12 Nov that is 18 days of Rs 5,000. */
function cycle(spends: SpendEntry[]): CycleEntries {
  return { spendingCurrency: "LKR", expectedSalaryOn: "2026-11-30", incomes: [opening(9_000_000)], spends };
}

describe("free money (glossary: spend)", () => {
  it("is lowered by every spend in the spending currency", () => {
    expect(freeMoney(cycle([spend("2026-11-12", 185_000), spend("2026-11-13", 15_000)]))).toBe(8_800_000);
  });

  it("at the start of a day leaves out that day's spends and later ones", () => {
    const e = cycle([spend("2026-11-12", 185_000), spend("2026-11-13", 15_000)]);
    expect(freeMoney(e, "2026-11-13")).toBe(8_815_000);
    expect(freeMoney(e, "2026-11-12")).toBe(9_000_000);
  });
});

describe("allowance is fixed for the day (spec 7)", () => {
  it("does not change with today's spends; they show against it", () => {
    // Spec 7: "Spent Rs 1,850 · Rs 3,500 left today" (allowance Rs 5,350 there; Rs 5,000 here).
    const view = todayView(cycle([spend("2026-11-12", 185_000)]), "2026-11-12");
    expect(view.allowanceMinor).toBe(500_000);
    expect(view.spentTodayMinor).toBe(185_000);
    expect(view.leftTodayMinor).toBe(315_000);
    expect(view.freeMinor).toBe(8_815_000);
  });

  it('goes over: left today is below zero ("Over by Rs 1,000")', () => {
    const view = todayView(cycle([spend("2026-11-12", 600_000)]), "2026-11-12");
    expect(view.allowanceMinor).toBe(500_000);
    expect(view.leftTodayMinor).toBe(-100_000);
  });

  it("recalculates the following days from what is left, so an overspend lowers them", () => {
    // Rs 6,000 spent on day 1 of 18: Rs 84,000 over the 17 days left = Rs 4,941.17… → Rs 4,941.
    const e = cycle([spend("2026-11-12", 600_000)]);
    expect(todayView(e, "2026-11-12").tomorrowMinor).toBe(494_100);
    expect(todayView(e, "2026-11-13").allowanceMinor).toBe(494_100);
    expect(todayView(e, "2026-11-13").spentTodayMinor).toBe(0);
  });

  it("an underspend also flows into the following days (spread; the question is item 9)", () => {
    const e = cycle([spend("2026-11-12", 100_000)]);
    // Rs 89,000 over 17 days = Rs 5,235.29… → Rs 5,235.
    expect(todayView(e, "2026-11-13").allowanceMinor).toBe(523_500);
  });

  it("a spend dated back counts in the free money at the start of today", () => {
    const e = cycle([spend("2026-11-12", 600_000)]);
    // Entered on the 13th, dated the 12th: the 13th starts from Rs 84,000.
    expect(todayView(e, "2026-11-13").allowanceMinor).toBe(494_100);
  });

  it("has no tomorrow's amount on the last day before salary", () => {
    expect(todayView(cycle([]), "2026-11-29").tomorrowMinor).toBeNull();
    expect(todayView(cycle([]), "2026-11-28").tomorrowMinor).toBe(9_000_000);
  });

  it("shows 0 today when free money at the start of the day is at zero or below", () => {
    const e = cycle([spend("2026-11-12", 9_500_000)]);
    const view = todayView(e, "2026-11-13");
    expect(view.freeMinor).toBe(-500_000);
    expect(view.allowanceMinor).toBe(0);
    expect(view.tomorrowMinor).toBe(0);
  });

  it("leaves out spends in another currency (two currencies come with item 15)", () => {
    const e = cycle([{ spentOn: "2026-11-12", currency: "USD", amountMinor: 1000 }]);
    expect(todayView(e, "2026-11-12").spentTodayMinor).toBe(0);
    expect(freeMoney(e)).toBe(9_000_000);
  });
});

describe("a spend is checked before it is saved (spec 2, 7)", () => {
  const ctx = { today: "2026-11-20", cycleStartedOn: "2026-11-12", spendingCurrency: "LKR" };
  const ok = { amountMinor: 185_000, spentOn: "2026-11-20", currency: "LKR", note: "lunch" };

  it("accepts a whole positive amount dated today with a note", () => {
    expect(checkSpend(ok, ctx)).toEqual([]);
    expect(checkSpend({ ...ok, note: null }, ctx)).toEqual([]);
  });

  it("can be dated back within the current cycle only, never ahead", () => {
    expect(checkSpend({ ...ok, spentOn: "2026-11-12" }, ctx)).toEqual([]);
    expect(checkSpend({ ...ok, spentOn: "2026-11-11" }, ctx)).toEqual(["spent_on"]);
    expect(checkSpend({ ...ok, spentOn: "2026-11-21" }, ctx)).toEqual(["spent_on"]);
    expect(checkSpend({ ...ok, spentOn: "20-11-2026" }, ctx)).toEqual(["spent_on"]);
  });

  it("needs a whole amount above zero in the spending currency", () => {
    expect(checkSpend({ ...ok, amountMinor: 0 }, ctx)).toEqual(["amount"]);
    expect(checkSpend({ ...ok, amountMinor: -5 }, ctx)).toEqual(["amount"]);
    expect(checkSpend({ ...ok, amountMinor: 1.5 }, ctx)).toEqual(["amount"]);
    expect(checkSpend({ ...ok, currency: "USD" }, ctx)).toEqual(["currency"]);
  });

  it("keeps the note short", () => {
    expect(checkSpend({ ...ok, note: "x".repeat(200) }, ctx)).toEqual([]);
    expect(checkSpend({ ...ok, note: "x".repeat(201) }, ctx)).toEqual(["note"]);
  });
});

describe("random spend orders: totals always add up (spec 16)", () => {
  const start = "2026-11-12";
  const salary = "2026-11-30";
  const arb = fc.record({
    held: fc.integer({ min: 0, max: 50_000_000 }),
    spends: fc.array(
      fc.record({ day: fc.integer({ min: 0, max: 17 }), amount: fc.integer({ min: 1, max: 5_000_000 }) }),
      { maxLength: 60 },
    ),
    today: fc.integer({ min: 0, max: 17 }),
  });

  it("free money, today's spends and the allowance agree in any order", () => {
    fc.assert(
      fc.property(arb, fc.func(fc.integer()), ({ held, spends, today: t }, order) => {
        const today = addDays(start, t);
        const list = spends.map((s) => spend(addDays(start, Math.min(s.day, t)), s.amount));
        const shuffled = [...list].sort((a, b) => order(a) - order(b));
        const e = (s: SpendEntry[]): CycleEntries => ({
          spendingCurrency: "LKR",
          expectedSalaryOn: salary,
          incomes: [opening(held)],
          spends: s,
        });
        const view = todayView(e(list), today);
        expect(todayView(e(shuffled), today)).toEqual(view);

        const total = list.reduce((n, s) => n + s.amountMinor, 0);
        const spentToday = list.filter((s) => s.spentOn === today).reduce((n, s) => n + s.amountMinor, 0);
        const atStart = freeMoney(e(list), today);
        expect(view.freeMinor).toBe(held - total);
        expect(view.spentTodayMinor).toBe(spentToday);
        expect(atStart - spentToday).toBe(view.freeMinor);
        expect(view.leftTodayMinor).toBe(view.allowanceMinor - spentToday);
        // The allowance never hands out more than the free money at the start of the day.
        expect(view.allowanceMinor).toBeGreaterThanOrEqual(0);
        expect(view.allowanceMinor * view.daysLeft).toBeLessThanOrEqual(Math.max(0, atStart));
      }),
      { numRuns: 2000, seed: 20261112 },
    );
  });
});
