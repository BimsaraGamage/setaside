import fc from "fast-check";
import { describe, expect, it } from "vitest";
import {
  type CycleEntries,
  checkPrepayment,
  freeMoney,
  type PrepaymentEntry,
  paybackCycles,
  paybackDrafts,
  paybackDueMinor,
  prepaymentProgress,
  prepaymentSavingMinor,
  savingsTotal,
} from "../../src/money";

// Item 14 · Prepayment from savings. Each case names the rule it checks (spec 5).

const gym: PrepaymentEntry = {
  id: "p1",
  name: "Gym",
  currency: "LKR",
  totalMinor: 6_000_000,
  paybackMinor: 500_000,
  paidBackMinor: 0,
};

const ctx = { spendingCurrency: "LKR", savingsMinor: 10_000_000 };

describe("checking a prepayment (spec 5)", () => {
  it("a year of gym, 60,000 from savings, 5,000 back each cycle, is fine", () => {
    expect(
      checkPrepayment({ name: "Gym", currency: "LKR", totalMinor: 6_000_000, paybackMinor: 500_000 }, ctx),
    ).toEqual([]);
  });

  it("needs a name, a whole amount above zero and a payback above zero", () => {
    expect(checkPrepayment({ name: " ", currency: "LKR", totalMinor: 0, paybackMinor: 0 }, ctx)).toEqual([
      "name",
      "amount",
      "payback",
    ]);
    expect(
      checkPrepayment({ name: "Gym", currency: "LKR", totalMinor: 1.5, paybackMinor: 1 }, ctx),
    ).toContain("amount");
  });

  it("can't take out more than is saved", () => {
    expect(
      checkPrepayment({ name: "Gym", currency: "LKR", totalMinor: 10_000_001, paybackMinor: 500_000 }, ctx),
    ).toEqual(["too_much"]);
  });

  it("the payback each cycle is at most the whole amount", () => {
    expect(
      checkPrepayment({ name: "Gym", currency: "LKR", totalMinor: 500_000, paybackMinor: 500_001 }, ctx),
    ).toEqual(["payback"]);
  });

  it("one currency until item 15", () => {
    expect(
      checkPrepayment({ name: "Gym", currency: "USD", totalMinor: 500_000, paybackMinor: 500_000 }, ctx),
    ).toEqual(["currency"]);
  });
});

describe("paying it back (spec 5)", () => {
  it("60,000 at 5,000 a cycle is 12 cycles; a part left over is one more", () => {
    expect(paybackCycles(6_000_000, 500_000)).toBe(12);
    expect(paybackCycles(6_000_000, 700_000)).toBe(9);
  });

  it("each cycle pays back the usual amount, the last one only what is left", () => {
    expect(paybackDueMinor(gym)).toBe(500_000);
    expect(paybackDueMinor({ ...gym, paidBackMinor: 5_700_000 })).toBe(300_000);
    expect(paybackDueMinor({ ...gym, paidBackMinor: 6_000_000 })).toBe(0);
    // Paid back more than it cost: nothing more, never below zero.
    expect(paybackDueMinor({ ...gym, paidBackMinor: 6_100_000 })).toBe(0);
  });

  it("money already planned in the new cycle (carried from last cycle) counts as on its way", () => {
    expect(paybackDueMinor(gym, 500_000)).toBe(500_000);
    expect(paybackDueMinor({ ...gym, paidBackMinor: 5_000_000 }, 700_000)).toBe(300_000);
    expect(paybackDueMinor({ ...gym, paidBackMinor: 5_000_000 }, 1_000_000)).toBe(0);
  });

  it("a payback skipped (dropped or finished short) is planned in a later cycle: the total is always paid back", () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 1, max: 10_000_000 }),
        fc.integer({ min: 1, max: 10_000_000 }),
        fc.array(fc.integer({ min: 0, max: 100 }), { maxLength: 60 }),
        (total, per, paidShare) => {
          const p = { ...gym, totalMinor: total, paybackMinor: Math.min(per, total) };
          let paid = 0;
          // Each cycle pays some share (0–100 %) of what was planned.
          for (const share of paidShare)
            paid += Math.floor((paybackDueMinor({ ...p, paidBackMinor: paid }) * share) / 100);
          // Then every later cycle pays in full until it is done.
          for (let n = 0; n < paybackCycles(total, p.paybackMinor) + 1; n++) {
            paid += paybackDueMinor({ ...p, paidBackMinor: paid });
          }
          return paid === total;
        },
      ),
    );
  });

  it("progress on Savings: paid back, still to pay back, done", () => {
    expect(prepaymentProgress({ ...gym, paidBackMinor: 1_000_000 })).toEqual({
      paidBackMinor: 1_000_000,
      leftMinor: 5_000_000,
      cyclesLeft: 10,
      done: false,
    });
    expect(prepaymentProgress({ ...gym, paidBackMinor: 6_000_000 })).toEqual({
      paidBackMinor: 6_000_000,
      leftMinor: 0,
      cyclesLeft: 0,
      done: true,
    });
  });
});

describe("salary day fills the paybacks (spec 5, 6 step 4)", () => {
  it("one row per prepayment not yet paid back, due on the new cycle's first day, not Every cycle", () => {
    const done = { ...gym, id: "p2", name: "Insurance", paidBackMinor: 6_000_000 };
    const last = { ...gym, id: "p3", name: "Course", paidBackMinor: 5_800_000 };
    expect(paybackDrafts([gym, done, last], "2026-12-25")).toEqual([
      {
        prepaymentId: "p1",
        recurringId: null,
        carriedFromId: null,
        name: "Gym",
        kind: "savings_payback",
        plannedMinor: 500_000,
        dueOn: "2026-12-25",
        everyCycle: false,
      },
      {
        prepaymentId: "p3",
        recurringId: null,
        carriedFromId: null,
        name: "Course",
        kind: "savings_payback",
        plannedMinor: 200_000,
        dueOn: "2026-12-25",
        everyCycle: false,
      },
    ]);
  });

  it("what is already planned in the new cycle for it is left out", () => {
    expect(paybackDrafts([gym], "2026-12-25", { p1: 500_000 })[0]?.plannedMinor).toBe(500_000);
    expect(paybackDrafts([{ ...gym, paidBackMinor: 5_000_000 }], "2026-12-25", { p1: 600_000 })).toEqual([
      expect.objectContaining({ plannedMinor: 400_000 }),
    ]);
    expect(paybackDrafts([{ ...gym, paidBackMinor: 5_500_000 }], "2026-12-25", { p1: 500_000 })).toEqual([]);
  });
});

describe("free money and savings (spec 5)", () => {
  const base: CycleEntries = {
    spendingCurrency: "LKR",
    expectedSalaryOn: "2026-11-25",
    incomes: [{ kind: "opening", currency: "LKR", amountMinor: 10_000_000, toSavingsMinor: 0 }],
    spends: [],
    commitments: [],
  };

  it("the prepayment comes out of savings, not free money; the payback is set aside like a bill", () => {
    const payback = {
      dueOn: "2026-11-15",
      currency: "LKR",
      plannedMinor: 500_000,
      state: "open" as const,
      payments: [],
    };
    expect(freeMoney(base)).toBe(10_000_000);
    expect(freeMoney({ ...base, commitments: [payback] })).toBe(9_500_000);
    // Moved back to savings: free money stays the same, savings grow.
    const moved = { ...payback, payments: [{ amountMinor: 500_000, currency: "LKR", paidOn: "2026-11-15" }] };
    expect(freeMoney({ ...base, commitments: [moved] })).toBe(9_500_000);
    expect(
      savingsTotal(
        [
          { currency: "LKR", amountMinor: 8_000_000 },
          { currency: "LKR", amountMinor: -6_000_000 },
          { currency: "LKR", amountMinor: 500_000 },
        ],
        "LKR",
      ),
    ).toBe(2_500_000);
  });
});

describe("prepayment saving (spec 5)", () => {
  const base = { name: "Gym", currency: "LKR", totalMinor: 6_000_000, paybackMinor: 500_000 };

  it("normal monthly price and months are optional; when given, both are whole and above zero", () => {
    expect(checkPrepayment(base, ctx)).toEqual([]);
    expect(checkPrepayment({ ...base, normalMonthlyMinor: 600_000, months: 12 }, ctx)).toEqual([]);
    expect(checkPrepayment({ ...base, normalMonthlyMinor: 0, months: 12 }, ctx)).toEqual(["monthly"]);
    expect(checkPrepayment({ ...base, normalMonthlyMinor: 600_000, months: 0 }, ctx)).toEqual(["months"]);
    expect(checkPrepayment({ ...base, normalMonthlyMinor: 600_000, months: 1.5 }, ctx)).toEqual(["months"]);
    expect(checkPrepayment({ ...base, normalMonthlyMinor: 600_000, months: 601 }, ctx)).toEqual(["months"]);
    expect(checkPrepayment({ ...base, normalMonthlyMinor: 600_000 }, ctx)).toEqual(["months"]);
    // Months without a monthly price mean nothing.
    expect(checkPrepayment({ ...base, months: 12 }, ctx)).toEqual(["monthly"]);
  });

  it("a year of gym for 60,000, normally 6,000 a month: saved 12,000 vs paying monthly", () => {
    expect(prepaymentSavingMinor({ totalMinor: 6_000_000, normalMonthlyMinor: 600_000, months: 12 })).toBe(
      1_200_000,
    );
    // Paying up front cost more: below zero.
    expect(prepaymentSavingMinor({ totalMinor: 6_000_000, normalMonthlyMinor: 400_000, months: 12 })).toBe(
      -1_200_000,
    );
    expect(
      prepaymentSavingMinor({ totalMinor: 6_000_000, normalMonthlyMinor: null, months: null }),
    ).toBeNull();
  });
});
