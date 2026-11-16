import fc from "fast-check";
import { describe, expect, it } from "vitest";
import {
  type CommitmentEntry,
  checkSalaryDay,
  dueOnFrom,
  type RecurringEntry,
  type SalaryDayInput,
  salaryDayDrafts,
  salaryDayGapMinor,
  salaryDayView,
  usualDayOf,
} from "../../src/money";

// Item 11 · Salary day: new cycle. Each case names the rule it checks (spec 2, 3, 6).

const rent: RecurringEntry = {
  id: "r-rent",
  name: "Rent",
  kind: "bill",
  currency: "LKR",
  usualAmountMinor: 3_600_000,
  usualDay: 1,
  active: true,
};
const phone: RecurringEntry = {
  ...rent,
  id: "r-phone",
  name: "Phone",
  usualAmountMinor: 250_000,
  usualDay: 28,
};

describe("usual day and the due date it makes (spec 3: filled with the last day)", () => {
  it("the usual day is the due date's day of the month", () => {
    expect(usualDayOf("2026-11-28")).toBe(28);
    expect(usualDayOf("2026-12-01")).toBe(1);
  });

  it("the due date is the first such day on or after the cycle's start", () => {
    expect(dueOnFrom("2026-11-25", 28)).toBe("2026-11-28");
    expect(dueOnFrom("2026-11-25", 25)).toBe("2026-11-25");
    expect(dueOnFrom("2026-11-25", 1)).toBe("2026-12-01");
  });

  it("a day past the month's end falls on its last day", () => {
    expect(dueOnFrom("2027-02-10", 31)).toBe("2027-02-28");
    expect(dueOnFrom("2026-11-25", 31)).toBe("2026-11-30");
  });

  it("is never before the start and less than about a month after it", () => {
    const day = fc.integer({ min: 1, max: 31 });
    const start = fc
      .integer({ min: 0, max: 3650 })
      .map((n) => new Date(Date.UTC(2026, 0, 1) + n * 86_400_000).toISOString().slice(0, 10));
    fc.assert(
      fc.property(start, day, (s, d) => {
        const due = dueOnFrom(s, d);
        const gap = (Date.parse(due) - Date.parse(s)) / 86_400_000;
        return due >= s && gap < 31;
      }),
      { seed: 20261115 },
    );
  });
});

describe("step 4 is filled from the recurring ones (spec 3, 6)", () => {
  it("each active recurring commitment gives a row with its last amount and day", () => {
    const rows = salaryDayDrafts({ recurring: [rent, phone], comingUp: [], startedOn: "2026-11-25" });
    expect(rows).toEqual([
      {
        recurringId: "r-phone",
        carriedFromId: null,
        name: "Phone",
        kind: "bill",
        currency: "LKR",
        plannedMinor: 250_000,
        dueOn: "2026-11-28",
        everyCycle: true,
      },
      {
        recurringId: "r-rent",
        carriedFromId: null,
        name: "Rent",
        kind: "bill",
        currency: "LKR",
        plannedMinor: 3_600_000,
        dueOn: "2026-12-01",
        everyCycle: true,
      },
    ]);
  });

  it("a paused one is not filled in", () => {
    const rows = salaryDayDrafts({
      recurring: [rent, { ...phone, active: false }],
      comingUp: [],
      startedOn: "2026-11-25",
    });
    expect(rows.map((r) => r.name)).toEqual(["Rent"]);
  });

  it("last cycle's commitments due after its salary day come along, with what is still to pay", () => {
    const comingUp = [
      {
        id: "k-gym",
        recurringId: null,
        name: "Gym",
        kind: "bill" as const,
        currency: "LKR",
        plannedMinor: 500_000,
        dueOn: "2026-11-27",
        state: "open" as const,
        payments: [{ amountMinor: 200_000, currency: "LKR", paidOn: "2026-11-20" }],
      },
    ];
    const rows = salaryDayDrafts({ recurring: [], comingUp, startedOn: "2026-11-25" });
    expect(rows).toEqual([
      {
        recurringId: null,
        carriedFromId: "k-gym",
        name: "Gym",
        kind: "bill",
        currency: "LKR",
        plannedMinor: 300_000,
        dueOn: "2026-11-27",
        everyCycle: false,
      },
    ]);
  });

  it("a coming-up one made from a recurring one stands in for it (no second row)", () => {
    const comingUp = [
      {
        id: "k-rent",
        recurringId: "r-rent",
        name: "Rent",
        kind: "bill" as const,
        currency: "LKR",
        plannedMinor: 3_700_000,
        dueOn: "2026-12-01",
        state: "open" as const,
      },
    ];
    const rows = salaryDayDrafts({ recurring: [rent], comingUp, startedOn: "2026-11-25" });
    expect(rows).toEqual([
      {
        recurringId: "r-rent",
        carriedFromId: "k-rent",
        name: "Rent",
        kind: "bill",
        currency: "LKR",
        plannedMinor: 3_700_000,
        dueOn: "2026-12-01",
        everyCycle: true,
      },
    ]);
  });

  it("a fully paid coming-up one is left behind", () => {
    const comingUp = [
      {
        id: "k-gym",
        recurringId: null,
        name: "Gym",
        kind: "bill" as const,
        currency: "LKR",
        plannedMinor: 500_000,
        dueOn: "2026-11-27",
        state: "open" as const,
        payments: [{ amountMinor: 500_000, currency: "LKR", paidOn: "2026-11-20" }],
      },
    ];
    expect(salaryDayDrafts({ recurring: [], comingUp, startedOn: "2026-11-25" })).toEqual([]);
  });
});

describe("the gap warning (spec 2: set-asides larger than the salary)", () => {
  const bill = (plannedMinor: number, dueOn = "2026-12-01"): CommitmentEntry => ({
    currency: "LKR",
    plannedMinor,
    dueOn,
    state: "open",
  });

  it("no gap when commitments and pots fit in the salary", () => {
    expect(
      salaryDayGapMinor({
        salaryMinor: 10_000_000,
        expectedSalaryOn: "2026-12-25",
        currency: "LKR",
        commitments: [bill(6_000_000)],
        pots: [{ id: "p", currency: "LKR", amountMinor: 4_000_000, archived: false }],
      }),
    ).toBe(0);
  });

  it("the gap is what they are over the salary", () => {
    expect(
      salaryDayGapMinor({
        salaryMinor: 10_000_000,
        expectedSalaryOn: "2026-12-25",
        currency: "LKR",
        commitments: [bill(6_000_000), { ...bill(1_000_000), kind: "savings" } as CommitmentEntry],
        pots: [{ id: "p", currency: "LKR", amountMinor: 4_500_000, archived: false }],
      }),
    ).toBe(1_500_000);
  });

  it("one due after the expected salary day is not set aside, so not counted", () => {
    expect(
      salaryDayGapMinor({
        salaryMinor: 1_000_000,
        expectedSalaryOn: "2026-12-25",
        currency: "LKR",
        commitments: [bill(6_000_000, "2026-12-26")],
        pots: [],
      }),
    ).toBe(0);
  });
});

const input = (more: Partial<SalaryDayInput> = {}): SalaryDayInput => ({
  salaryMinor: 25_000_000,
  receivedOn: "2026-11-25",
  expectedSalaryOn: "2026-12-25",
  commitments: [{ name: "Rent", plannedMinor: 3_600_000, dueOn: "2026-12-01" }],
  pots: [{ name: "Groceries", usualAmountMinor: 1_800_000, amountMinor: 1_800_000 }],
  ...more,
});
const ctx = { today: "2026-11-25", cycleStartedOn: "2026-10-25", spendingCurrency: "LKR" };

describe("checks on Start new cycle (spec 2, 6)", () => {
  it("a good salary day has no problems", () => {
    expect(checkSalaryDay(input(), ctx)).toEqual([]);
  });

  it("the salary is a whole amount above zero", () => {
    expect(checkSalaryDay(input({ salaryMinor: 0 }), ctx)).toEqual(["salary"]);
    expect(checkSalaryDay(input({ salaryMinor: 1.5 }), ctx)).toEqual(["salary"]);
  });

  it("received today or earlier, and not before the cycle that ends", () => {
    expect(checkSalaryDay(input({ receivedOn: "2026-11-26" }), ctx)).toEqual(["received_on"]);
    expect(checkSalaryDay(input({ receivedOn: "2026-10-24" }), ctx)).toEqual(["received_on"]);
    expect(checkSalaryDay(input({ receivedOn: "2026-10-25" }), ctx)).toEqual([]);
    expect(checkSalaryDay(input({ receivedOn: "25 Nov" }), ctx)).toEqual(["received_on"]);
  });

  it("salary early is fine: entering it ends the current cycle early (spec 2)", () => {
    expect(checkSalaryDay(input({ receivedOn: "2026-11-20" }), { ...ctx, today: "2026-11-20" })).toEqual([]);
  });

  it("the next expected salary day is after today", () => {
    expect(checkSalaryDay(input({ expectedSalaryOn: "2026-11-25" }), ctx)).toEqual(["expected_salary_on"]);
  });

  it("each commitment and pot is checked like on Plan, with its place in the list", () => {
    const problems = checkSalaryDay(
      input({
        commitments: [
          { name: "Rent", plannedMinor: 3_600_000, dueOn: "2026-12-01" },
          { name: " ", plannedMinor: 0, dueOn: "2026-11-24" },
        ],
        pots: [{ name: "Fuel", usualAmountMinor: -1, amountMinor: 1 }],
      }),
      ctx,
    );
    expect(problems).toEqual([
      "commitment.1.name",
      "commitment.1.amount",
      "commitment.1.due_on",
      "pot.0.usual_amount",
    ]);
  });
});

describe("the counting rate in step 6 (spec 6, 8)", () => {
  const two = { ...ctx, salaryCurrency: "USD" };

  it("a two-currency user may give a new counting rate; none keeps the current one", () => {
    expect(checkSalaryDay(input({ countingRate: "302.5" }), two)).toEqual([]);
    expect(checkSalaryDay(input({ countingRate: null }), two)).toEqual([]);
    expect(checkSalaryDay(input(), two)).toEqual([]);
  });

  it("the rate is a plain number above zero, as typed", () => {
    expect(checkSalaryDay(input({ countingRate: "0" }), two)).toEqual(["counting_rate"]);
    expect(checkSalaryDay(input({ countingRate: "3,02" }), two)).toEqual(["counting_rate"]);
    expect(checkSalaryDay(input({ countingRate: "abc" }), two)).toEqual(["counting_rate"]);
  });

  it("with one currency there is no counting rate to give", () => {
    expect(checkSalaryDay(input({ countingRate: "300" }), ctx)).toEqual(["counting_rate"]);
  });

  it("the summary counts the salary at the rate given in step 6", () => {
    const view = (countingRate: string) =>
      salaryDayView({
        input: input({ salaryMinor: 100_000, commitments: [], pots: [] }),
        spendingCurrency: "LKR",
        salaryCurrency: "USD",
        countingRate,
        today: "2026-11-25",
        lastSpeed: null,
      });
    // $1,000 at Rs 300 is Rs 300,000; at Rs 310 it is Rs 310,000.
    expect(view("300").today.freeMinor).toBe(30_000_000);
    expect(view("310").today.freeMinor).toBe(31_000_000);
  });
});

describe("the summary (spec 6 step 7)", () => {
  it("free money is the salary less set-asides; the allowance counts days to the next salary", () => {
    const v = salaryDayView({
      input: input(),
      spendingCurrency: "LKR",
      today: "2026-11-25",
      lastSpeed: null,
    });
    // 250,000 − 36,000 − 18,000 = 196,000 over 30 days → 6,533 a day.
    expect(v.today.freeMinor).toBe(19_600_000);
    expect(v.today.daysLeft).toBe(30);
    expect(v.today.allowanceMinor).toBe(653_300);
    expect(v.gapMinor).toBe(0);
    expect(v.today.verdict.kind).toBe("early");
  });

  it("uses the cycle that ends for the verdict in the first days", () => {
    const v = salaryDayView({
      input: input(),
      spendingCurrency: "LKR",
      today: "2026-11-25",
      lastSpeed: { totalMinor: 30 * 500_000, days: 30 },
    });
    expect(v.today.verdict.kind).toBe("on_track");
  });

  it("shows the gap when the set-asides are more than the salary", () => {
    const v = salaryDayView({
      input: input({ salaryMinor: 5_000_000 }),
      spendingCurrency: "LKR",
      today: "2026-11-25",
      lastSpeed: null,
    });
    expect(v.gapMinor).toBe(400_000);
    expect(v.today.freeMinor).toBe(-400_000);
  });
});
