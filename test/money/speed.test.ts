import fc from "fast-check";
import { describe, expect, it } from "vitest";
import {
  type CycleEntries,
  cycleSpeeds,
  type PotEntry,
  perDayMinor,
  potVerdict,
  runOutVerdict,
  type Speed,
  type SpendEntry,
  speedNow,
  todayView,
} from "../../src/money";

// Item 8 · Spending speed and verdict. Each case names the rule it checks (spec 7, 16).

const START = "2026-11-01";
const TODAY = "2026-11-11"; // 10 finished days: 1–10 Nov
const SALARY = "2026-11-21"; // 10 days left: 11–20 Nov

const spend = (amountMinor: number, spentOn = "2026-11-05", more: Partial<SpendEntry> = {}): SpendEntry => ({
  spentOn,
  currency: "LKR",
  amountMinor,
  ...more,
});

const pot = (id: string, amountMinor: number, archived = false): PotEntry => ({
  id,
  currency: "LKR",
  amountMinor,
  archived,
});

/** Rs 100,000 held on 1 Nov, salary expected 21 Nov. */
function cycle(spends: SpendEntry[], more: Partial<CycleEntries> = {}): CycleEntries {
  return {
    spendingCurrency: "LKR",
    startedOn: START,
    expectedSalaryOn: SALARY,
    incomes: [{ kind: "opening", currency: "LKR", amountMinor: 10_000_000, toSavingsMinor: 0 }],
    spends,
    commitments: [],
    pots: [],
    ...more,
  };
}

describe("spending speed (spec 7)", () => {
  it("is free-money spends of the finished days ÷ finished days", () => {
    const s = speedNow(cycle([spend(2_000_000), spend(1_000_000, "2026-11-10")]), TODAY);
    expect(s).toEqual({ totalMinor: 3_000_000, days: 10, lastCycle: false });
    expect(perDayMinor(s as Speed)).toBe(300_000);
  });

  it("today's spends count from the next morning", () => {
    const s = speedNow(cycle([spend(2_000_000), spend(5_000_000, TODAY)]), TODAY);
    expect(s?.totalMinor).toBe(2_000_000);
  });

  it("leaves out one-off spends", () => {
    const s = speedNow(cycle([spend(2_000_000), spend(4_000_000, "2026-11-06", { oneOff: true })]), TODAY);
    expect(s?.totalMinor).toBe(2_000_000);
  });

  it("leaves out spends covered by a pot, but counts the part past an empty pot", () => {
    const e = cycle(
      [spend(800_000, "2026-11-03", { potId: "g" }), spend(500_000, "2026-11-08", { potId: "g" })],
      {
        pots: [pot("g", 1_000_000)],
      },
    );
    expect(speedNow(e, TODAY)?.totalMinor).toBe(300_000);
  });

  it("a one-off spend in a pot is left out of the part past the pot first", () => {
    const e = cycle(
      [
        spend(800_000, "2026-11-03", { potId: "g" }),
        spend(500_000, "2026-11-08", { potId: "g", oneOff: true }),
      ],
      { pots: [pot("g", 1_000_000)] },
    );
    expect(speedNow(e, TODAY)?.totalMinor).toBe(0);
  });

  it("a stopped pot's spends past its amount count too", () => {
    const e = cycle([spend(1_500_000, "2026-11-03", { potId: "g" })], { pots: [pot("g", 1_000_000, true)] });
    expect(speedNow(e, TODAY)?.totalMinor).toBe(500_000);
  });

  it("a spend whose pot is gone counts as free money", () => {
    expect(speedNow(cycle([spend(700_000, "2026-11-03", { potId: "gone" })]), TODAY)?.totalMinor).toBe(
      700_000,
    );
  });

  it("commitment payments are not spends, so they never count", () => {
    const e = cycle([], {
      commitments: [
        {
          currency: "LKR",
          plannedMinor: 5_000_000,
          dueOn: "2026-11-05",
          state: "finished",
          payments: [{ amountMinor: 5_000_000, currency: "LKR", paidOn: "2026-11-05" }],
        },
      ],
    });
    expect(speedNow(e, TODAY)?.totalMinor).toBe(0);
  });

  it("first 3 days of a cycle: last cycle's speed is used", () => {
    const last: Speed = { totalMinor: 6_000_000, days: 30 };
    for (const today of ["2026-11-01", "2026-11-02", "2026-11-03"]) {
      expect(speedNow(cycle([spend(9_000_000, START)], { lastSpeed: last }), today)).toEqual({
        ...last,
        lastCycle: true,
      });
    }
    // The 4th day uses this cycle's own 3 finished days.
    expect(speedNow(cycle([spend(900_000, START)], { lastSpeed: last }), "2026-11-04")).toEqual({
      totalMinor: 900_000,
      days: 3,
      lastCycle: false,
    });
  });

  it("first 3 days of the very first cycle: no speed (Too early to tell)", () => {
    expect(speedNow(cycle([spend(100_000, START)]), "2026-11-03")).toBeNull();
    expect(todayView(cycle([], { startedOn: "2026-11-10" }), TODAY).verdict).toEqual({ kind: "early" });
  });

  it("last cycle's speed: the whole ended cycle, one-offs and pot spends left out", () => {
    const ended = {
      spendingCurrency: "LKR",
      spends: [
        spend(3_000_000, "2026-10-05"),
        spend(9_000_000, "2026-10-06", { oneOff: true }),
        spend(400_000, "2026-10-07", { potId: "g" }),
        spend(400_000, "2026-10-08", { potId: "g" }),
        spend(400_000, "2026-10-31", { potId: "f" }),
      ],
      pots: [pot("g", 500_000), pot("f", 1_000_000)],
    };
    const out = cycleSpeeds(ended, "2026-10-01", "2026-11-01");
    expect(out.speed).toEqual({ totalMinor: 3_300_000, days: 31 });
    expect(out.pots).toEqual({
      g: { totalMinor: 800_000, days: 31 },
      f: { totalMinor: 400_000, days: 31 },
    });
  });

  it("per day rounds to the nearest minor unit; 0 with no finished days", () => {
    expect(perDayMinor({ totalMinor: 1_000, days: 3 })).toBe(333);
    expect(perDayMinor({ totalMinor: 0, days: 0 })).toBe(0);
  });
});

describe("run-out verdict (spec 7)", () => {
  const base = { startMinor: 1_000_000, allowanceMinor: 100_000, daysLeft: 10, today: TODAY };

  it("On track: speed at most 90% of today's allowance", () => {
    expect(runOutVerdict({ ...base, speed: { totalMinor: 900_000, days: 10 } })).toEqual({
      kind: "on_track",
    });
    expect(runOutVerdict({ ...base, speed: { totalMinor: 0, days: 10 } })).toEqual({ kind: "on_track" });
  });

  it("Tight: above 90% and free money still lasts to the expected salary day", () => {
    expect(runOutVerdict({ ...base, speed: { totalMinor: 900_010, days: 10 } })).toEqual({ kind: "tight" });
    expect(runOutVerdict({ ...base, speed: { totalMinor: 1_000_000, days: 10 } })).toEqual({ kind: "tight" });
  });

  it("Runs out on today + free money ÷ speed (whole days)", () => {
    // Rs 10,000 at Rs 1,250 a day lasts 8 days: 11–18 Nov, runs out on the 19th.
    expect(runOutVerdict({ ...base, speed: { totalMinor: 1_250_000, days: 10 } })).toEqual({
      kind: "runs_out",
      on: "2026-11-19",
    });
  });

  it("no speed yet: Too early to tell", () => {
    expect(runOutVerdict({ ...base, speed: null })).toEqual({ kind: "early" });
  });

  it("free money at zero or below: Over by X takes the place of the verdict", () => {
    const e = cycle([spend(10_500_000)]);
    expect(todayView(e, TODAY).verdict).toEqual({ kind: "over", overMinor: 500_000 });
  });
});

describe("Today's speed, verdict and tomorrow line (spec 7, 10)", () => {
  it("uses the start-of-day free money and the rounded allowance, fixed for the day", () => {
    // Rs 70,000 spent over 10 days (Rs 7,000 a day); Rs 30,000 left for 10 days: Rs 3,000 a day.
    const e = cycle([spend(7_000_000)]);
    const v = todayView(e, TODAY);
    expect(v.allowanceMinor).toBe(300_000);
    expect(v.speedPerDayMinor).toBe(700_000);
    expect(v.verdict).toEqual({ kind: "runs_out", on: "2026-11-15" });
    // A spend today changes neither the speed nor the verdict until tomorrow.
    const later = todayView(cycle([spend(7_000_000), spend(2_000_000, TODAY)]), TODAY);
    expect(later.speedPerDayMinor).toBe(700_000);
    expect(later.verdict).toEqual(v.verdict);
  });

  it("no speed means no speed per day", () => {
    expect(todayView(cycle([], { startedOn: TODAY }), TODAY).speedPerDayMinor).toBeNull();
  });
});

describe("pot verdicts (spec 7)", () => {
  const ctx = { startedOn: START, today: TODAY, daysLeft: 10 };

  it("the same verdict from the pot's own speed and what is left in it", () => {
    // Rs 20,000 pot; Rs 5,000 in 10 days (Rs 500 a day); Rs 15,000 left for 10 days (Rs 1,500 a day).
    const p = pot("g", 2_000_000);
    expect(potVerdict(p, [spend(500_000, "2026-11-04", { potId: "g" })], ctx)).toEqual({ kind: "on_track" });
    // Rs 14,000 in 10 days: Rs 6,000 left at Rs 1,400 a day lasts 4 days.
    expect(potVerdict(p, [spend(1_400_000, "2026-11-04", { potId: "g" })], ctx)).toEqual({
      kind: "runs_out",
      on: "2026-11-15",
    });
    // Rs 10,000 in 10 days: Rs 10,000 left at Rs 1,000 a day just lasts.
    expect(potVerdict(p, [spend(1_000_000, "2026-11-04", { potId: "g" })], ctx)).toEqual({ kind: "tight" });
  });

  it("only that pot's spends count, one-offs and today's left out", () => {
    const p = pot("g", 2_000_000);
    const spends = [
      spend(500_000, "2026-11-04", { potId: "g" }),
      spend(9_000_000, "2026-11-04"),
      spend(100_000, "2026-11-05", { potId: "g", oneOff: true }),
      spend(900_000, TODAY, { potId: "g" }),
    ];
    // Rs 500 a day against Rs 14,000 left (Rs 1,400 a day).
    expect(potVerdict(p, spends, ctx)).toEqual({ kind: "on_track" });
  });

  it("a used-up pot shows Used up", () => {
    expect(potVerdict(pot("g", 500_000), [spend(500_000, TODAY, { potId: "g" })], ctx)).toEqual({
      kind: "used_up",
    });
  });

  it("first 3 days: last cycle's speed for that pot, else Too early to tell", () => {
    const early = { ...ctx, today: "2026-11-02" };
    expect(potVerdict(pot("g", 2_000_000), [], early)).toEqual({ kind: "early" });
    expect(
      potVerdict(pot("g", 2_000_000), [], { ...early, lastSpeed: { totalMinor: 6_000_000, days: 30 } }),
    ).toEqual({ kind: "tight" });
  });
});

describe("speed and verdict hold for any cycle (spec 16)", () => {
  const entries = fc.record({
    spends: fc.array(
      fc.record({
        amountMinor: fc.integer({ min: 1, max: 3_000_000 }),
        day: fc.integer({ min: 0, max: 10 }),
        oneOff: fc.boolean(),
        pot: fc.integer({ min: -1, max: 1 }),
      }),
      { maxLength: 30 },
    ),
    pots: fc.array(fc.integer({ min: 0, max: 3_000_000 }), { minLength: 2, maxLength: 2 }),
  });
  const build = (e: {
    spends: { amountMinor: number; day: number; oneOff: boolean; pot: number }[];
    pots: number[];
  }) =>
    cycle(
      e.spends.map((s) =>
        spend(s.amountMinor, `2026-11-${String(1 + s.day).padStart(2, "0")}`, {
          oneOff: s.oneOff,
          potId: s.pot < 0 ? null : `p${s.pot}`,
        }),
      ),
      { pots: e.pots.map((a, i) => pot(`p${i}`, a)) },
    );

  it("speed never counts more than the free-money spends of the finished days, nor below zero", () => {
    fc.assert(
      fc.property(entries, (e) => {
        const c = build(e);
        const s = speedNow(c, TODAY) as Speed;
        const free = c.spends
          .filter((x) => x.spentOn < TODAY && !x.oneOff)
          .reduce((t, x) => t + x.amountMinor, 0);
        return s.totalMinor >= 0 && s.totalMinor <= free;
      }),
      { seed: 20261115, numRuns: 2_000 },
    );
  });

  it("marking a spend one-off never raises the speed", () => {
    fc.assert(
      fc.property(entries, fc.nat(), (e, pick) => {
        if (e.spends.length === 0) return true;
        const c = build(e);
        const i = pick % c.spends.length;
        const marked = c.spends.map((x, j) => (j === i ? { ...x, oneOff: true } : x));
        return (
          (speedNow({ ...c, spends: marked }, TODAY) as Speed).totalMinor <=
          (speedNow(c, TODAY) as Speed).totalMinor
        );
      }),
      { seed: 20261115, numRuns: 2_000 },
    );
  });

  it("On track means free money lasts; Runs out is always before the expected salary day", () => {
    fc.assert(
      fc.property(entries, (e) => {
        const v = todayView(build(e), TODAY).verdict;
        if (v.kind === "runs_out") return v.on >= TODAY && v.on < SALARY;
        return true;
      }),
      { seed: 20261115, numRuns: 2_000 },
    );
  });
});
