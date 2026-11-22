import fc from "fast-check";
import { describe, expect, it } from "vitest";
import {
  checkGoalTakeOut,
  checkSavingsGoal,
  fairShareMinor,
  goalDrafts,
  goalSavedMinor,
  goalSharesLeft,
  goalStatus,
  type SavingsGoalEntry,
} from "../../src/money";

// SAB-68 · Savings goals (spec 5, decided in SAB-67). Each case names the rule it checks.

const japan: SavingsGoalEntry = {
  id: "g1",
  name: "Trip to Japan",
  currency: "LKR",
  targetMinor: 60_000_000,
  byOn: "2027-06-01",
  startMinor: 0,
  stopped: false,
  movedMinor: 0,
  takenOutMinor: 0,
  shareCount: 0,
};

const ctx = { spendingCurrency: "LKR", salaryCurrency: "USD", savingsMinor: 10_000_000 };

describe("checking a savings goal (spec 5)", () => {
  it("Trip to Japan, Rs 600,000 by 1 Jun 2027, is fine", () => {
    expect(
      checkSavingsGoal(
        {
          name: "Trip to Japan",
          currency: "LKR",
          targetMinor: 60_000_000,
          byOn: "2027-06-01",
          startMinor: 0,
        },
        { ...ctx, today: "2026-11-22" },
      ),
    ).toEqual([]);
  });

  it("needs a name, a whole target above zero, a by date after today and one of the user's currencies", () => {
    expect(
      checkSavingsGoal(
        { name: " ", currency: "EUR", targetMinor: 0, byOn: "2026-11-22", startMinor: 0 },
        { ...ctx, today: "2026-11-22" },
      ),
    ).toEqual(["name", "currency", "target", "by_on"]);
  });

  it("already saved is at most the savings total and the target", () => {
    const base = { name: "Car", currency: "LKR", targetMinor: 5_000_000, byOn: "2027-01-01" };
    expect(checkSavingsGoal({ ...base, startMinor: 10_000_001 }, { ...ctx, today: "2026-11-22" })).toEqual([
      "start",
    ]);
    expect(checkSavingsGoal({ ...base, startMinor: -1 }, { ...ctx, today: "2026-11-22" })).toEqual(["start"]);
    expect(checkSavingsGoal({ ...base, startMinor: 5_000_000 }, { ...ctx, today: "2026-11-22" })).toEqual([]);
  });

  it("a changed goal may keep a by date that has passed", () => {
    expect(
      checkSavingsGoal(
        { name: "Car", currency: "LKR", targetMinor: 5_000_000, byOn: "2026-10-01", startMinor: 0 },
        { ...ctx, today: "2026-11-22", keepByOn: "2026-10-01" },
      ),
    ).toEqual([]);
  });
});

describe("saved toward a goal (spec 5)", () => {
  it("is already saved plus what its shares' moves cover", () => {
    expect(goalSavedMinor({ ...japan, startMinor: 1_000_000, movedMinor: 2_500_000 })).toBe(3_500_000);
  });

  // SAB-69 · Take out of savings from a goal (SAB-67 pick 9).
  it("less what take-outs from it took", () => {
    expect(
      goalSavedMinor({ ...japan, startMinor: 1_000_000, movedMinor: 2_500_000, takenOutMinor: 500_000 }),
    ).toBe(3_000_000);
  });
});

describe("taking out from a goal (SAB-67 pick 9)", () => {
  const saved = { ...japan, movedMinor: 2_500_000 };

  it("up to what is saved toward it, in its currency, is fine", () => {
    expect(checkGoalTakeOut({ currency: "LKR", amountMinor: 2_500_000 }, saved)).toEqual([]);
  });

  it("more than is saved toward it is too much", () => {
    expect(checkGoalTakeOut({ currency: "LKR", amountMinor: 2_500_001 }, saved)).toEqual(["goal_too_much"]);
    expect(
      checkGoalTakeOut({ currency: "LKR", amountMinor: 2_000_001 }, { ...saved, takenOutMinor: 500_000 }),
    ).toEqual(["goal_too_much"]);
  });

  it("a goal in the other currency can't be named", () => {
    expect(checkGoalTakeOut({ currency: "USD", amountMinor: 100 }, saved)).toEqual(["goal"]);
  });

  it("a take-out makes what is left bigger, so the next fair share grows", () => {
    const at = { startedOn: "2026-12-25", usualPayDay: 25 };
    const before = fairShareMinor(saved, at);
    const after = fairShareMinor({ ...saved, takenOutMinor: 1_000_000 }, at);
    expect(after).toBeGreaterThan(before);
  });

  it("a take-out from a reached goal makes it no longer reached", () => {
    const cycle = { startedOn: "2026-11-25", usualPayDay: 25, today: "2026-11-30" };
    const full = { ...japan, movedMinor: 60_000_000, shareCount: 7 };
    expect(goalStatus(full, [], cycle)).toEqual({ kind: "reached" });
    expect(goalStatus({ ...full, takenOutMinor: 1 }, [], cycle).kind).not.toBe("reached");
  });
});

describe("shares left (spec 5)", () => {
  it("counts this cycle and each usual pay day after its start and before the by date", () => {
    // Cycle from 25 Nov 2026, pay day 25: Dec … May are before 1 Jun 2027: 1 + 6.
    expect(goalSharesLeft({ byOn: "2027-06-01", startedOn: "2026-11-25", usualPayDay: 25 })).toBe(7);
  });

  it("a salary day landing on the by date is too late to count", () => {
    expect(goalSharesLeft({ byOn: "2027-01-25", startedOn: "2026-11-25", usualPayDay: 25 })).toBe(2);
  });

  it("is at least 1, also once the by date has passed", () => {
    expect(goalSharesLeft({ byOn: "2026-11-01", startedOn: "2026-11-25", usualPayDay: 25 })).toBe(1);
  });
});

describe("the fair share (spec 5)", () => {
  const at = { startedOn: "2026-11-25", usualPayDay: 25 };

  it("is what is left over the shares left, rounded up to a whole unit", () => {
    // Rs 600,000 over 7 shares: 85,714.28… → Rs 85,715.
    expect(fairShareMinor(japan, at)).toBe(8_571_500);
  });

  it("the last share is only what is left", () => {
    const last = { ...japan, byOn: "2026-12-20", movedMinor: 59_999_950 };
    expect(fairShareMinor(last, at)).toBe(50);
  });

  it("counts already saved, moves and what is still to pay on shares already in the cycle", () => {
    const g = { ...japan, startMinor: 10_000_000, movedMinor: 15_000_000 };
    // Left 350,000 − 70,000 carried = 280,000 over 7 = 40,000.
    expect(fairShareMinor(g, { ...at, plannedMinor: 7_000_000 })).toBe(4_000_000);
  });

  it("is 0 once reached", () => {
    expect(fairShareMinor({ ...japan, movedMinor: 60_000_000 }, at)).toBe(0);
    expect(fairShareMinor({ ...japan, movedMinor: 70_000_000 }, at)).toBe(0);
  });

  it("dollars round up to a whole dollar", () => {
    const usd = { ...japan, currency: "USD", targetMinor: 100_000 };
    // $1,000 over 7 = 142.857… → $143.
    expect(fairShareMinor(usd, at)).toBe(14_300);
  });

  it("shares at the fair share each cycle always reach the target, never by more than the rounding", () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 1, max: 100_000_000 }),
        fc.integer({ min: 1, max: 36 }),
        fc.integer({ min: 1, max: 31 }),
        (targetMinor, months, payDay) => {
          let g: SavingsGoalEntry = { ...japan, targetMinor, byOn: "2029-12-31" };
          let startedOn = "2026-11-25";
          // Run cycles up to the by date: each salary day moves the fair share.
          const byOn = addDaysMonths(startedOn, months);
          g = { ...g, byOn };
          for (let i = 0; i < 60 && goalSavedMinor(g) < g.targetMinor; i++) {
            const share = fairShareMinor(g, { startedOn, usualPayDay: payDay });
            expect(share).toBeGreaterThan(0);
            expect(share).toBeLessThanOrEqual(g.targetMinor - goalSavedMinor(g));
            g = { ...g, movedMinor: g.movedMinor + share };
            startedOn = nextPayDay(startedOn, payDay);
          }
          expect(goalSavedMinor(g)).toBe(g.targetMinor);
        },
      ),
    );
  });
});

describe("salary day's goal shares (spec 6 step 4)", () => {
  it("one Savings row per live goal, due on the new cycle's first day, never Every cycle", () => {
    expect(goalDrafts([japan], { startedOn: "2026-11-25", usualPayDay: 25 })).toEqual([
      {
        goalId: "g1",
        recurringId: null,
        carriedFromId: null,
        name: "Trip to Japan",
        kind: "savings",
        currency: "LKR",
        plannedMinor: 8_571_500,
        dueOn: "2026-11-25",
        everyCycle: false,
      },
    ]);
  });

  it("leaves out stopped and reached goals", () => {
    const stopped = { ...japan, id: "g2", stopped: true };
    const reached = { ...japan, id: "g3", movedMinor: 60_000_000 };
    expect(goalDrafts([stopped, reached], { startedOn: "2026-11-25", usualPayDay: 25 })).toEqual([]);
  });

  it("what step 2 paid or carried counts first", () => {
    const [row] = goalDrafts(
      [japan],
      { startedOn: "2026-11-25", usualPayDay: 25 },
      { planned: { g1: 7_000_000 }, paid: { g1: 2_000_000 } },
    );
    // Left 600,000 − 20,000 paid − 70,000 carried = 510,000 over 7 → 72,857.14… → 72,858.
    expect(row?.plannedMinor).toBe(7_285_800);
  });

  it("by date passed, not reached: all that is left as one share", () => {
    const late = { ...japan, byOn: "2026-11-01", movedMinor: 50_000_000 };
    const [row] = goalDrafts([late], { startedOn: "2026-11-25", usualPayDay: 25 });
    expect(row?.plannedMinor).toBe(10_000_000);
  });
});

describe("a goal's status line (spec 10)", () => {
  const cycle = { startedOn: "2026-11-25", usualPayDay: 25, today: "2026-11-30" };

  it("a share at the fair share: Rs X a cycle · N cycles left", () => {
    const g = { ...japan, shareCount: 1 };
    expect(goalStatus(g, [{ plannedMinor: 8_571_500, coveredMinor: 0, open: true }], cycle)).toEqual({
      kind: "on_plan",
      shareMinor: 8_571_500,
      cyclesLeft: 7,
    });
  });

  it("a share lowered or removed this cycle: Behind by what is short", () => {
    const g = { ...japan, shareCount: 1 };
    expect(goalStatus(g, [{ plannedMinor: 7_571_500, coveredMinor: 0, open: true }], cycle)).toEqual({
      kind: "behind",
      shortMinor: 1_000_000,
    });
    expect(goalStatus({ ...g, shareCount: 2 }, [], cycle)).toEqual({ kind: "behind", shortMinor: 8_571_500 });
  });

  it("this cycle's moves count toward the share, not twice", () => {
    const g = { ...japan, shareCount: 1, movedMinor: 8_571_500 };
    expect(goalStatus(g, [{ plannedMinor: 8_571_500, coveredMinor: 8_571_500, open: false }], cycle)).toEqual(
      { kind: "on_plan", shareMinor: 8_571_500, cyclesLeft: 7 },
    );
  });

  it("a take-out this cycle doesn't make this cycle's share Behind: the next salary day's share grows", () => {
    const g = { ...japan, shareCount: 1, takenOutMinor: 5_000_000, startMinor: 5_000_000 };
    expect(
      goalStatus(g, [{ plannedMinor: 7_857_200, coveredMinor: 0, open: true }], {
        ...cycle,
        takenOutNowMinor: 5_000_000,
      }),
    ).toEqual({ kind: "on_plan", shareMinor: 7_857_200, cyclesLeft: 7 });
  });

  it("a goal with no share yet starts next salary day", () => {
    expect(goalStatus(japan, [], cycle)).toEqual({ kind: "starts", shareMinor: 10_000_000 });
  });

  it("Reached once saved toward it is at the target", () => {
    expect(goalStatus({ ...japan, movedMinor: 60_000_000 }, [], cycle)).toEqual({ kind: "reached" });
  });

  it("By date passed with what is left", () => {
    const g = { ...japan, byOn: "2026-11-29", movedMinor: 50_000_000, shareCount: 3 };
    expect(goalStatus(g, [], cycle)).toEqual({ kind: "passed", leftMinor: 10_000_000 });
  });

  it("Stopped", () => {
    expect(goalStatus({ ...japan, stopped: true }, [], cycle)).toEqual({ kind: "stopped" });
  });
});

/** `months` months after a day, on its day of the month (clamped). */
function addDaysMonths(day: string, months: number): string {
  const [y, m, d] = day.split("-").map(Number) as [number, number, number];
  const t = new Date(Date.UTC(y, m - 1 + months, 1));
  const last = new Date(Date.UTC(t.getUTCFullYear(), t.getUTCMonth() + 1, 0)).getUTCDate();
  return new Date(Date.UTC(t.getUTCFullYear(), t.getUTCMonth(), Math.min(d, last)))
    .toISOString()
    .slice(0, 10);
}

function nextPayDay(day: string, payDay: number): string {
  const [y, m] = day.split("-").map(Number) as [number, number];
  for (let off = 0; off < 3; off++) {
    const t = new Date(Date.UTC(y, m - 1 + off, 1));
    const last = new Date(Date.UTC(t.getUTCFullYear(), t.getUTCMonth() + 1, 0)).getUTCDate();
    const c = new Date(Date.UTC(t.getUTCFullYear(), t.getUTCMonth(), Math.min(payDay, last)))
      .toISOString()
      .slice(0, 10);
    if (c > day) return c;
  }
  throw new Error("unreachable");
}
