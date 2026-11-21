import { describe, expect, it } from "vitest";
import {
  nextCyclePreview,
  type PlanEntry,
  type PrepaymentEntry,
  type PreviewCommitment,
  type RecurringEntry,
  type SavingsGoalEntry,
} from "../../src/money";

// Next cycle preview (spec 6): what salary day would set aside, against this cycle's salary.

const rent: RecurringEntry = {
  id: "r-rent",
  name: "Rent",
  kind: "bill",
  currency: "LKR",
  usualAmountMinor: 3_600_000,
  usualDay: 1,
  active: true,
};
const saving: RecurringEntry = {
  ...rent,
  id: "r-save",
  name: "Emergency",
  kind: "savings",
  usualAmountMinor: 1_000_000,
};

const base = {
  spendingCurrency: "LKR",
  expectedSalaryOn: "2026-11-25",
  usualPayDay: 25,
  salaryMinor: 15_000_000,
  commitments: [] as PreviewCommitment[],
  recurring: [rent, saving],
  pots: [
    { name: "Food", currency: "LKR", usualAmountMinor: 4_000_000, archived: false },
    { name: "Old", currency: "LKR", usualAmountMinor: 500_000, archived: true },
  ],
  prepayments: [] as PrepaymentEntry[],
  plans: [] as PlanEntry[],
};

const open = (c: Partial<PreviewCommitment>): PreviewCommitment => ({
  id: "c1",
  recurringId: null,
  name: "Thing",
  kind: "bill",
  currency: "LKR",
  plannedMinor: 100_000,
  dueOn: "2026-11-20",
  state: "open",
  payments: [],
  ...c,
});

describe("next cycle preview (spec 6)", () => {
  it("Every cycle bills and savings plus pots in use at their usual amounts, against the salary", () => {
    const p = nextCyclePreview(base);
    expect(p.startsOn).toBe("2026-11-25");
    expect(p.groups).toEqual({ bills: 3_600_000, pots: 4_000_000, savings: 1_000_000, people: 0, plans: 0 });
    expect(p.totalMinor).toBe(8_600_000);
    expect(p.salaryMinor).toBe(15_000_000);
    expect(p.freeMinor).toBe(6_400_000);
    expect(p.items.map((i) => i.name)).toEqual(["Emergency", "Rent", "Food"]);
  });

  it("over budget: free money below zero", () => {
    const p = nextCyclePreview({ ...base, salaryMinor: 8_000_000 });
    expect(p.freeMinor).toBe(-600_000);
  });

  it("paused Every cycle ones are left out", () => {
    const p = nextCyclePreview({ ...base, recurring: [rent, { ...saving, active: false }] });
    expect(p.groups.savings).toBe(0);
  });

  it("a coming-up commitment counts with what is still to pay and stands in for its template", () => {
    const p = nextCyclePreview({
      ...base,
      commitments: [
        open({
          id: "c-rent",
          recurringId: "r-rent",
          name: "Rent",
          dueOn: "2026-12-01",
          plannedMinor: 3_600_000,
          payments: [{ amountMinor: 600_000, currency: "LKR", paidOn: "2026-11-10" }],
        }),
        open({ id: "c-now", name: "Due this cycle", dueOn: "2026-11-20" }),
      ],
    });
    expect(p.groups.bills).toBe(3_000_000);
    expect(p.items.filter((i) => i.name === "Rent")).toHaveLength(1);
  });

  it("a person payback coming up counts under People; card bills are left out", () => {
    const p = nextCyclePreview({
      ...base,
      recurring: [],
      pots: [],
      commitments: [
        open({
          id: "pp",
          kind: "person_payback",
          name: "Pay back Amal",
          dueOn: "2026-12-05",
          personDebtId: "d1",
        }),
        open({ id: "cb", kind: "card_bill", name: "Card", dueOn: "2026-12-05", cardId: "k1" }),
      ],
    });
    expect(p.groups.people).toBe(100_000);
    expect(p.totalMinor).toBe(100_000);
  });

  it("a prepayment payback: this cycle's open one counts as paid, the next one is set aside", () => {
    const prepayment: PrepaymentEntry = {
      id: "pre",
      name: "Insurance",
      currency: "LKR",
      totalMinor: 300_000,
      paybackMinor: 100_000,
      paidBackMinor: 100_000,
    };
    const p = nextCyclePreview({
      ...base,
      recurring: [],
      pots: [],
      prepayments: [prepayment],
      commitments: [open({ kind: "savings_payback", prepaymentId: "pre", dueOn: "2026-11-01" })],
    });
    // 100k back, 100k this cycle, so the last 100k next cycle.
    expect(p.groups.savings).toBe(100_000);
    const done = nextCyclePreview({
      ...base,
      recurring: [],
      pots: [],
      prepayments: [{ ...prepayment, paidBackMinor: 200_000 }],
      commitments: [open({ kind: "savings_payback", prepaymentId: "pre", dueOn: "2026-11-01" })],
    });
    expect(done.groups.savings).toBe(0);
  });

  it("before the first salary only the total shows", () => {
    const p = nextCyclePreview({ ...base, salaryMinor: null });
    expect(p.salaryMinor).toBeNull();
    expect(p.freeMinor).toBeNull();
    expect(p.totalMinor).toBe(8_600_000);
  });

  it("two currencies: the salary and dollar set-asides count at the counting rate", () => {
    const p = nextCyclePreview({
      ...base,
      salaryCurrency: "USD",
      countingRate: "300",
      salaryMinor: 100_000, // $1,000
      recurring: [rent, { ...saving, currency: "USD", usualAmountMinor: 10_000 }], // $100
    });
    expect(p.salaryMinor).toBe(30_000_000);
    expect(p.groups.savings).toBe(3_000_000);
    expect(p.freeMinor).toBe(30_000_000 - 3_600_000 - 3_000_000 - 4_000_000);
  });
});

describe("next cycle preview with savings goals (SAB-68)", () => {
  const japan: SavingsGoalEntry = {
    id: "g1",
    name: "Trip to Japan",
    currency: "LKR",
    targetMinor: 60_000_000,
    byOn: "2027-06-01",
    startMinor: 0,
    stopped: false,
    movedMinor: 0,
    shareCount: 1,
  };

  it("counts each live goal's fair share under Savings, this cycle's share as if moved", () => {
    const share = open({
      id: "s1",
      name: "Trip to Japan",
      kind: "savings",
      goalId: "g1",
      plannedMinor: 10_000_000,
    });
    const p = nextCyclePreview({ ...base, recurring: [], commitments: [share], goals: [japan] });
    // From 25 Nov: shares left 1 + Dec … May = 7; 600,000 − 100,000 moved = 500,000 / 7 → 71,429.
    expect(p.items).toContainEqual({
      group: "savings",
      name: "Trip to Japan",
      currency: "LKR",
      minor: 7_142_900,
    });
    expect(p.groups.savings).toBe(7_142_900);
  });

  it("leaves out stopped goals", () => {
    const p = nextCyclePreview({ ...base, recurring: [], goals: [{ ...japan, stopped: true }] });
    expect(p.groups.savings).toBe(0);
  });
});
