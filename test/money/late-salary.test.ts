import { describe, expect, it } from "vitest";
import {
  type CycleEntries,
  checkExpectedSalaryDay,
  checkSalaryAmount,
  isSalaryLate,
  lateSalaryDays,
  todayView,
} from "../../src/money";

// Item 13 · Late salary and the salary amount. Each case names the rule it checks (spec 2, 7).

/** A cycle that started 1 Nov with Rs 30,000 and expected the salary on 25 Nov. */
const cycle = (more: Partial<CycleEntries> = {}): CycleEntries => ({
  spendingCurrency: "LKR",
  startedOn: "2026-11-01",
  expectedSalaryOn: "2026-11-25",
  incomes: [
    { kind: "salary", currency: "LKR", amountMinor: 3_000_000, toSavingsMinor: 0, receivedOn: "2026-11-01" },
  ],
  spends: [],
  commitments: [],
  ...more,
});

describe("salary late (spec 2: the expected salary day passes with no salary entered)", () => {
  it("is late on the expected salary day and after it, not before", () => {
    expect(isSalaryLate("2026-11-24", "2026-11-25")).toBe(false);
    expect(isSalaryLate("2026-11-25", "2026-11-25")).toBe(true);
    expect(isSalaryLate("2026-11-30", "2026-11-25")).toBe(true);
  });

  it("counts how many days late it is: 0 on the expected day itself", () => {
    expect(lateSalaryDays("2026-11-24", "2026-11-25")).toBe(0);
    expect(lateSalaryDays("2026-11-25", "2026-11-25")).toBe(0);
    expect(lateSalaryDays("2026-11-28", "2026-11-25")).toBe(3);
  });

  it("while late and no new day is given, all free money is today's (no days left)", () => {
    const view = todayView(cycle(), "2026-11-26");
    expect(view.daysLeft).toBe(0);
    expect(view.allowanceMinor).toBe(3_000_000);
  });

  it("a new expected day re-counts the days: what is left is spread over the extra days", () => {
    // Late on 26 Nov, new expected day 29 Nov: 26, 27, 28 → Rs 10,000 a day.
    const view = todayView(cycle({ expectedSalaryOn: "2026-11-29" }), "2026-11-26");
    expect(view.daysLeft).toBe(3);
    expect(view.allowanceMinor).toBe(1_000_000);
    expect(view.tomorrowMinor).toBe(1_500_000);
  });

  it("spends of the late days stay counted: only what is left is spread", () => {
    const spends = [
      { spentOn: "2026-11-25", currency: "LKR", amountMinor: 2_000_000, potId: null, oneOff: false },
    ];
    const view = todayView(cycle({ expectedSalaryOn: "2026-11-28", spends }), "2026-11-26");
    expect(view.freeMinor).toBe(1_000_000);
    expect(view.daysLeft).toBe(2);
    expect(view.allowanceMinor).toBe(500_000);
  });
});

describe("changing the expected salary day (spec 2: confirmed on salary day, can be changed later)", () => {
  it("must be a day after today, so at least today is left to count", () => {
    expect(checkExpectedSalaryDay("2026-11-27", "2026-11-26")).toEqual([]);
    expect(checkExpectedSalaryDay("2026-11-26", "2026-11-26")).toEqual(["expected_salary_on"]);
    expect(checkExpectedSalaryDay("2026-11-20", "2026-11-26")).toEqual(["expected_salary_on"]);
    expect(checkExpectedSalaryDay("26 Nov", "2026-11-26")).toEqual(["expected_salary_on"]);
  });
});

describe("the salary amount stays editable in the current cycle (spec 2)", () => {
  it("must be a whole amount above zero", () => {
    expect(checkSalaryAmount(25_000_000)).toEqual([]);
    expect(checkSalaryAmount(0)).toEqual(["salary"]);
    expect(checkSalaryAmount(-5)).toEqual(["salary"]);
    expect(checkSalaryAmount(1.5)).toEqual(["salary"]);
  });

  it("a changed salary changes free money and today's allowance at once", () => {
    const more = cycle({
      incomes: [
        {
          kind: "salary",
          currency: "LKR",
          amountMinor: 3_600_000,
          toSavingsMinor: 0,
          receivedOn: "2026-11-01",
        },
      ],
    });
    // 20 Nov: 5 days left (20–24).
    expect(todayView(cycle(), "2026-11-20").allowanceMinor).toBe(600_000);
    expect(todayView(more, "2026-11-20").allowanceMinor).toBe(720_000);
  });
});
