import { describe, expect, it } from "vitest";
import {
  type CycleEntries,
  checkSpend,
  type SpendEntry,
  todayIn,
  todayView,
  zoneToAsk,
} from "../../src/money";

// Item 22 · Home time zone switch (spec 10, 16). Each case names the rule it checks.

describe("the switch question is asked once (spec 10: home time zone)", () => {
  it("asks nothing while the phone is in the home time zone", () => {
    expect(zoneToAsk({ home: "Asia/Colombo", phone: "Asia/Colombo", asked: null })).toBeNull();
  });

  it("asks about the phone's zone when it differs from home", () => {
    expect(zoneToAsk({ home: "Asia/Colombo", phone: "Europe/London", asked: null })).toBe("Europe/London");
  });

  it("does not ask again about a zone already answered (Keep)", () => {
    expect(zoneToAsk({ home: "Asia/Colombo", phone: "Europe/London", asked: "Europe/London" })).toBeNull();
  });

  it("asks again when the phone moves to yet another zone", () => {
    expect(zoneToAsk({ home: "Asia/Colombo", phone: "Asia/Dubai", asked: "Europe/London" })).toBe(
      "Asia/Dubai",
    );
  });

  it("after switching to London, coming back home is a new question", () => {
    // Switch saved home = London and asked = London; the phone is back in Colombo.
    expect(zoneToAsk({ home: "Europe/London", phone: "Asia/Colombo", asked: "Europe/London" })).toBe(
      "Asia/Colombo",
    );
  });

  it("never asks about a zone the app does not know", () => {
    expect(zoneToAsk({ home: "Asia/Colombo", phone: "Mars/Base", asked: null })).toBeNull();
    expect(zoneToAsk({ home: "Asia/Colombo", phone: "", asked: null })).toBeNull();
  });
});

describe("midnight in the home time zone (spec 16: home-time-zone cases around midnight)", () => {
  const at = (iso: string) => Date.parse(iso);

  it("the day turns at midnight in the home zone, not at UTC midnight (Colombo, UTC+5:30)", () => {
    expect(todayIn("Asia/Colombo", at("2026-11-16T18:29:59Z"))).toBe("2026-11-16");
    expect(todayIn("Asia/Colombo", at("2026-11-16T18:30:00Z"))).toBe("2026-11-17");
    // UTC midnight is 05:30 in Colombo: nothing turns then.
    expect(todayIn("Asia/Colombo", at("2026-11-16T23:59:59Z"))).toBe("2026-11-17");
    expect(todayIn("Asia/Colombo", at("2026-11-17T00:00:00Z"))).toBe("2026-11-17");
  });

  it("turns on a quarter-hour zone too (Kathmandu, UTC+5:45)", () => {
    expect(todayIn("Asia/Kathmandu", at("2026-11-16T18:14:59Z"))).toBe("2026-11-16");
    expect(todayIn("Asia/Kathmandu", at("2026-11-16T18:15:00Z"))).toBe("2026-11-17");
  });

  it("turns at local midnight on both sides of a clock change (London, 29 Mar 2026)", () => {
    // Before the change London is UTC+0; after it UTC+1.
    expect(todayIn("Europe/London", at("2026-03-28T23:59:59Z"))).toBe("2026-03-28");
    expect(todayIn("Europe/London", at("2026-03-29T00:00:00Z"))).toBe("2026-03-29");
    expect(todayIn("Europe/London", at("2026-03-29T22:59:59Z"))).toBe("2026-03-29");
    expect(todayIn("Europe/London", at("2026-03-29T23:00:00Z"))).toBe("2026-03-30");
  });

  it("switching west just after midnight moves today back a day", () => {
    // 00:15 on the 17th in Colombo is 18:45 on the 16th in London.
    const now = at("2026-11-16T18:45:00Z");
    expect(todayIn("Asia/Colombo", now)).toBe("2026-11-17");
    expect(todayIn("Europe/London", now)).toBe("2026-11-16");
  });

  it("switching east just before midnight moves today on a day", () => {
    // 23:00 on the 16th in London is 04:30 on the 17th in Colombo.
    const now = at("2026-11-16T23:00:00Z");
    expect(todayIn("Europe/London", now)).toBe("2026-11-16");
    expect(todayIn("Asia/Colombo", now)).toBe("2026-11-17");
  });

  describe("what a switch does to today's numbers", () => {
    const spend = (spentOn: string, amountMinor: number): SpendEntry => ({
      spentOn,
      currency: "LKR",
      amountMinor,
    });
    /** Rs 90,000 held, salary expected 30 Nov. */
    const cycle = (spends: SpendEntry[]): CycleEntries => ({
      spendingCurrency: "LKR",
      expectedSalaryOn: "2026-11-30",
      incomes: [{ kind: "opening", currency: "LKR", amountMinor: 9_000_000, toSavingsMinor: 0 }],
      spends,
    });

    it("a spend made on the 17th before switching west still counts as spent today (the 16th)", () => {
      // Rs 1,000 on the 16th, Rs 500 just after midnight on the 17th (Colombo), then switched to London.
      const e = cycle([spend("2026-11-16", 100_000), spend("2026-11-17", 50_000)]);
      const view = todayView(e, "2026-11-16");
      // Free money already has both; today started from Rs 90,000 with 14 days left.
      expect(view.freeMinor).toBe(8_850_000);
      expect(view.daysLeft).toBe(14);
      expect(view.allowanceMinor).toBe(642_800);
      expect(view.spentTodayMinor).toBe(150_000);
    });

    it("switching east starts a new day: the allowance is worked out again from what is left", () => {
      // Rs 1,000 on the 16th in London, then switched to Colombo where it is the 17th.
      const e = cycle([spend("2026-11-16", 100_000)]);
      expect(todayView(e, "2026-11-16").allowanceMinor).toBe(642_800);
      const after = todayView(e, "2026-11-17");
      // Rs 89,000 over 13 days = Rs 6,846.15… → Rs 6,846.
      expect(after.allowanceMinor).toBe(684_600);
      expect(after.spentTodayMinor).toBe(0);
    });

    it("a new spend is dated today in the new home zone; the day it came from cannot be ahead of it", () => {
      const ctx = { today: "2026-11-16", cycleStartedOn: "2026-11-01", spendingCurrency: "LKR" };
      const ok = { amountMinor: 50_000, currency: "LKR", note: null };
      expect(checkSpend({ ...ok, spentOn: "2026-11-16" }, ctx)).toEqual([]);
      // The Colombo date is a day ahead of London now: not allowed until London reaches it.
      expect(checkSpend({ ...ok, spentOn: "2026-11-17" }, ctx)).toEqual(["spent_on"]);
    });
  });
});
