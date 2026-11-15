import fc from "fast-check";
import { describe, expect, it } from "vitest";
import {
  addDays,
  type CommitmentEntry,
  type CycleEntries,
  checkPayment,
  freeMoney,
  nextUp,
  type PaymentEntry,
  paidMinor,
  setAsideMinor,
  stillToPayMinor,
  todayView,
} from "../../src/money";

// Item 6 · Pay a commitment. Each case names the rule it checks (spec 16).

const SALARY = "2026-11-30";

const pay = (amountMinor: number, paidOn = "2026-11-14"): PaymentEntry => ({
  amountMinor,
  currency: "LKR",
  paidOn,
});

const bill = (
  name: string,
  plannedMinor: number,
  payments: PaymentEntry[] = [],
  state: CommitmentEntry["state"] = "open",
  dueOn = "2026-11-20",
): CommitmentEntry & { name: string } => ({ name, dueOn, currency: "LKR", plannedMinor, state, payments });

/** Rs 90,000 held, salary expected 30 Nov: on 12 Nov that is 18 days of Rs 5,000. */
function cycle(commitments: CommitmentEntry[], held = 9_000_000): CycleEntries {
  return {
    spendingCurrency: "LKR",
    expectedSalaryOn: SALARY,
    incomes: [{ kind: "opening", currency: "LKR", amountMinor: held, toSavingsMinor: 0 }],
    spends: [],
    commitments,
  };
}

describe("paying a commitment (spec 3)", () => {
  it("paid as planned and finished: free money is the same as when it was set aside", () => {
    const open = cycle([bill("Rent", 3_600_000)]);
    const paid = cycle([bill("Rent", 3_600_000, [pay(3_600_000)], "finished")]);
    expect(freeMoney(paid)).toBe(freeMoney(open));
    expect(freeMoney(paid)).toBe(5_400_000);
  });

  it("paid more than planned lowers free money by the gap", () => {
    const e = cycle([bill("Electricity", 450_000, [pay(520_000)], "finished")]);
    expect(freeMoney(e)).toBe(9_000_000 - 520_000);
  });

  it("paid less than planned and finished raises free money by the gap", () => {
    const e = cycle([bill("Water", 200_000, [pay(150_000)], "finished")]);
    expect(freeMoney(e)).toBe(9_000_000 - 150_000);
  });

  it("paid more and still open: the gap is out at once, nothing left set aside", () => {
    const c = bill("Electricity", 450_000, [pay(520_000)]);
    expect(stillToPayMinor(c)).toBe(0);
    expect(freeMoney(cycle([c]))).toBe(9_000_000 - 520_000);
  });

  it("finished with nothing paid gives all its money back", () => {
    expect(freeMoney(cycle([bill("Gym", 500_000, [], "finished")]))).toBe(9_000_000);
  });

  it("changes today's allowance at once (spec 7: not a spend)", () => {
    // Paid Rs 9,000 more on a Rs 36,000 rent: Rs 45,000 over 18 days = Rs 2,500.
    const view = todayView(
      cycle([bill("Rent", 3_600_000, [pay(4_500_000, "2026-11-12")], "finished")]),
      "2026-11-12",
    );
    expect(view.allowanceMinor).toBe(250_000);
  });
});

describe("part payments and still to pay (spec 3)", () => {
  const rent = bill("Rent", 3_600_000, [pay(1_000_000, "2026-11-13"), pay(500_000, "2026-11-14")]);

  it("each payment is kept; the rest shows as still to pay", () => {
    expect(paidMinor(rent, "LKR")).toBe(1_500_000);
    expect(stillToPayMinor(rent)).toBe(2_100_000);
  });

  it("an open part-paid one keeps its whole planned amount out of free money", () => {
    expect(freeMoney(cycle([rent]))).toBe(5_400_000);
    expect(setAsideMinor([rent], SALARY, "LKR")).toBe(2_100_000);
  });

  it("Next up shows only what is still to pay in its total", () => {
    const up = nextUp([rent], "2026-11-14", SALARY, "LKR");
    expect(up.items).toHaveLength(1);
    expect(up.totalMinor).toBe(2_100_000);
  });

  it("marked finished after parts: the rest goes back to free money", () => {
    expect(freeMoney(cycle([{ ...rent, state: "finished" }]))).toBe(9_000_000 - 1_500_000);
  });

  it("a payment on one due after salary day (coming up only) is out of free money now", () => {
    const c = bill("Insurance", 1_000_000, [pay(400_000)], "open", "2026-12-05");
    expect(freeMoney(cycle([c]))).toBe(9_000_000 - 400_000);
    expect(nextUp([c], "2026-11-14", SALARY, "LKR").totalMinor).toBe(0);
  });

  it("payments in another currency are left out (paid in the other currency is item 17)", () => {
    const c = bill("Rent", 3_600_000, [{ ...pay(1_000), currency: "USD" }]);
    expect(paidMinor(c, "LKR")).toBe(0);
    expect(stillToPayMinor(c)).toBe(3_600_000);
  });
});

describe("a payment is checked before it is saved (spec 3)", () => {
  const ctx = { today: "2026-11-14", cycleStartedOn: "2026-11-12", spendingCurrency: "LKR" };
  const ok = { amountMinor: 3_600_000, paidOn: "2026-11-14", currency: "LKR" };

  it("accepts a whole positive amount, dated in this cycle up to today", () => {
    expect(checkPayment(ok, ctx)).toEqual([]);
    expect(checkPayment({ ...ok, paidOn: "2026-11-12" }, ctx)).toEqual([]);
  });

  it("needs a whole amount above zero in the spending currency", () => {
    expect(checkPayment({ ...ok, amountMinor: 0 }, ctx)).toEqual(["amount"]);
    expect(checkPayment({ ...ok, amountMinor: -5 }, ctx)).toEqual(["amount"]);
    expect(checkPayment({ ...ok, amountMinor: 1.5 }, ctx)).toEqual(["amount"]);
    expect(checkPayment({ ...ok, currency: "USD" }, ctx)).toEqual(["currency"]);
  });

  it("can't be dated before the cycle started, after today, or on no real day", () => {
    expect(checkPayment({ ...ok, paidOn: "2026-11-11" }, ctx)).toEqual(["paid_on"]);
    expect(checkPayment({ ...ok, paidOn: "2026-11-15" }, ctx)).toEqual(["paid_on"]);
    expect(checkPayment({ ...ok, paidOn: "2026-02-30" }, ctx)).toEqual(["paid_on"]);
  });
});

describe("random payments: totals always add up (spec 16)", () => {
  const start = "2026-11-12";
  const arb = fc.record({
    held: fc.integer({ min: 0, max: 50_000_000 }),
    commitments: fc.array(
      fc.record({
        day: fc.integer({ min: 0, max: 40 }),
        planned: fc.integer({ min: 1, max: 5_000_000 }),
        payments: fc.array(fc.integer({ min: 1, max: 3_000_000 }), { maxLength: 4 }),
        finished: fc.boolean(),
      }),
      { maxLength: 20 },
    ),
  });

  it("free money + still set aside + paid = income, and finishing never lowers free money", () => {
    fc.assert(
      fc.property(arb, ({ held, commitments }) => {
        const cs = commitments.map((c, n) =>
          bill(
            `c${n}`,
            c.planned,
            c.payments.map((a) => pay(a)),
            c.finished ? "finished" : "open",
            addDays(start, c.day),
          ),
        );
        const paid = cs.reduce((n, c) => n + paidMinor(c, "LKR"), 0);
        const e = cycle(cs, held);
        expect(freeMoney(e) + setAsideMinor(cs, SALARY, "LKR") + paid).toBe(held);
        expect(nextUp(cs, "2026-11-14", SALARY, "LKR").totalMinor).toBe(setAsideMinor(cs, SALARY, "LKR"));
        for (const c of cs) expect(stillToPayMinor(c)).toBeGreaterThanOrEqual(0);
        const allFinished = cycle(
          cs.map((c) => ({ ...c, state: "finished" as const })),
          held,
        );
        expect(freeMoney(allFinished)).toBeGreaterThanOrEqual(freeMoney(e));
      }),
      { numRuns: 2000, seed: 20261114 },
    );
  });
});
