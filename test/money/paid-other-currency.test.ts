import fc from "fast-check";
import { describe, expect, it } from "vitest";
import {
  type CommitmentEntry,
  type CycleEntries,
  checkPayment,
  coveredMinor,
  freeIn,
  freeMoney,
  type PaymentEntry,
  paidMinor,
  paymentCovers,
  setAsideMinor,
  stillToPayMinor,
} from "../../src/money";

// Item 17 · Paid in the other currency (spec 8, 3). Each case names the rule it checks (spec 16).
// Salary in USD, spending in LKR, counting and reserve rate Rs 300 a dollar.

const SALARY = "2026-11-30";
const RATE = "300";
const AT = (countingRate: string | null) => ({ spendingCurrency: "LKR", countingRate });

const usdBill = (
  payments: PaymentEntry[] = [],
  state: CommitmentEntry["state"] = "open",
): CommitmentEntry => ({
  dueOn: "2026-11-20",
  currency: "USD",
  plannedMinor: 2_000, // $20
  state,
  payments,
});

const lkrBill = (
  payments: PaymentEntry[] = [],
  state: CommitmentEntry["state"] = "open",
): CommitmentEntry => ({
  dueOn: "2026-11-20",
  currency: "LKR",
  plannedMinor: 3_000_000, // Rs 30,000
  state,
  payments,
});

const paid = (currency: string, amountMinor: number, coversMinor?: number): PaymentEntry => ({
  currency,
  amountMinor,
  paidOn: "2026-11-14",
  ...(coversMinor === undefined ? {} : { coversMinor }),
});

/** Rs 90,000 and $1,000 held. */
function cycle(commitments: CommitmentEntry[]): CycleEntries {
  return {
    spendingCurrency: "LKR",
    salaryCurrency: "USD",
    countingRate: RATE,
    reserveRate: RATE,
    expectedSalaryOn: SALARY,
    incomes: [
      { kind: "opening", currency: "LKR", amountMinor: 9_000_000, toSavingsMinor: 0 },
      { kind: "salary", currency: "USD", amountMinor: 100_000, toSavingsMinor: 0 },
    ],
    spends: [],
    commitments,
  };
}

describe("what a payment in the other currency covers (spec 8)", () => {
  it("rupees paid on a dollar bill cover dollars at the counting rate, rounded down", () => {
    expect(paymentCovers(610_000, "LKR", "USD", AT(RATE))).toBe(2_033); // Rs 6,100 → $20.33
    expect(paymentCovers(10_000, "LKR", "USD", AT(RATE))).toBe(33); // Rs 100 → $0.33
  });

  it("dollars paid on a rupee bill cover rupees at the counting rate, rounded down", () => {
    expect(paymentCovers(10_000, "USD", "LKR", AT(RATE))).toBe(3_000_000); // $100 → Rs 30,000
    expect(paymentCovers(1, "USD", "LKR", AT("302.555"))).toBe(302); // 1 cent → Rs 3.02
  });

  it("in the commitment's own currency a payment covers its amount", () => {
    expect(paymentCovers(1_234, "USD", "USD", AT(RATE))).toBe(1_234);
  });

  it("without a counting rate, the other currency covers nothing", () => {
    expect(paymentCovers(610_000, "LKR", "USD", AT(null))).toBe(0);
  });

  it("never covers more than the payment is worth at the rate (property)", () => {
    fc.assert(
      fc.property(fc.integer({ min: 1, max: 1e9 }), (rupees) => {
        const dollars = paymentCovers(rupees, "LKR", "USD", AT(RATE));
        return dollars * 300 <= rupees && (dollars + 1) * 300 > rupees;
      }),
    );
  });
});

describe("paying a dollar bill in rupees (spec 8)", () => {
  it("finished: the reserved dollars go back and the rupees come out of rupee free money", () => {
    const before = cycle([usdBill()]);
    const after = cycle([usdBill([paid("LKR", 610_000, 2_033)], "finished")]);
    expect(freeIn(before, "USD")).toBe(98_000);
    expect(freeIn(after, "USD")).toBe(100_000);
    expect(freeIn(after, "LKR")).toBe(9_000_000 - 610_000);
    // $20 back at Rs 300 = Rs 6,000; Rs 6,100 paid: Rs 100 less free money.
    expect(freeMoney(after)).toBe(freeMoney(before) - 10_000);
  });

  it("a part payment covers its share; the rest stays set aside from the dollars", () => {
    const e = cycle([usdBill([paid("LKR", 300_000, 1_000)])]);
    expect(coveredMinor(e.commitments![0]!)).toBe(1_000);
    expect(stillToPayMinor(e.commitments![0]!)).toBe(1_000);
    expect(setAsideMinor(e.commitments!, SALARY, "USD")).toBe(1_000);
    expect(freeIn(e, "USD")).toBe(99_000);
    expect(freeIn(e, "LKR")).toBe(8_700_000);
    // At the counting rate, paying part in rupees changes nothing.
    expect(freeMoney(e)).toBe(freeMoney(cycle([usdBill()])));
  });

  it("covering it all with rupees, still open: nothing stays set aside", () => {
    const e = cycle([usdBill([paid("LKR", 610_000, 2_033)])]);
    expect(stillToPayMinor(e.commitments![0]!)).toBe(0);
    expect(freeIn(e, "USD")).toBe(100_000);
  });

  it("a payment in each currency adds up", () => {
    const c = usdBill([paid("USD", 500), paid("LKR", 300_000, 1_000)]);
    expect(coveredMinor(c)).toBe(1_500);
    expect(stillToPayMinor(c)).toBe(500);
    expect(paidMinor(c, "USD")).toBe(500);
    expect(paidMinor(c, "LKR")).toBe(300_000);
  });
});

describe("paying a rupee bill in dollars (spec 8)", () => {
  it("finished: the reserved rupees go back to rupee free money; the dollars come out of the dollars", () => {
    const before = cycle([lkrBill()]);
    const after = cycle([lkrBill([paid("USD", 10_000, 3_000_000)], "finished")]);
    expect(freeIn(before, "LKR")).toBe(6_000_000);
    expect(freeIn(after, "LKR")).toBe(9_000_000);
    expect(freeIn(after, "USD")).toBe(90_000);
    expect(freeMoney(after)).toBe(freeMoney(before));
  });

  it("a rupee bill past the rupees, paid in dollars: nothing is reserved from the dollars any more", () => {
    const big = { ...lkrBill(), plannedMinor: 12_000_000 }; // Rs 120,000 > Rs 90,000 held
    const reserved = cycle([big]);
    const paidIt = cycle([{ ...big, state: "finished", payments: [paid("USD", 40_000, 12_000_000)] }]);
    expect(freeIn(reserved, "LKR")).toBe(-3_000_000);
    expect(freeIn(paidIt, "LKR")).toBe(9_000_000);
    expect(freeIn(paidIt, "USD")).toBe(60_000);
    expect(freeMoney(paidIt)).toBe(freeMoney(reserved));
  });
});

describe("checking a payment's currency (spec 8)", () => {
  const ok = { amountMinor: 610_000, paidOn: "2026-11-14", currency: "LKR" };
  const ctx = { today: "2026-11-14", cycleStartedOn: "2026-11-01", currency: "USD" };

  it("the other currency is allowed when given", () => {
    expect(checkPayment(ok, { ...ctx, otherCurrency: "LKR" })).toEqual([]);
  });

  it("refused when there is no other currency (one currency, or a savings set-aside)", () => {
    expect(checkPayment(ok, ctx)).toEqual(["currency"]);
    expect(checkPayment(ok, { ...ctx, otherCurrency: null })).toEqual(["currency"]);
  });

  it("a third currency is refused", () => {
    expect(checkPayment({ ...ok, currency: "EUR" }, { ...ctx, otherCurrency: "LKR" })).toEqual(["currency"]);
  });
});
