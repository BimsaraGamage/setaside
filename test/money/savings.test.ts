import fc from "fast-check";
import { describe, expect, it } from "vitest";
import {
  addDays,
  type CycleEntries,
  checkIncome,
  checkSavingsMove,
  freeMoney,
  type IncomeEntry,
  type SavingsMove,
  type SpendEntry,
  savingsTotal,
  type TakeOutEntry,
  todayView,
} from "../../src/money";

// Item 10 · Savings and extra income. Each case names the rule it checks (spec 5, 7, 16).

const START = "2026-11-01";
const SALARY = "2026-11-11"; // 10 days: 1–10 Nov; Rs 100,000 held → Rs 10,000 a day
const day = (n: number) => addDays(START, n - 1);

const spend = (amountMinor: number, spentOn: string): SpendEntry => ({
  spentOn,
  currency: "LKR",
  amountMinor,
});

const extra = (amountMinor: number, toSavingsMinor: number, receivedOn: string): IncomeEntry => ({
  kind: "extra",
  currency: "LKR",
  amountMinor,
  toSavingsMinor,
  receivedOn,
});

const takeOut = (amountMinor: number, movedOn: string): TakeOutEntry => ({
  currency: "LKR",
  amountMinor,
  movedOn,
});

function cycle(more: Partial<CycleEntries> = {}): CycleEntries {
  return {
    spendingCurrency: "LKR",
    startedOn: START,
    expectedSalaryOn: SALARY,
    incomes: [
      { kind: "opening", currency: "LKR", amountMinor: 10_000_000, toSavingsMinor: 0, receivedOn: START },
    ],
    spends: [],
    commitments: [],
    pots: [],
    dayChoices: [],
    ...more,
  };
}

const withIncome = (more: IncomeEntry[], rest: Partial<CycleEntries> = {}) =>
  cycle({ ...rest, incomes: [...cycle().incomes, ...more] });

describe("extra income (spec 5)", () => {
  it("the free part raises free money and today's allowance at once", () => {
    // Day 5: 6 days left. Rs 100,000 + Rs 30,000 free (Rs 20,000 to savings) = Rs 130,000.
    const v = todayView(withIncome([extra(5_000_000, 2_000_000, day(5))]), day(5));
    expect(v.freeMinor).toBe(13_000_000);
    expect(v.allowanceMinor).toBe(2_166_600);
  });

  it("all of it to savings changes nothing in free money", () => {
    const before = todayView(cycle(), day(5));
    const after = todayView(withIncome([extra(5_000_000, 5_000_000, day(5))]), day(5));
    expect(after.freeMinor).toBe(before.freeMinor);
    expect(after.allowanceMinor).toBe(before.allowanceMinor);
  });

  it("does not count as money left over on the days before it came", () => {
    // Day 1: Rs 4,000 spent, Rs 6,000 not spent. A bonus on day 2 is not yesterday's unspent money.
    const spends = [spend(400_000, day(1))];
    const plain = todayView(cycle({ spends }), day(2));
    const bonus = todayView(withIncome([extra(9_000_000, 0, day(2))], { spends }), day(2));
    expect(bonus.underspend?.unspentMinor).toBe(plain.underspend?.unspentMinor);
    expect(bonus.underspend?.unspentMinor).toBe(600_000);
    // Spread: (Rs 96,000 + Rs 90,000) ÷ 9 days.
    expect(bonus.allowanceMinor).toBe(2_066_600);
  });

  it("a bonus on an earlier day of the cycle counts from that day on", () => {
    // Day 1 nothing spent: allowance Rs 10,000. Bonus Rs 18,000 on day 2, nothing spent on day 2:
    // day 2 allowance (Rs 100,000 + Rs 18,000) ÷ 9 = Rs 13,111. Day 3 asks about both days.
    const v = todayView(withIncome([extra(1_800_000, 0, day(2))]), day(3));
    expect(v.underspend?.unspentMinor).toBe(1_000_000 + 1_311_100);
  });
});

describe("take out of savings (spec 5)", () => {
  it("raises free money and today's allowance at once", () => {
    const v = todayView(cycle({ takenOut: [takeOut(1_200_000, day(5))] }), day(5));
    expect(v.freeMinor).toBe(11_200_000);
    expect(v.allowanceMinor).toBe(1_866_600);
  });

  it("does not count as money left over on the days before it", () => {
    const spends = [spend(400_000, day(1))];
    const v = todayView(cycle({ spends, takenOut: [takeOut(5_000_000, day(2))] }), day(2));
    expect(v.underspend?.unspentMinor).toBe(600_000);
  });

  it("other currencies wait for two currencies (item 15)", () => {
    const v = freeMoney(cycle({ takenOut: [{ currency: "USD", amountMinor: 10_000, movedOn: day(1) }] }));
    expect(v).toBe(10_000_000);
  });
});

describe("savings total (spec 5)", () => {
  const move = (amountMinor: number, currency = "LKR"): SavingsMove => ({ currency, amountMinor });

  it("adds what went in and takes off what came out, per currency", () => {
    const moves = [move(5_000_000), move(2_000_000), move(-1_500_000), move(10_000, "USD")];
    expect(savingsTotal(moves, "LKR")).toBe(5_500_000);
    expect(savingsTotal(moves, "USD")).toBe(10_000);
    expect(savingsTotal([], "LKR")).toBe(0);
  });

  it("money only moves: free money plus savings stays the same however income is split", () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 1, max: 1_000_000_000 }),
        fc.integer({ min: 0, max: 100 }),
        fc.integer({ min: 0, max: 100 }),
        (amount, savedPct, takenPct) => {
          const toSavings = Math.floor((amount * savedPct) / 100);
          const taken = Math.floor((toSavings * takenPct) / 100);
          const entries = withIncome([extra(amount, toSavings, day(3))], {
            takenOut: taken > 0 ? [takeOut(taken, day(3))] : [],
          });
          const saved = savingsTotal([move(toSavings), move(-taken)], "LKR");
          expect(freeMoney(entries) + saved).toBe(10_000_000 + amount);
        },
      ),
      { seed: 20261115 },
    );
  });
});

describe("checks (spec 5)", () => {
  const ctx = { spendingCurrency: "LKR" };

  it("extra income: amount above zero, to savings from zero up to the amount", () => {
    const ok = { kind: "extra" as const, currency: "LKR", amountMinor: 1_000_000, toSavingsMinor: 0 };
    expect(checkIncome(ok, ctx)).toEqual([]);
    expect(checkIncome({ ...ok, toSavingsMinor: 1_000_000 }, ctx)).toEqual([]);
    expect(checkIncome({ ...ok, amountMinor: 0 }, ctx)).toContain("amount");
    expect(checkIncome({ ...ok, amountMinor: 1.5 }, ctx)).toContain("amount");
    expect(checkIncome({ ...ok, toSavingsMinor: -1 }, ctx)).toContain("to_savings");
    expect(checkIncome({ ...ok, toSavingsMinor: 1_000_001 }, ctx)).toContain("to_savings");
  });

  it("extra income: one currency until item 15; loan, borrowed and paid back wait for items 19 and 20", () => {
    const ok = { kind: "extra" as const, currency: "LKR", amountMinor: 1_000_000, toSavingsMinor: 0 };
    expect(checkIncome({ ...ok, currency: "USD" }, ctx)).toContain("currency");
    for (const kind of ["loan", "borrowed", "paid_back", "salary", "opening"] as const) {
      expect(checkIncome({ ...ok, kind }, ctx)).toContain("kind");
    }
  });

  it("put in: any amount above zero", () => {
    const ok = { kind: "put_in" as const, currency: "LKR", amountMinor: 1, totalMinor: 0 };
    expect(checkSavingsMove(ok, ctx)).toEqual([]);
    expect(checkSavingsMove({ ...ok, amountMinor: 0 }, ctx)).toContain("amount");
    expect(checkSavingsMove({ ...ok, currency: "USD" }, ctx)).toContain("currency");
  });

  it("take out: no more than is saved", () => {
    const ok = { kind: "take_out" as const, currency: "LKR", amountMinor: 500_000, totalMinor: 500_000 };
    expect(checkSavingsMove(ok, ctx)).toEqual([]);
    expect(checkSavingsMove({ ...ok, amountMinor: 500_001 }, ctx)).toContain("too_much");
    expect(checkSavingsMove({ ...ok, amountMinor: -1 }, ctx)).toContain("amount");
  });
});
