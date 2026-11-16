import { describe, expect, it } from "vitest";
import {
  atRate,
  type CycleEntries,
  checkCommitment,
  checkPot,
  checkSavingsMove,
  checkSpend,
  combinedSavingsMinor,
  firstUseView,
  freeIn,
  freeMoney,
  isRate,
  parseRate,
  salaryDayGapMinor,
  salaryLeftoverOf,
  todayView,
} from "../../src/money";

// Two currencies (spec 8, item 15). Each case names the rule it checks (spec 16).
// Salary in dollars, spending in rupees; Rs 300 a dollar unless a case says otherwise.

const two = { spendingCurrency: "LKR", salaryCurrency: "USD" } as const;

const base: CycleEntries = {
  ...two,
  countingRate: "300",
  startedOn: "2026-11-25",
  expectedSalaryOn: "2026-12-25",
  incomes: [
    { kind: "salary", currency: "USD", amountMinor: 100_000, toSavingsMinor: 0, receivedOn: "2026-11-25" },
    { kind: "opening", currency: "LKR", amountMinor: 1_000_000, toSavingsMinor: 0, receivedOn: "2026-11-25" },
  ],
  spends: [],
};

describe("the counting rate is typed by hand (spec 8)", () => {
  it("reads a plain number above zero, commas and spaces left out", () => {
    expect(parseRate("302.50")).toBe("302.50");
    expect(parseRate(" 1,302.5 ")).toBe("1302.5");
    expect(parseRate("0.0034")).toBe("0.0034");
    for (const bad of ["", "0", "0.000", "-3", "3e2", "1.2.3", "abc", "1.1234567"]) {
      expect(parseRate(bad), bad).toBeNull();
    }
  });

  it("knows a stored rate only exactly as kept", () => {
    expect(isRate("302.5")).toBe(true);
    expect(isRate("1,302")).toBe(false);
    expect(isRate(302)).toBe(false);
    expect(isRate(null)).toBe(false);
  });
});

describe("rounding: only where a rate is applied, always down (spec 8)", () => {
  it("counts dollars in rupees exactly, in whole numbers", () => {
    expect(atRate(1000, "302.50", "USD", "LKR")).toBe(302_500); // $10 → Rs 3,025
    expect(atRate(100, "2.05", "JPY", "LKR")).toBe(20_500); // ¥100 → Rs 205
  });

  it("rounds down to the minor unit, so free money is never overstated", () => {
    // $0.01 at 302.555 is Rs 3.02555: 302 cents, not 303.
    expect(atRate(1, "302.555", "USD", "LKR")).toBe(302);
    // Below zero it rounds down too (further from zero).
    expect(atRate(-1, "302.555", "USD", "LKR")).toBe(-303);
  });
});

describe("money is held per currency; free dollars count at the counting rate (spec 8)", () => {
  it("free money is rupees plus the free dollars at the counting rate", () => {
    // Rs 10,000 + $1,000 × 300 = Rs 310,000.
    expect(freeMoney(base)).toBe(31_000_000);
    expect(freeIn(base, "USD")).toBe(100_000);
    expect(freeIn(base, "LKR")).toBe(1_000_000);
  });

  it("dollar set-asides come from the dollars, rupee ones from the rupees", () => {
    const entries: CycleEntries = {
      ...base,
      commitments: [
        { currency: "USD", plannedMinor: 10_000, dueOn: "2026-12-01", state: "open" },
        { currency: "LKR", plannedMinor: 500_000, dueOn: "2026-12-02", state: "open" },
      ],
      pots: [{ id: "p1", currency: "USD", amountMinor: 5_000, archived: false }],
    };
    expect(freeIn(entries, "USD")).toBe(85_000); // $1,000 − $100 − $50
    expect(freeIn(entries, "LKR")).toBe(500_000); // Rs 10,000 − Rs 5,000
    expect(freeMoney(entries)).toBe(500_000 + 85_000 * 300);
  });

  it("a spend in a dollar pot is in dollars and comes out of the pot first", () => {
    const entries: CycleEntries = {
      ...base,
      pots: [{ id: "p1", currency: "USD", amountMinor: 5_000, archived: false }],
      spends: [{ spentOn: "2026-11-26", currency: "USD", amountMinor: 7_000, potId: "p1" }],
    };
    // $20 past the empty pot comes out of the free dollars.
    expect(freeIn(entries, "USD")).toBe(93_000);
  });

  it("the free dollars are rounded down once, after adding them up", () => {
    const entries: CycleEntries = {
      ...base,
      countingRate: "302.555",
      incomes: [{ kind: "salary", currency: "USD", amountMinor: 3, toSavingsMinor: 0 }],
    };
    // 3 cents at 302.555 = 907.665 rupee cents → 907.
    expect(freeMoney(entries)).toBe(907);
  });

  it("without a counting rate the dollars count as nothing", () => {
    expect(freeMoney({ ...base, countingRate: null })).toBe(1_000_000);
  });

  it("with one currency nothing changes", () => {
    const one: CycleEntries = { ...base, salaryCurrency: "LKR", incomes: [base.incomes[1]!] };
    expect(freeMoney(one)).toBe(1_000_000);
  });

  it("a new counting rate changes today's allowance at once (spec 7)", () => {
    const at300 = todayView(base, "2026-11-25").allowanceMinor;
    const at310 = todayView({ ...base, countingRate: "310" }, "2026-11-25").allowanceMinor;
    // 30 days left: Rs 310,000 → Rs 10,333; Rs 320,000 → Rs 10,666.
    expect(at300).toBe(1_033_300);
    expect(at310).toBe(1_066_600);
  });
});

describe("commitments, pots and savings in either currency (spec 8)", () => {
  it("a commitment or pot may be in either of the user's currencies, no third", () => {
    const k = { name: "Netflix", plannedMinor: 1_500, dueOn: "2026-12-01" };
    expect(checkCommitment({ ...k, currency: "USD" }, { ...two, cycleStartedOn: "2026-11-25" })).toEqual([]);
    expect(checkCommitment({ ...k, currency: "EUR" }, { ...two, cycleStartedOn: "2026-11-25" })).toEqual([
      "currency",
    ]);
    const p = { name: "Apps", usualAmountMinor: 1_000, amountMinor: 1_000 };
    expect(checkPot({ ...p, currency: "USD" }, two)).toEqual([]);
    expect(checkPot({ ...p, currency: "USD" }, { spendingCurrency: "LKR" })).toEqual(["currency"]);
  });

  it("a spend is in rupees, or in dollars only in a dollar pot", () => {
    const ctx = {
      ...two,
      today: "2026-11-26",
      cycleStartedOn: "2026-11-25",
      pots: [{ id: "p1", currency: "USD", archived: false }],
    };
    const s = { amountMinor: 500, spentOn: "2026-11-26" };
    expect(checkSpend({ ...s, currency: "USD", potId: "p1" }, ctx)).toEqual([]);
    expect(checkSpend({ ...s, currency: "USD" }, ctx)).toEqual(["currency"]);
    expect(checkSpend({ ...s, currency: "LKR", potId: "p1" }, ctx)).toEqual(["pot"]);
  });

  it("savings: one total per currency, take out never past that currency's", () => {
    const moves = [
      { currency: "USD", amountMinor: 50_000 },
      { currency: "LKR", amountMinor: 2_000_000 },
    ];
    expect(
      checkSavingsMove({ kind: "take_out", currency: "USD", amountMinor: 50_000, totalMinor: 50_000 }, two),
    ).toEqual([]);
    expect(
      checkSavingsMove({ kind: "take_out", currency: "USD", amountMinor: 50_001, totalMinor: 50_000 }, two),
    ).toEqual(["too_much"]);
    // Combined, in rupees at the counting rate: Rs 20,000 + $500 × 300.
    expect(combinedSavingsMinor(moves, { ...two, countingRate: "300" })).toBe(2_000_000 + 15_000_000);
    expect(combinedSavingsMinor(moves, { spendingCurrency: "LKR" })).toBe(2_000_000);
  });
});

describe("first use and salary day with two currencies (spec 2, 6, 8)", () => {
  it("first use: money held per currency; the gap compares at the counting rate", () => {
    const view = firstUseView({
      ...two,
      countingRate: "300",
      heldMinor: 100_000, // Rs 1,000
      heldSalaryMinor: 10_000, // $100 = Rs 30,000
      today: "2026-11-25",
      expectedSalaryOn: "2026-12-25",
      commitments: [{ name: "Rent", currency: "LKR", plannedMinor: 4_000_000, dueOn: "2026-12-01" }],
      pots: [{ name: "Apps", currency: "USD", amountMinor: 1_000 }],
    });
    expect(view.setAsideMinor).toBe(4_000_000);
    expect(view.potsMinor).toBe(300_000); // $10
    // Rs 40,000 + Rs 3,000 − Rs 31,000.
    expect(view.gapMinor).toBe(1_200_000);
    expect(view.today.freeMinor).toBe(-1_200_000);
  });

  it("salary day: the salary is in dollars and the gap counts it at the counting rate", () => {
    const gap = (salaryMinor: number) =>
      salaryDayGapMinor({
        salaryMinor,
        expectedSalaryOn: "2026-12-25",
        currency: "LKR",
        salaryCurrency: "USD",
        countingRate: "300",
        commitments: [
          { currency: "LKR", plannedMinor: 9_000_000, dueOn: "2026-12-01", state: "open" },
          { currency: "USD", plannedMinor: 10_000, dueOn: "2026-12-01", state: "open" },
        ],
        pots: [],
      });
    // $400 − $100 = $300 = Rs 90,000: just covers the rent.
    expect(gap(40_000)).toBe(0);
    expect(gap(39_000)).toBe(300_000);
  });

  it("the salary currency's leftover is carried to the new cycle whole (item 15)", () => {
    const entries = {
      ...base,
      commitments: [
        { id: "k1", currency: "USD", plannedMinor: 10_000, dueOn: "2026-12-01", state: "open" as const },
        { id: "k2", currency: "USD", plannedMinor: 2_000, dueOn: "2026-12-02", state: "open" as const },
      ],
    };
    // Free $880, dropped $100 joins it, carried $20 goes with its commitment's money.
    expect(
      salaryLeftoverOf(entries, [
        { id: "k1", choice: "drop" },
        { id: "k2", choice: "carry" },
      ]),
    ).toBe(88_000 + 10_000 + 2_000);
    expect(salaryLeftoverOf({ ...entries, salaryCurrency: "LKR" }, [])).toBeNull();
  });
});
