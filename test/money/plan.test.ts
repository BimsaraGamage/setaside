import fc from "fast-check";
import { describe, expect, it } from "vitest";
import {
  addMonths,
  checkPlan,
  checkPlanExtra,
  freeMoney,
  type PlanEntry,
  planDrafts,
  planDueOn,
  planLastPaymentOn,
  planNextDueOn,
  planPaymentDueMinor,
  planProgress,
  planSavingMinor,
} from "../../src/money";

// Item 19 · Instalment plans. Each case names the rule it checks (spec 9).

/** A phone on 12 payments of 10,000 (price 108,000: 12,000 interest), first paid 5 Dec. */
const phone: PlanEntry = {
  id: "pl1",
  name: "Phone",
  currency: "LKR",
  priceMinor: 10_800_000,
  paymentCount: 12,
  paymentMinor: 1_000_000,
  firstPaymentOn: "2026-12-05",
  cardId: null,
  normalMonthlyMinor: null,
  paidOffOn: null,
  paidMinor: 0,
  extraMinor: 0,
  paymentsMade: 0,
};

const ctx = { spendingCurrency: "LKR", cycleStartedOn: "2026-11-25", cards: [] };
const input = {
  name: "Phone",
  currency: "LKR",
  priceMinor: 10_800_000,
  paymentCount: 12,
  paymentMinor: 1_000_000,
  firstPaymentOn: "2026-12-05",
};

describe("checking a new plan (spec 9)", () => {
  it("a phone on 12 payments of 10,000 is fine", () => {
    expect(checkPlan(input, ctx)).toEqual([]);
  });

  it("needs a name, a price, a number of payments and a payment above zero", () => {
    expect(checkPlan({ ...input, name: " ", priceMinor: 0, paymentCount: 0, paymentMinor: 0 }, ctx)).toEqual([
      "name",
      "price",
      "count",
      "payment",
    ]);
    expect(checkPlan({ ...input, paymentCount: 1.5 }, ctx)).toContain("count");
    expect(checkPlan({ ...input, paymentCount: 601 }, ctx)).toContain("count");
  });

  it("all payments together can't be less than the price (interest = all payments − price)", () => {
    expect(checkPlan({ ...input, paymentMinor: 899_999 }, ctx)).toEqual(["total"]);
    // No interest is fine: 0% instalments.
    expect(checkPlan({ ...input, paymentMinor: 900_000 }, ctx)).toEqual([]);
  });

  it("the first payment is on a real day, not before this cycle", () => {
    expect(checkPlan({ ...input, firstPaymentOn: "2026-11-24" }, ctx)).toEqual(["first_on"]);
    expect(checkPlan({ ...input, firstPaymentOn: "2026-02-30" }, ctx)).toEqual(["first_on"]);
    expect(checkPlan({ ...input, firstPaymentOn: "2026-11-25" }, ctx)).toEqual([]);
  });

  it("either of the user's currencies", () => {
    expect(checkPlan({ ...input, currency: "USD" }, ctx)).toEqual(["currency"]);
    expect(checkPlan({ ...input, currency: "USD" }, { ...ctx, salaryCurrency: "USD" })).toEqual([]);
  });

  it("the card it is on: one of the user's cards in use, in the plan's currency", () => {
    const cards = [
      { id: "visa", currency: "LKR", archived: false },
      { id: "amex", currency: "USD", archived: false },
      { id: "old", currency: "LKR", archived: true },
    ];
    const c = { ...ctx, salaryCurrency: "USD", cards };
    expect(checkPlan({ ...input, cardId: "visa" }, c)).toEqual([]);
    expect(checkPlan({ ...input, cardId: "amex" }, c)).toEqual(["card"]);
    expect(checkPlan({ ...input, cardId: "old" }, c)).toEqual(["card"]);
    expect(checkPlan({ ...input, cardId: "nope" }, c)).toEqual(["card"]);
  });

  it("the normal monthly price, when given, is above zero", () => {
    expect(checkPlan({ ...input, normalMonthlyMinor: 0 }, ctx)).toEqual(["monthly"]);
    expect(checkPlan({ ...input, normalMonthlyMinor: 1_000_000 }, ctx)).toEqual([]);
  });
});

describe("progress (spec 9)", () => {
  it("nothing paid yet: 0 of 12, all 120,000 still to pay, 12,000 interest in total", () => {
    expect(planProgress(phone)).toEqual({
      paidMinor: 0,
      stillToPayMinor: 12_000_000,
      paymentsMade: 0,
      paymentsLeft: 12,
      interestTotalMinor: 1_200_000,
      interestSoFarMinor: 0,
      done: false,
    });
  });

  it("3 paid: 3 of 12, 30,000 paid, interest so far is its share of what is paid", () => {
    const g = planProgress({ ...phone, paidMinor: 3_000_000, paymentsMade: 3 });
    expect(g.paymentsMade).toBe(3);
    expect(g.paymentsLeft).toBe(9);
    expect(g.stillToPayMinor).toBe(9_000_000);
    expect(g.interestSoFarMinor).toBe(300_000);
  });

  it("a part payment leaves a payment left until the rest is paid", () => {
    const g = planProgress({ ...phone, paidMinor: 2_500_000, paymentsMade: 2 });
    expect(g.paymentsLeft).toBe(10);
    expect(g.stillToPayMinor).toBe(9_500_000);
  });

  it("Pay extra: the payments left drop, the payment stays the same", () => {
    const g = planProgress({ ...phone, paidMinor: 3_000_000, paymentsMade: 3, extraMinor: 2_500_000 });
    expect(g.stillToPayMinor).toBe(6_500_000);
    expect(g.paymentsLeft).toBe(7);
    // Interest is still all payments − price.
    expect(g.interestTotalMinor).toBe(1_200_000);
  });

  it("paid off: nothing left, interest = what was paid − price (less when the bank took off some)", () => {
    const g = planProgress({
      ...phone,
      paidMinor: 3_000_000,
      paymentsMade: 3,
      extraMinor: 8_400_000,
      paidOffOn: "2027-03-01",
    });
    expect(g).toMatchObject({ stillToPayMinor: 0, paymentsLeft: 0, done: true });
    expect(g.interestTotalMinor).toBe(600_000);
    expect(g.interestSoFarMinor).toBe(600_000);
  });

  it("all payments made: done", () => {
    expect(planProgress({ ...phone, paidMinor: 12_000_000, paymentsMade: 12 }).done).toBe(true);
  });
});

describe("each cycle's payment (spec 9)", () => {
  it("the usual payment, the last one only what is left", () => {
    expect(planPaymentDueMinor(phone)).toBe(1_000_000);
    expect(planPaymentDueMinor({ ...phone, paidMinor: 11_000_000, extraMinor: 500_000 })).toBe(500_000);
  });

  it("less what the cycle already has for it (carried from last cycle)", () => {
    expect(planPaymentDueMinor({ ...phone, paidMinor: 11_000_000 }, 1_000_000)).toBe(0);
  });

  it("nothing once paid off", () => {
    expect(planPaymentDueMinor({ ...phone, paidOffOn: "2027-01-01" })).toBe(0);
  });

  it("due on the first payment's day of the month, never before the first payment", () => {
    expect(planDueOn(phone, "2026-11-25")).toBe("2026-12-05");
    expect(planDueOn(phone, "2026-12-25")).toBe("2027-01-05");
    expect(planDueOn({ ...phone, firstPaymentOn: "2027-02-05" }, "2026-12-25")).toBe("2027-02-05");
    // The 31st falls on a short month's last day.
    expect(planDueOn({ ...phone, firstPaymentOn: "2026-12-31" }, "2027-02-01")).toBe("2027-02-28");
  });

  it("salary day fills one row per plan with money left and a payment due by the expected salary day", () => {
    const later = { ...phone, id: "pl2", name: "Sofa", firstPaymentOn: "2027-03-10" };
    const done = { ...phone, id: "pl3", name: "Old", paidOffOn: "2026-12-01" };
    expect(planDrafts([phone, later, done], "2026-11-25", "2026-12-25")).toEqual([
      {
        planId: "pl1",
        recurringId: null,
        carriedFromId: null,
        name: "Phone",
        kind: "plan_payment",
        currency: "LKR",
        plannedMinor: 1_000_000,
        dueOn: "2026-12-05",
        everyCycle: false,
      },
    ]);
  });

  it("a late payment carried in is paid as well as this cycle's, never past what is left", () => {
    expect(planDrafts([phone], "2026-11-25", "2026-12-25", { pl1: 1_000_000 })).toHaveLength(1);
    const last = { ...phone, paidMinor: 11_000_000, paymentsMade: 11 };
    expect(planDrafts([last], "2026-11-25", "2026-12-25", { pl1: 1_000_000 })).toEqual([]);
  });

  it("whatever is skipped, the plan is always paid in full in the end", () => {
    fc.assert(
      fc.property(fc.array(fc.boolean(), { minLength: 1, maxLength: 40 }), (skips) => {
        let p = { ...phone, paymentCount: 5, priceMinor: 4_000_000 };
        for (const skip of skips) {
          const due = planPaymentDueMinor(p);
          if (!skip) p = { ...p, paidMinor: p.paidMinor + due };
        }
        // Then pay every cycle until nothing is due.
        for (let i = 0; i < 100 && planPaymentDueMinor(p) > 0; i++) {
          p = { ...p, paidMinor: p.paidMinor + planPaymentDueMinor(p) };
        }
        expect(p.paidMinor).toBe(5_000_000);
      }),
    );
  });
});

describe("dates (spec 9)", () => {
  it("months later keep the day of the month, a short month's last day for the 31st", () => {
    expect(addMonths("2026-12-05", 1, 5)).toBe("2027-01-05");
    expect(addMonths("2026-12-31", 2, 31)).toBe("2027-02-28");
    expect(addMonths("2027-02-28", 1, 31)).toBe("2027-03-31");
    expect(addMonths("2026-12-05", 0, 5)).toBe("2026-12-05");
  });

  it("next payment: this cycle's open one, or the next cycle's", () => {
    const cycle = { startedOn: "2026-11-25", expectedSalaryOn: "2026-12-25" };
    expect(planNextDueOn(phone, cycle, "2026-12-05")).toBe("2026-12-05");
    expect(planNextDueOn(phone, cycle, null)).toBe("2027-01-05");
    expect(planNextDueOn({ ...phone, firstPaymentOn: "2027-03-10" }, cycle, null)).toBe("2027-03-10");
  });

  it("last payment date: the next payment plus one month for each payment after it", () => {
    expect(planLastPaymentOn(phone, "2026-12-05")).toBe("2027-11-05");
    expect(planLastPaymentOn({ ...phone, paidMinor: 3_000_000, paymentsMade: 3 }, "2027-03-05")).toBe(
      "2027-11-05",
    );
    expect(planLastPaymentOn({ ...phone, paidOffOn: "2027-01-01" }, "2027-02-05")).toBeNull();
  });
});

describe("prepayment saving (spec 9)", () => {
  it("normal monthly price × payments − all payments, after interest", () => {
    expect(planSavingMinor({ ...phone, normalMonthlyMinor: 1_100_000 })).toBe(1_200_000);
    expect(planSavingMinor({ ...phone, normalMonthlyMinor: 900_000 })).toBe(-1_200_000);
    expect(planSavingMinor(phone)).toBeNull();
  });

  it("paid off early with money taken off: the saving grows", () => {
    expect(
      planSavingMinor({
        ...phone,
        normalMonthlyMinor: 1_100_000,
        paidMinor: 3_000_000,
        extraMinor: 8_400_000,
        paidOffOn: "2027-03-01",
      }),
    ).toBe(1_800_000);
  });
});

describe("Pay extra and Pay it all off (spec 9)", () => {
  const g = planProgress({ ...phone, paidMinor: 3_000_000, paymentsMade: 3 });
  const extraCtx = { stillToPayMinor: g.stillToPayMinor, setAsideMinor: 1_000_000, savingsMinor: 5_000_000 };

  it("pay extra: above zero, at most what is left past this cycle's payment", () => {
    expect(checkPlanExtra({ amountMinor: 8_000_000, from: "free", paysOff: false }, extraCtx)).toEqual([]);
    expect(checkPlanExtra({ amountMinor: 8_000_001, from: "free", paysOff: false }, extraCtx)).toEqual([
      "too_much",
    ]);
    expect(checkPlanExtra({ amountMinor: 0, from: "free", paysOff: false }, extraCtx)).toEqual(["amount"]);
  });

  it("from savings: never more than is saved in that currency", () => {
    expect(checkPlanExtra({ amountMinor: 5_000_001, from: "savings", paysOff: true }, extraCtx)).toEqual([
      "savings",
    ]);
  });

  it("pay it all off: any amount above zero (the bank may take some off)", () => {
    expect(checkPlanExtra({ amountMinor: 8_400_000, from: "free", paysOff: true }, extraCtx)).toEqual([]);
  });

  it("from free money it comes out of free money at once; from savings it does not", () => {
    const base = {
      spendingCurrency: "LKR",
      incomes: [{ kind: "salary" as const, currency: "LKR", amountMinor: 10_000_000, toSavingsMinor: 0 }],
    };
    expect(
      freeMoney({ ...base, planExtras: [{ currency: "LKR", amountMinor: 2_000_000 }] }, "2026-11-25"),
    ).toBe(8_000_000);
    expect(freeMoney(base)).toBe(10_000_000);
  });
});
