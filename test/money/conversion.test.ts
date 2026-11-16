import { describe, expect, it } from "vitest";
import {
  broughtInSalary,
  type ClosingEntries,
  type CycleEntries,
  checkConversion,
  checkCycleClose,
  conversionSplit,
  freeIn,
  freeMoney,
  leftoverOf,
  minorAtLeast,
  rateOf,
  salaryLeftoverOf,
  todayView,
  uncoveredMinor,
} from "../../src/money";

// Change dollars (spec 8, 6; item 16). Each case names the rule it checks (spec 16).
// Salary in dollars, spending in rupees. $1,000 held, no rupees, a Rs 30,000 rupee
// bill set aside; reserve rate Rs 300 a dollar, counting rate Rs 310 unless a case
// says otherwise.

const base: CycleEntries = {
  spendingCurrency: "LKR",
  salaryCurrency: "USD",
  countingRate: "310",
  reserveRate: "300",
  startedOn: "2026-11-25",
  expectedSalaryOn: "2026-12-25",
  incomes: [
    { kind: "salary", currency: "USD", amountMinor: 100_000, toSavingsMinor: 0, receivedOn: "2026-11-25" },
  ],
  spends: [],
  commitments: [
    { currency: "LKR", plannedMinor: 3_000_000, dueOn: "2026-12-05", state: "open", payments: [] },
  ],
};

describe("a conversion's rate is the one actually got (spec 8)", () => {
  it("is rupees received for one dollar given, rounded down to 6 decimals", () => {
    expect(rateOf(10_000, 3_025_000, "USD", "LKR")).toBe("302.5");
    expect(rateOf(300, 100_000, "USD", "LKR")).toBe("333.333333");
    expect(rateOf(100, 30_000, "USD", "LKR")).toBe("300");
  });

  it("is none without both amounts above zero", () => {
    expect(rateOf(0, 30_000, "USD", "LKR")).toBeNull();
    expect(rateOf(100, 0, "USD", "LKR")).toBeNull();
    expect(rateOf(1_000_000_000, 1, "USD", "LKR")).toBeNull(); // rounds to nothing
  });
});

describe("rupee set-asides past the rupees are reserved from the dollars at the reserve rate (spec 8)", () => {
  it("reserves the dollars rounded up, so free money is never overstated", () => {
    expect(minorAtLeast(3_000_000, "300", "USD", "LKR")).toBe(10_000);
    expect(minorAtLeast(100_000, "300", "USD", "LKR")).toBe(334); // Rs 1,000 → $3.34
    expect(minorAtLeast(0, "300", "USD", "LKR")).toBe(0);
  });

  it("counts only the dollars past the reserved ones, at the counting rate", () => {
    // $1,000 − $100 reserved at 300 = $900, at 310 = Rs 279,000.
    expect(uncoveredMinor(base)).toBe(3_000_000);
    expect(freeMoney(base)).toBe(27_900_000);
  });

  it("reserves at the counting rate when the cycle has no reserve rate (first use before item 16)", () => {
    // Rs 30,000 at 310 = $96.78 reserved; $903.22 at 310 = Rs 279,998.20.
    expect(freeMoney({ ...base, reserveRate: null })).toBe(27_999_820);
  });

  it("without dollars enough, the rest of the bill is spent past free money", () => {
    const short = {
      ...base,
      incomes: [{ ...base.incomes[0], amountMinor: 5_000 } as CycleEntries["incomes"][number]],
    };
    // $50 covers Rs 15,000 at 300; Rs 15,000 still not covered.
    expect(freeMoney(short)).toBe(-1_500_000);
  });

  it("covers nothing when the rupees cover the rupee bills", () => {
    const rupees: CycleEntries = {
      ...base,
      incomes: [
        ...base.incomes,
        { kind: "opening", currency: "LKR", amountMinor: 5_000_000, toSavingsMinor: 0 },
      ],
    };
    expect(uncoveredMinor(rupees)).toBe(0);
    expect(freeMoney(rupees)).toBe(2_000_000 + 31_000_000);
  });
});

describe("bills first: a conversion's rupees cover rupee set-asides not yet covered (spec 8)", () => {
  it("at the reserve rate, all of it covers the bill with no gain or loss", () => {
    expect(conversionSplit(base, 10_000, 3_000_000)).toEqual({
      rate: "300",
      coveredMinor: 3_000_000,
      toFreeMinor: 0,
      gainMinor: 0,
    });
  });

  it("a better rate: the gain on the covering part goes to rupee savings", () => {
    // $100 at 310 = Rs 31,000: Rs 30,000 covers the bill, Rs 1,000 is a gain.
    expect(conversionSplit(base, 10_000, 3_100_000)).toEqual({
      rate: "310",
      coveredMinor: 3_000_000,
      toFreeMinor: 0,
      gainMinor: 100_000,
    });
  });

  it("a worse rate: the loss comes out of free money, the bill is covered as far as the rupees go", () => {
    expect(conversionSplit(base, 10_000, 2_900_000)).toEqual({
      rate: "290",
      coveredMinor: 2_900_000,
      toFreeMinor: 0,
      gainMinor: -100_000,
    });
  });

  it("works the gain out on the covering part only; the rest is free money", () => {
    // $200 at 310: $100 was reserved for the bill → Rs 31,000, gain Rs 1,000; Rs 31,000 to free money.
    expect(conversionSplit(base, 20_000, 6_200_000)).toEqual({
      rate: "310",
      coveredMinor: 3_000_000,
      toFreeMinor: 3_100_000,
      gainMinor: 100_000,
    });
  });

  it("with nothing to cover, all of it is free money", () => {
    const covered = { ...base, commitments: [] };
    expect(conversionSplit(covered, 10_000, 3_100_000)).toEqual({
      rate: "310",
      coveredMinor: 0,
      toFreeMinor: 3_100_000,
      gainMinor: 0,
    });
  });
});

describe("a conversion moves money between the currencies (spec 8)", () => {
  const changed = (given: number, received: number, countingRate: string): CycleEntries => {
    const split = conversionSplit(base, given, received);
    return {
      ...base,
      countingRate,
      conversions: [{ givenMinor: given, receivedMinor: received, gainMinor: split.gainMinor }],
    };
  };

  it("dollars out, rupees in; the gain is not free money", () => {
    const after = changed(10_000, 3_100_000, "310");
    expect(freeIn(after, "USD")).toBe(90_000);
    expect(freeIn(after, "LKR")).toBe(0);
    expect(freeMoney(after)).toBe(27_900_000);
  });

  it("a loss lowers free money: the bill still short is reserved from the dollars", () => {
    const after = changed(10_000, 2_900_000, "290");
    expect(freeIn(after, "LKR")).toBe(-100_000);
    // Rs 1,000 at 300 = $3.34 reserved; $896.66 at 290 = Rs 260,031.40.
    expect(freeMoney(after)).toBe(26_003_140);
  });

  it("recalculates today's allowance at once, like a new counting rate (spec 7)", () => {
    const after = changed(20_000, 6_200_000, "310");
    const today = "2026-11-30";
    const view = todayView(after, today);
    expect(view.freeMinor).toBe(freeMoney(after, today));
    expect(view.allowanceMinor).toBe(Math.floor(view.freeMinor / 25 / 100) * 100);
  });
});

describe("checks Change dollars (spec 8)", () => {
  const ctx = {
    spendingCurrency: "LKR",
    salaryCurrency: "USD",
    cycleStartedOn: "2026-11-25",
    today: "2026-11-30",
  };

  it("takes dollars given, rupees received and a day in this cycle up to today", () => {
    expect(
      checkConversion({ givenMinor: 10_000, receivedMinor: 3_000_000, doneOn: "2026-11-30" }, ctx),
    ).toEqual([]);
    expect(
      checkConversion({ givenMinor: 10_000, receivedMinor: 3_000_000, doneOn: "2026-11-25" }, ctx),
    ).toEqual([]);
  });

  it("refuses amounts not above zero, days outside the cycle, and one currency", () => {
    expect(checkConversion({ givenMinor: 0, receivedMinor: -1, doneOn: "2026-12-01" }, ctx)).toEqual([
      "given",
      "received",
      "done_on",
    ]);
    expect(checkConversion({ givenMinor: 1, receivedMinor: 1, doneOn: "2026-11-24" }, ctx)).toEqual([
      "done_on",
    ]);
    expect(
      checkConversion(
        { givenMinor: 1, receivedMinor: 1, doneOn: "2026-11-30" },
        { ...ctx, salaryCurrency: undefined },
      ),
    ).toEqual(["currency"]);
    expect(
      checkConversion({ givenMinor: 1_000_000_000, receivedMinor: 1, doneOn: "2026-11-30" }, ctx),
    ).toEqual(["rate"]);
  });
});

describe("salary day: the leftover per currency (spec 6, 8)", () => {
  const closing: ClosingEntries = {
    ...base,
    incomes: [
      ...base.incomes,
      { kind: "opening", currency: "LKR", amountMinor: 1_000_000, toSavingsMinor: 0 },
    ],
    commitments: [
      {
        id: "k1",
        currency: "LKR",
        plannedMinor: 3_000_000,
        dueOn: "2026-12-05",
        state: "finished",
        payments: [{ amountMinor: 3_000_000, currency: "LKR", paidOn: "2026-12-05" }],
      },
    ],
  };

  it("rupees short are covered from the leftover dollars at the reserve rate", () => {
    // Rs 10,000 held, Rs 30,000 paid: Rs 20,000 short → $66.67 at 300.
    const l = leftoverOf(closing, []);
    expect(l.freeMinor).toBe(-2_000_000);
    expect(l.fromSalaryMinor).toBe(2_000_000);
    expect(l.leftoverMinor).toBe(0);
    expect(salaryLeftoverOf(closing, [])).toBe(100_000 - 6_667);
  });

  it("with no rupees short, the dollars are their own leftover", () => {
    const rich = { ...closing, commitments: [] };
    expect(leftoverOf(rich, []).fromSalaryMinor).toBe(0);
    expect(leftoverOf(rich, []).leftoverMinor).toBe(1_000_000);
    expect(salaryLeftoverOf(rich, [])).toBe(100_000);
  });

  it("dollars go to dollar savings or carry over, with an in-hand correction", () => {
    const input = {
      unpaid: [],
      inHandMinor: null,
      toSavingsMinor: 0,
      overspend: null,
      salaryInHandMinor: 90_000,
      salaryToSavingsMinor: 40_000,
    };
    expect(broughtInSalary(input, 93_333)).toEqual({
      amountMinor: 90_000,
      toSavingsMinor: 40_000,
      correctionMinor: -3_333,
    });
    expect(broughtInSalary({ ...input, salaryInHandMinor: null }, 93_333)).toEqual({
      amountMinor: 93_333,
      toSavingsMinor: 40_000,
      correctionMinor: 0,
    });
  });

  it("refuses saving more dollars than are in hand; dollars below zero carry whole", () => {
    const leftover = leftoverOf({ ...closing, commitments: [] }, []);
    const ctx = { unpaidIds: [], leftover, salaryLeftoverMinor: 100_000 };
    const input = {
      unpaid: [],
      inHandMinor: null,
      toSavingsMinor: 0,
      overspend: null,
      salaryInHandMinor: null,
      salaryToSavingsMinor: 100_001,
    };
    expect(checkCycleClose(input, ctx)).toEqual(["salary_to_savings"]);
    expect(checkCycleClose({ ...input, salaryToSavingsMinor: 100_000 }, ctx)).toEqual([]);
    expect(checkCycleClose({ ...input, salaryInHandMinor: -1, salaryToSavingsMinor: 0 }, ctx)).toEqual([
      "salary_in_hand",
    ]);
    const below = { ...ctx, salaryLeftoverMinor: -500 };
    expect(checkCycleClose({ ...input, salaryToSavingsMinor: 1 }, below)).toEqual(["salary_to_savings"]);
    expect(broughtInSalary({ ...input, salaryToSavingsMinor: 0 }, -500)).toEqual({
      amountMinor: -500,
      toSavingsMinor: 0,
      correctionMinor: 0,
    });
  });
});
