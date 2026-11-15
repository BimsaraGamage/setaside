import fc from "fast-check";
import { describe, expect, it } from "vitest";
import {
  addDays,
  type CycleEntries,
  type DayChoiceEntry,
  type PotEntry,
  type SpendEntry,
  todayView,
} from "../../src/money";

// Item 9 · Underspend question. Each case names the rule it checks (spec 7, 16).

const START = "2026-11-01";
const SALARY = "2026-11-11"; // 10 days: 1–10 Nov; Rs 100,000 held → Rs 10,000 a day
const day = (n: number) => addDays(START, n - 1); // day(1) = 1 Nov

const spend = (amountMinor: number, spentOn: string, more: Partial<SpendEntry> = {}): SpendEntry => ({
  spentOn,
  currency: "LKR",
  amountMinor,
  ...more,
});

const pot = (id: string, amountMinor: number): PotEntry => ({
  id,
  currency: "LKR",
  amountMinor,
  archived: false,
});

function cycle(
  spends: SpendEntry[],
  dayChoices: DayChoiceEntry[] = [],
  more: Partial<CycleEntries> = {},
): CycleEntries {
  return {
    spendingCurrency: "LKR",
    startedOn: START,
    expectedSalaryOn: SALARY,
    incomes: [{ kind: "opening", currency: "LKR", amountMinor: 10_000_000, toSavingsMinor: 0 }],
    spends,
    commitments: [],
    pots: [],
    dayChoices,
    ...more,
  };
}

describe("underspend question (spec 7)", () => {
  it("is not asked on the cycle's first day", () => {
    expect(todayView(cycle([]), day(1)).underspend).toBeNull();
  });

  it("asks when yesterday's allowance was not all spent, with both answers' amounts", () => {
    const v = todayView(cycle([spend(400_000, day(1))]), day(2));
    // Spread: Rs 96,000 ÷ 9 days, rounded down. Add to today: Rs 6,000 + Rs 90,000 ÷ 9.
    expect(v.underspend).toEqual({
      unspentMinor: 600_000,
      days: 1,
      spreadMinor: 1_066_600,
      todayMinor: 1_600_000,
    });
    // Unanswered, the allowance is the spread one.
    expect(v.allowanceMinor).toBe(1_066_600);
  });

  it("does not ask when yesterday's allowance was all spent", () => {
    expect(todayView(cycle([spend(1_000_000, day(1))]), day(2)).underspend).toBeNull();
    expect(todayView(cycle([spend(1_400_000, day(1))]), day(2)).underspend).toBeNull();
  });

  it("Spread over the days left keeps the allowance as it is", () => {
    const v = todayView(cycle([spend(400_000, day(1))], [{ dayOn: day(2), choice: "spread" }]), day(2));
    expect(v.underspend).toBeNull();
    expect(v.allowanceMinor).toBe(1_066_600);
  });

  it("Add to today puts the unspent money on top of today's allowance", () => {
    const v = todayView(cycle([spend(400_000, day(1))], [{ dayOn: day(2), choice: "today" }]), day(2));
    expect(v.underspend).toBeNull();
    expect(v.allowanceMinor).toBe(1_600_000);
    expect(v.leftTodayMinor).toBe(1_600_000);
  });

  it("the answer does not change free money or tomorrow's amount", () => {
    const spends = [spend(400_000, day(1)), spend(200_000, day(2))];
    const spread = todayView(cycle(spends, [{ dayOn: day(2), choice: "spread" }]), day(2));
    const today = todayView(cycle(spends, [{ dayOn: day(2), choice: "today" }]), day(2));
    expect(today.freeMinor).toBe(spread.freeMinor);
    expect(today.tomorrowMinor).toBe(spread.tomorrowMinor);
  });

  it("an added-to-today allowance stays fixed for the day", () => {
    const v = todayView(
      cycle([spend(400_000, day(1)), spend(1_200_000, day(2))], [{ dayOn: day(2), choice: "today" }]),
      day(2),
    );
    expect(v.allowanceMinor).toBe(1_600_000);
    expect(v.spentTodayMinor).toBe(1_200_000);
    expect(v.leftTodayMinor).toBe(400_000);
  });

  it("days the app was not opened are added together into one question", () => {
    // Day 1: Rs 6,000 left. Day 2 (no answer): allowance Rs 10,666, nothing spent.
    const v = todayView(cycle([spend(400_000, day(1))]), day(3));
    expect(v.underspend?.unspentMinor).toBe(600_000 + 1_066_600);
    expect(v.underspend?.days).toBe(2);
  });

  it("an overspent day adds nothing (the following days already went down)", () => {
    // Day 1 over by Rs 5,000; day 2 allowance Rs 85,000 ÷ 9 = Rs 9,444, nothing spent.
    const v = todayView(cycle([spend(1_500_000, day(1))]), day(3));
    expect(v.underspend?.unspentMinor).toBe(944_400);
  });

  it("an answer closes the question: the next one counts only the days after it", () => {
    const v = todayView(
      cycle([spend(400_000, day(1)), spend(1_000_000, day(2))], [{ dayOn: day(2), choice: "spread" }]),
      day(3),
    );
    // Day 2's allowance was Rs 10,666, Rs 10,000 spent.
    expect(v.underspend).toEqual(expect.objectContaining({ unspentMinor: 66_600, days: 1 }));
  });

  it("after Add to today, what is left of the bigger allowance is asked about next morning", () => {
    const v = todayView(
      cycle([spend(400_000, day(1)), spend(1_000_000, day(2))], [{ dayOn: day(2), choice: "today" }]),
      day(3),
    );
    expect(v.underspend?.unspentMinor).toBe(600_000);
  });

  it("is not asked on the last day of the cycle", () => {
    expect(todayView(cycle([spend(100_000, day(9))]), day(10)).underspend).toBeNull();
  });

  it("an answer on a day with no question changes nothing", () => {
    const plain = todayView(cycle([spend(1_000_000, day(1))]), day(2));
    const answered = todayView(
      cycle([spend(1_000_000, day(1))], [{ dayOn: day(2), choice: "today" }]),
      day(2),
    );
    expect(answered.allowanceMinor).toBe(plain.allowanceMinor);
  });

  it("a spend covered by a pot is not taken from the allowance", () => {
    const e = cycle([spend(300_000, day(1), { potId: "g" })], [], { pots: [pot("g", 1_000_000)] });
    // Free money Rs 90,000 → Rs 9,000 a day; the pot spend is the pot's.
    expect(todayView(e, day(2)).underspend?.unspentMinor).toBe(900_000);
  });

  it("the verdict compares the speed with the spread allowance, not the added-to-today one", () => {
    const lastSpeed = { totalMinor: 10_000_000, days: 10 }; // Rs 10,000 a day
    const spends = [spend(400_000, day(1))];
    const today = todayView(cycle(spends, [{ dayOn: day(2), choice: "today" }], { lastSpeed }), day(2));
    // Rs 10,000 is above 90% of the spread Rs 10,666 and the money lasts: Tight.
    expect(today.verdict).toEqual({ kind: "tight" });
  });

  it("Spread answers everywhere give the same allowances as no answers (property)", () => {
    fc.assert(
      fc.property(
        fc.array(fc.tuple(fc.integer({ min: 1, max: 9 }), fc.integer({ min: 1, max: 2_000_000 }))),
        (raw) => {
          const spends = raw.map(([d, m]) => spend(m * 100, day(d)));
          const spreads = Array.from({ length: 10 }, (_, i) => ({
            dayOn: day(i + 1),
            choice: "spread" as const,
          }));
          for (let d = 1; d <= 10; d++) {
            expect(todayView(cycle(spends, spreads), day(d)).allowanceMinor).toBe(
              todayView(cycle(spends), day(d)).allowanceMinor,
            );
          }
        },
      ),
      { seed: 20261115, numRuns: 300 },
    );
  });

  it("Add to today gives at most the unspent money more than Spread, and never changes free money (property)", () => {
    fc.assert(
      fc.property(
        fc.array(fc.tuple(fc.integer({ min: 1, max: 9 }), fc.integer({ min: 1, max: 2_000_000 }))),
        fc.integer({ min: 2, max: 9 }),
        (raw, d) => {
          const spends = raw.map(([sd, m]) => spend(m * 100, day(sd)));
          const asked = todayView(cycle(spends), day(d));
          const added = todayView(cycle(spends, [{ dayOn: day(d), choice: "today" }]), day(d));
          expect(added.freeMinor).toBe(asked.freeMinor);
          if (!asked.underspend) {
            expect(added.allowanceMinor).toBe(asked.allowanceMinor);
            return;
          }
          expect(added.allowanceMinor).toBe(asked.underspend.todayMinor);
          expect(added.allowanceMinor).toBeGreaterThanOrEqual(asked.allowanceMinor);
          expect(added.allowanceMinor - asked.allowanceMinor).toBeLessThanOrEqual(
            asked.underspend.unspentMinor,
          );
        },
      ),
      { seed: 20261115, numRuns: 300 },
    );
  });
});
