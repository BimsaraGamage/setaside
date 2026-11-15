import { describe, expect, it } from "vitest";
import {
  addDays,
  checkFirstUse,
  dailyAllowance,
  daysBetween,
  daysLeft,
  formatMoney,
  freeMoney,
  isCurrency,
  isTimeZone,
  minorDigits,
  parseAmount,
  suggestSalaryDay,
  todayIn,
  todayView,
} from "../../src/money";

// Each case names the rule it checks (spec 16).

describe("amounts are whole minor units (ADR 0002)", () => {
  it("knows each currency's minor digits", () => {
    expect(minorDigits("LKR")).toBe(2);
    expect(minorDigits("USD")).toBe(2);
    expect(minorDigits("JPY")).toBe(0);
    expect(minorDigits("KWD")).toBe(3);
  });

  it("reads typed amounts into minor units, no floats", () => {
    expect(parseAmount("1850", "LKR")).toBe(185_000);
    expect(parseAmount("1,850.5", "LKR")).toBe(185_050);
    expect(parseAmount(" 0.07 ", "USD")).toBe(7);
    expect(parseAmount("1.1", "USD")).toBe(110);
    expect(parseAmount("19.99", "USD")).toBe(1999);
    expect(parseAmount("500", "JPY")).toBe(500);
    expect(parseAmount("1.234", "KWD")).toBe(1234);
    expect(parseAmount("0", "LKR")).toBe(0);
  });

  it("refuses amounts that are not plain non-negative numbers", () => {
    for (const bad of ["", "abc", "-5", "1.234", "1.2.3", "1e3", ".", "12,34,5x"]) {
      expect(parseAmount(bad, "LKR"), bad).toBeNull();
    }
    expect(parseAmount("5.5", "JPY")).toBeNull();
  });

  it("shows money with the currency's symbol, without .00 on whole amounts", () => {
    expect(formatMoney(185_000, "LKR")).toBe("Rs 1,850");
    expect(formatMoney(185_050, "LKR")).toBe("Rs 1,850.50");
    expect(formatMoney(1999, "USD")).toBe("$19.99");
    expect(formatMoney(-100_000, "LKR")).toBe("-Rs 1,000");
  });

  it("knows real currency codes and time zones", () => {
    expect(isCurrency("LKR")).toBe(true);
    expect(isCurrency("lkr")).toBe(false);
    expect(isCurrency("XYZ")).toBe(false);
    expect(isTimeZone("Asia/Colombo")).toBe(true);
    expect(isTimeZone("Mars/Base")).toBe(false);
  });
});

describe("days follow the home time zone (glossary: home time zone)", () => {
  it("today is the calendar day in the home time zone, not UTC", () => {
    // 18:29 UTC on 11 Nov is 23:59 in Colombo (UTC+5:30): still the 11th there.
    expect(todayIn("Asia/Colombo", Date.parse("2026-11-11T18:29:00Z"))).toBe("2026-11-11");
    // One minute later it is midnight in Colombo: the 12th, while UTC is still the 11th.
    expect(todayIn("Asia/Colombo", Date.parse("2026-11-11T18:30:00Z"))).toBe("2026-11-12");
    // West of UTC the day changes later.
    expect(todayIn("America/New_York", Date.parse("2026-11-12T04:59:00Z"))).toBe("2026-11-11");
    expect(todayIn("America/New_York", Date.parse("2026-11-12T05:00:00Z"))).toBe("2026-11-12");
  });

  it("counts plain calendar days", () => {
    expect(addDays("2026-11-30", 1)).toBe("2026-12-01");
    expect(addDays("2026-03-01", -1)).toBe("2026-02-28");
    expect(daysBetween("2026-11-12", "2026-11-30")).toBe(18);
    expect(daysBetween("2026-12-31", "2027-01-01")).toBe(1);
  });
});

describe("expected salary day is suggested from the usual pay day (spec 2)", () => {
  it("is the next usual pay day after today", () => {
    expect(suggestSalaryDay("2026-11-12", 25)).toBe("2026-11-25");
    expect(suggestSalaryDay("2026-11-25", 25)).toBe("2026-12-25");
    expect(suggestSalaryDay("2026-11-26", 25)).toBe("2026-12-25");
    expect(suggestSalaryDay("2026-12-26", 25)).toBe("2027-01-25");
  });

  it("uses the month's last day when the pay day is past it", () => {
    expect(suggestSalaryDay("2027-02-01", 31)).toBe("2027-02-28");
    expect(suggestSalaryDay("2028-02-01", 30)).toBe("2028-02-29");
    expect(suggestSalaryDay("2026-11-30", 31)).toBe("2026-12-31");
    expect(suggestSalaryDay("2026-11-12", 31)).toBe("2026-11-30");
  });
});

describe("days left (spec 7)", () => {
  it("counts today and runs to the day before the expected salary day", () => {
    expect(daysLeft("2026-11-12", "2026-11-30")).toBe(18);
    expect(daysLeft("2026-11-29", "2026-11-30")).toBe(1);
  });

  it("is 0 on and after the expected salary day (salary late comes with item 13)", () => {
    expect(daysLeft("2026-11-30", "2026-11-30")).toBe(0);
    expect(daysLeft("2026-12-02", "2026-11-30")).toBe(0);
  });
});

describe("free money (glossary: free money)", () => {
  it("is the opening money held, in the spending currency", () => {
    expect(
      freeMoney({
        spendingCurrency: "LKR",
        incomes: [{ kind: "opening", currency: "LKR", amountMinor: 9_000_000, toSavingsMinor: 0 }],
      }),
    ).toBe(9_000_000);
  });

  it("leaves out the part of income sent to savings", () => {
    expect(
      freeMoney({
        spendingCurrency: "LKR",
        incomes: [
          { kind: "opening", currency: "LKR", amountMinor: 9_000_000, toSavingsMinor: 0 },
          { kind: "extra", currency: "LKR", amountMinor: 1_000_000, toSavingsMinor: 400_000 },
        ],
      }),
    ).toBe(9_600_000);
  });
});

describe("daily allowance (spec 7)", () => {
  it("is free money divided over the days left, rounded down to a whole unit", () => {
    // Rs 90,000 over 18 days = Rs 5,000 a day.
    expect(dailyAllowance(9_000_000, 18, "LKR")).toBe(500_000);
    // Rs 10,000 over 3 days = Rs 3,333.33…, shown as Rs 3,333.
    expect(dailyAllowance(1_000_000, 3, "LKR")).toBe(333_300);
    // $100.99 over 2 days = $50.495 → $50.
    expect(dailyAllowance(10_099, 2, "USD")).toBe(5000);
    expect(dailyAllowance(1000, 3, "JPY")).toBe(333);
  });

  it("is 0 when free money is at zero or below", () => {
    expect(dailyAllowance(0, 10, "LKR")).toBe(0);
    expect(dailyAllowance(-50_000, 10, "LKR")).toBe(0);
  });

  it("puts everything on today when no days are left", () => {
    expect(dailyAllowance(1_234_567, 0, "LKR")).toBe(1_234_500);
  });
});

describe("Today's numbers (spec 7, 10)", () => {
  it("shows free money, days left and the allowance for a first cycle", () => {
    const view = todayView(
      {
        spendingCurrency: "LKR",
        expectedSalaryOn: "2026-11-30",
        incomes: [{ kind: "opening", currency: "LKR", amountMinor: 9_000_000, toSavingsMinor: 0 }],
        spends: [],
      },
      "2026-11-12",
    );
    expect(view).toEqual({
      freeMinor: 9_000_000,
      daysLeft: 18,
      allowanceMinor: 500_000,
      spentTodayMinor: 0,
      leftTodayMinor: 500_000,
      tomorrowMinor: 529_400,
      // No cycle start given, and no speed on a first cycle's first day (item 8).
      speedPerDayMinor: null,
      speedFromLastCycle: false,
      verdict: { kind: "early" },
      // Nothing to ask on a cycle's first day (item 9).
      underspend: null,
      currency: "LKR",
    });
  });
});

describe("first use (spec 2)", () => {
  const ok = {
    salaryCurrency: "LKR",
    spendingCurrency: "LKR",
    homeTimeZone: "Asia/Colombo",
    usualPayDay: 25,
    heldMinor: 9_000_000,
    expectedSalaryOn: "2026-11-25",
  };

  it("accepts a complete first use", () => {
    expect(checkFirstUse(ok, "2026-11-12")).toEqual([]);
  });

  it("allows zero money held", () => {
    expect(checkFirstUse({ ...ok, heldMinor: 0 }, "2026-11-12")).toEqual([]);
  });

  it("needs the expected salary day after today", () => {
    expect(checkFirstUse({ ...ok, expectedSalaryOn: "2026-11-12" }, "2026-11-12")).toEqual([
      "expected_salary_on",
    ]);
    expect(checkFirstUse({ ...ok, expectedSalaryOn: "2026-11-30" }, "2026-11-12")).toEqual([]);
  });

  it("needs real currencies, the same one for now (two currencies come with item 15)", () => {
    expect(checkFirstUse({ ...ok, salaryCurrency: "USD" }, "2026-11-12")).toEqual(["salary_currency"]);
    expect(checkFirstUse({ ...ok, spendingCurrency: "XYZ", salaryCurrency: "XYZ" }, "2026-11-12")).toEqual([
      "spending_currency",
    ]);
  });

  it("needs a real time zone, a pay day 1–31 and whole non-negative money", () => {
    expect(checkFirstUse({ ...ok, homeTimeZone: "Mars/Base" }, "2026-11-12")).toEqual(["home_time_zone"]);
    expect(checkFirstUse({ ...ok, usualPayDay: 0 }, "2026-11-12")).toEqual(["usual_pay_day"]);
    expect(checkFirstUse({ ...ok, usualPayDay: 32 }, "2026-11-12")).toEqual(["usual_pay_day"]);
    expect(checkFirstUse({ ...ok, heldMinor: -1 }, "2026-11-12")).toEqual(["held"]);
    expect(checkFirstUse({ ...ok, heldMinor: 1.5 }, "2026-11-12")).toEqual(["held"]);
  });
});
