import { describe, expect, it } from "vitest";
import {
  checkGotBack,
  checkPayback,
  checkPersonDebt,
  debtProgress,
  freeMoney,
  PERSON_NAME_MAX,
  paybackFillMinor,
  paybackName,
  todayView,
} from "../../src/money";

// Item 20 · People. Each case names the rule it checks (spec 9).

const ctx = { spendingCurrency: "LKR", cycleStartedOn: "2026-11-25" };
const two = { ...ctx, salaryCurrency: "USD" };

const lent = { direction: "lent" as const, amountMinor: 1_000_000, backMinor: 0, settledOn: null };
const borrowed = { ...lent, direction: "borrowed" as const };

describe("who owes what (spec 9)", () => {
  it("still owed = the amount less what is back", () => {
    expect(debtProgress({ ...lent, backMinor: 400_000 })).toEqual({ owedMinor: 600_000, closed: false });
  });

  it("an entry with nothing owed closes by itself", () => {
    expect(debtProgress({ ...lent, backMinor: 1_000_000 })).toEqual({ owedMinor: 0, closed: true });
  });

  it("Settled closes an entry whatever is still owed", () => {
    expect(debtProgress({ ...lent, settledOn: "2026-11-30" })).toEqual({
      owedMinor: 1_000_000,
      closed: true,
    });
  });

  it("more back than the amount owes nothing (a payback paid over)", () => {
    expect(debtProgress({ ...borrowed, backMinor: 1_200_000 }).owedMinor).toBe(0);
  });
});

describe("Lend: lowers free money now (spec 9)", () => {
  const base = {
    spendingCurrency: "LKR",
    expectedSalaryOn: "2026-12-25",
    startedOn: "2026-11-25",
    incomes: [{ kind: "salary" as const, currency: "LKR", amountMinor: 30_000_000, toSavingsMinor: 0 }],
    spends: [],
  };

  it("comes out of free money in its currency at once", () => {
    expect(freeMoney({ ...base, lent: [{ currency: "LKR", amountMinor: 1_000_000 }] })).toBe(29_000_000);
  });

  it("counts at once, also at the start of today (not a spend)", () => {
    const e = { ...base, lent: [{ currency: "LKR", amountMinor: 3_000_000 }] };
    // 270,000 over 30 days: 9,000 a day.
    expect(todayView(e, "2026-11-25").allowanceMinor).toBe(900_000);
  });

  it("money lent in the other currency comes out of that currency's money (spec 8)", () => {
    const e = {
      ...base,
      salaryCurrency: "USD",
      countingRate: "300",
      incomes: [
        ...base.incomes,
        { kind: "opening" as const, currency: "USD", amountMinor: 50_000, toSavingsMinor: 0 },
      ],
      lent: [{ currency: "USD", amountMinor: 10_000 }],
    };
    // Rs 300,000 + $400 at 300.
    expect(freeMoney(e)).toBe(30_000_000 + 12_000_000);
  });
});

describe("Got it back and Borrow are split like extra income (spec 9)", () => {
  const base = {
    spendingCurrency: "LKR",
    expectedSalaryOn: "2026-12-25",
    incomes: [
      { kind: "salary" as const, currency: "LKR", amountMinor: 30_000_000, toSavingsMinor: 0 },
      { kind: "paid_back" as const, currency: "LKR", amountMinor: 500_000, toSavingsMinor: 200_000 },
      { kind: "borrowed" as const, currency: "LKR", amountMinor: 1_000_000, toSavingsMinor: 0 },
    ],
  };

  it("only the part not sent to savings is free money", () => {
    expect(freeMoney(base)).toBe(30_000_000 + 300_000 + 1_000_000);
  });
});

describe("checkPersonDebt (spec 9)", () => {
  const ok = { personName: "Nimal", direction: "lent", currency: "LKR", amountMinor: 500_000 };

  it("a name, a direction, one of the user's currencies and an amount", () => {
    expect(checkPersonDebt(ok, ctx)).toEqual([]);
    expect(checkPersonDebt({ ...ok, personName: "  " }, ctx)).toEqual(["name"]);
    expect(checkPersonDebt({ ...ok, personName: "x".repeat(PERSON_NAME_MAX + 1) }, ctx)).toEqual(["name"]);
    expect(checkPersonDebt({ ...ok, direction: "gift" }, ctx)).toEqual(["direction"]);
    expect(checkPersonDebt({ ...ok, currency: "EUR" }, ctx)).toEqual(["currency"]);
    expect(checkPersonDebt({ ...ok, amountMinor: 0 }, ctx)).toEqual(["amount"]);
    expect(checkPersonDebt({ ...ok, amountMinor: 1.5 }, ctx)).toEqual(["amount"]);
  });

  it("either of a two-currency user's currencies (spec 8)", () => {
    expect(checkPersonDebt({ ...ok, currency: "USD" }, two)).toEqual([]);
    expect(checkPersonDebt({ ...ok, currency: "USD" }, ctx)).toEqual(["currency"]);
  });

  it("lent money has no split and no payback: it comes out of free money", () => {
    expect(checkPersonDebt({ ...ok, toSavingsMinor: 1 }, ctx)).toEqual(["to_savings"]);
    expect(checkPersonDebt({ ...ok, payback: { plannedMinor: 500_000, dueOn: "2026-12-01" } }, ctx)).toEqual([
      "payback_amount",
      "payback_on",
    ]);
  });

  it("borrowed money is split like extra income, savings at most the amount", () => {
    const b = { ...ok, direction: "borrowed" };
    expect(checkPersonDebt({ ...b, toSavingsMinor: 500_000 }, ctx)).toEqual([]);
    expect(checkPersonDebt({ ...b, toSavingsMinor: 500_001 }, ctx)).toEqual(["to_savings"]);
    expect(checkPersonDebt({ ...b, toSavingsMinor: -1 }, ctx)).toEqual(["to_savings"]);
  });

  it("the payback is at most what was borrowed, due in this cycle or later", () => {
    const b = { ...ok, direction: "borrowed" };
    expect(checkPersonDebt({ ...b, payback: { plannedMinor: 500_000, dueOn: "2027-01-10" } }, ctx)).toEqual(
      [],
    );
    expect(checkPersonDebt({ ...b, payback: { plannedMinor: 500_001, dueOn: "2026-12-01" } }, ctx)).toEqual([
      "payback_amount",
    ]);
    expect(checkPersonDebt({ ...b, payback: { plannedMinor: 500_000, dueOn: "2026-11-24" } }, ctx)).toEqual([
      "payback_on",
    ]);
    expect(checkPersonDebt({ ...b, payback: { plannedMinor: 500_000, dueOn: "soon" } }, ctx)).toEqual([
      "payback_on",
    ]);
  });
});

describe("checkGotBack (spec 9)", () => {
  it("at most what is still owed, split to savings at most the amount", () => {
    const d = { ...lent, backMinor: 400_000 };
    expect(checkGotBack({ amountMinor: 600_000, toSavingsMinor: 600_000 }, d)).toEqual([]);
    expect(checkGotBack({ amountMinor: 600_001, toSavingsMinor: 0 }, d)).toEqual(["too_much"]);
    expect(checkGotBack({ amountMinor: 0, toSavingsMinor: 0 }, d)).toEqual(["amount"]);
    expect(checkGotBack({ amountMinor: 100, toSavingsMinor: 101 }, d)).toEqual(["to_savings"]);
  });

  it("only on money lent that is not closed", () => {
    const one = { amountMinor: 100, toSavingsMinor: 0 };
    expect(checkGotBack(one, borrowed)).toEqual(["entry"]);
    expect(checkGotBack(one, { ...lent, settledOn: "2026-11-30" })).toContain("entry");
  });
});

describe("paybacks on money borrowed (spec 9)", () => {
  it("a new payback is filled with what is owed past the open paybacks", () => {
    expect(paybackFillMinor(1_000_000, 300_000)).toBe(700_000);
    expect(paybackFillMinor(1_000_000, 1_200_000)).toBe(0);
  });

  it("at most that, due in this cycle or later", () => {
    const at = { cycleStartedOn: "2026-11-25", setAsideMinor: 300_000 };
    expect(checkPayback({ plannedMinor: 700_000, dueOn: "2026-12-10" }, borrowed, at)).toEqual([]);
    expect(checkPayback({ plannedMinor: 700_001, dueOn: "2026-12-10" }, borrowed, at)).toEqual(["too_much"]);
    expect(checkPayback({ plannedMinor: 0, dueOn: "2026-12-10" }, borrowed, at)).toEqual(["amount"]);
    expect(checkPayback({ plannedMinor: 100, dueOn: "2026-11-24" }, borrowed, at)).toEqual(["due_on"]);
  });

  it("only on money borrowed that is not closed", () => {
    const at = { cycleStartedOn: "2026-11-25", setAsideMinor: 0 };
    expect(checkPayback({ plannedMinor: 100, dueOn: "2026-12-10" }, lent, at)).toEqual(["entry"]);
    expect(
      checkPayback({ plannedMinor: 100, dueOn: "2026-12-10" }, { ...borrowed, settledOn: "2026-12-01" }, at),
    ).toContain("entry");
  });

  it("is named after the person", () => {
    expect(paybackName(" Nimal ")).toBe("Pay back Nimal");
  });
});
