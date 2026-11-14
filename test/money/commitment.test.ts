import fc from "fast-check";
import { describe, expect, it } from "vitest";
import {
  addDays,
  type CommitmentEntry,
  type CycleEntries,
  checkCommitment,
  freeMoney,
  inThisCycle,
  nextUp,
  type SpendEntry,
  setAsideMinor,
  todayView,
} from "../../src/money";

// Item 5 · Commitments and Next up. Each case names the rule it checks (spec 16).

const opening = (amountMinor: number) => ({
  kind: "opening" as const,
  currency: "LKR",
  amountMinor,
  toSavingsMinor: 0,
});
const bill = (name: string, dueOn: string, plannedMinor: number): CommitmentEntry & { name: string } => ({
  name,
  dueOn,
  currency: "LKR",
  plannedMinor,
  state: "open",
});

const SALARY = "2026-11-30";

/** Rs 90,000 held, salary expected 30 Nov: on 12 Nov that is 18 days of Rs 5,000. */
function cycle(commitments: CommitmentEntry[], spends: SpendEntry[] = [], held = 9_000_000): CycleEntries {
  return {
    spendingCurrency: "LKR",
    expectedSalaryOn: SALARY,
    incomes: [opening(held)],
    spends,
    commitments,
  };
}

describe("a commitment is set aside (spec 1, 3)", () => {
  it("lowers free money by its planned amount", () => {
    const e = cycle([bill("Rent", "2026-11-20", 3_600_000)]);
    expect(freeMoney(e)).toBe(5_400_000);
    expect(setAsideMinor(e.commitments ?? [], SALARY, "LKR")).toBe(3_600_000);
  });

  it("changes today's allowance at once, even though it is added during the day", () => {
    // Rs 54,000 over 18 days = Rs 3,000; spends today still show against it.
    const view = todayView(cycle([bill("Rent", "2026-11-20", 3_600_000)]), "2026-11-12");
    expect(view.allowanceMinor).toBe(300_000);
    expect(view.freeMinor).toBe(5_400_000);
  });

  it("an edited amount or date recalculates at once; a deleted one gives its money back", () => {
    expect(todayView(cycle([bill("Rent", "2026-11-20", 1_800_000)]), "2026-11-12").allowanceMinor).toBe(
      400_000,
    );
    expect(todayView(cycle([bill("Rent", "2026-12-02", 1_800_000)]), "2026-11-12").allowanceMinor).toBe(
      500_000,
    );
    expect(todayView(cycle([]), "2026-11-12").allowanceMinor).toBe(500_000);
  });

  it("due on the expected salary day still belongs to this cycle; due after it does not", () => {
    expect(inThisCycle("2026-11-30", SALARY)).toBe(true);
    expect(inThisCycle("2026-12-01", SALARY)).toBe(false);
    const e = cycle([bill("Phone", "2026-11-30", 100_000), bill("Rent", "2026-12-01", 3_600_000)]);
    expect(freeMoney(e)).toBe(8_900_000);
  });

  it("a late one (due before today, still open) stays set aside", () => {
    const e = cycle([bill("Water", "2026-11-12", 200_000)]);
    expect(todayView(e, "2026-11-14").freeMinor).toBe(8_800_000);
  });

  it("only open ones are set aside (finished, carried and dropped come with items 6 and 12)", () => {
    const e = cycle([
      { ...bill("A", "2026-11-20", 100_000), state: "finished" },
      { ...bill("B", "2026-11-20", 100_000), state: "carried" },
      { ...bill("C", "2026-11-20", 100_000), state: "dropped" },
    ]);
    expect(freeMoney(e)).toBe(9_000_000);
  });

  it("leaves out commitments in another currency (two currencies come with item 15)", () => {
    const e = cycle([{ ...bill("Netflix", "2026-11-20", 1_500), currency: "USD" }]);
    expect(freeMoney(e)).toBe(9_000_000);
  });

  it("can push free money below zero: today shows 0", () => {
    const view = todayView(cycle([bill("Rent", "2026-11-20", 10_000_000)]), "2026-11-12");
    expect(view.freeMinor).toBe(-1_000_000);
    expect(view.allowanceMinor).toBe(0);
  });
});

describe("Next up · already set aside (spec 10)", () => {
  const list = [
    bill("Rent", "2026-11-20", 3_600_000),
    bill("Water", "2026-11-13", 200_000),
    bill("Electricity", "2026-11-20", 450_000),
    bill("Insurance", "2026-12-05", 1_000_000),
    bill("Gym", "2026-11-10", 500_000),
  ];

  it("lists open commitments by due date with 'in N days', and the total set aside", () => {
    const up = nextUp(list, "2026-11-12", SALARY, "LKR");
    expect(up.items.map((i) => [i.commitment.name, i.inDays])).toEqual([
      ["Gym", -2],
      ["Water", 1],
      ["Electricity", 8],
      ["Rent", 8],
    ]);
    expect(up.totalMinor).toBe(4_750_000);
    expect(up.salaryInDays).toBe(18);
  });

  it("shows ones due after the expected salary day as coming up only, outside the total", () => {
    const up = nextUp(list, "2026-11-12", SALARY, "LKR");
    expect(up.comingUp.map((i) => [i.commitment.name, i.inDays])).toEqual([["Insurance", 23]]);
  });

  it("leaves out ones no longer open", () => {
    const up = nextUp([{ ...list[0]!, state: "finished" }], "2026-11-12", SALARY, "LKR");
    expect(up.items).toEqual([]);
    expect(up.totalMinor).toBe(0);
  });

  it("its total is what free money is lowered by", () => {
    const e = cycle(list);
    expect(nextUp(list, "2026-11-12", SALARY, "LKR").totalMinor).toBe(9_000_000 - freeMoney(e));
  });
});

describe("a commitment is checked before it is saved (spec 3)", () => {
  const ctx = { cycleStartedOn: "2026-11-12", spendingCurrency: "LKR" };
  const ok = { name: "Rent", plannedMinor: 3_600_000, dueOn: "2026-11-20", currency: "LKR" };

  it("accepts a name, a whole positive amount and a due day in this cycle or later", () => {
    expect(checkCommitment(ok, ctx)).toEqual([]);
    expect(checkCommitment({ ...ok, dueOn: "2026-11-12" }, ctx)).toEqual([]);
    expect(checkCommitment({ ...ok, dueOn: "2027-01-05" }, ctx)).toEqual([]);
  });

  it("needs a name of at most 80 letters", () => {
    expect(checkCommitment({ ...ok, name: "" }, ctx)).toEqual(["name"]);
    expect(checkCommitment({ ...ok, name: "   " }, ctx)).toEqual(["name"]);
    expect(checkCommitment({ ...ok, name: "x".repeat(80) }, ctx)).toEqual([]);
    expect(checkCommitment({ ...ok, name: "x".repeat(81) }, ctx)).toEqual(["name"]);
  });

  it("needs a whole amount above zero in the spending currency", () => {
    expect(checkCommitment({ ...ok, plannedMinor: 0 }, ctx)).toEqual(["amount"]);
    expect(checkCommitment({ ...ok, plannedMinor: -1 }, ctx)).toEqual(["amount"]);
    expect(checkCommitment({ ...ok, plannedMinor: 2.5 }, ctx)).toEqual(["amount"]);
    expect(checkCommitment({ ...ok, currency: "USD" }, ctx)).toEqual(["currency"]);
  });

  it("can't be due before the cycle started, and needs a real day", () => {
    expect(checkCommitment({ ...ok, dueOn: "2026-11-11" }, ctx)).toEqual(["due_on"]);
    expect(checkCommitment({ ...ok, dueOn: "2026-02-30" }, ctx)).toEqual(["due_on"]);
  });
});

describe("random commitments and spends: totals always add up (spec 16)", () => {
  const start = "2026-11-12";
  const arb = fc.record({
    held: fc.integer({ min: 0, max: 50_000_000 }),
    commitments: fc.array(
      fc.record({
        day: fc.integer({ min: 0, max: 40 }),
        amount: fc.integer({ min: 1, max: 5_000_000 }),
        open: fc.boolean(),
      }),
      { maxLength: 20 },
    ),
    spends: fc.array(
      fc.record({ day: fc.integer({ min: 0, max: 17 }), amount: fc.integer({ min: 1, max: 1_000_000 }) }),
      { maxLength: 30 },
    ),
    today: fc.integer({ min: 0, max: 17 }),
  });

  it("free money + set aside = income − spends, and Next up's total is the set-aside", () => {
    fc.assert(
      fc.property(arb, ({ held, commitments, spends, today: t }) => {
        const today = addDays(start, t);
        const cs = commitments.map((c, n): CommitmentEntry & { name: string } => ({
          ...bill(`c${n}`, addDays(start, c.day), c.amount),
          state: c.open ? "open" : "finished",
        }));
        const ss = spends.map((s) => ({
          spentOn: addDays(start, Math.min(s.day, t)),
          currency: "LKR",
          amountMinor: s.amount,
        }));
        const e = cycle(cs, ss, held);
        const spent = ss.reduce((n, s) => n + s.amountMinor, 0);
        const up = nextUp(cs, today, SALARY, "LKR");
        expect(freeMoney(e) + up.totalMinor).toBe(held - spent);
        expect(setAsideMinor(cs, SALARY, "LKR")).toBe(up.totalMinor);
        // Every open commitment is in exactly one of the two lists.
        expect(up.items.length + up.comingUp.length).toBe(cs.filter((c) => c.state === "open").length);
        // Commitments count at once: the start of today already has them.
        expect(freeMoney(e, today) - freeMoney(e)).toBe(
          ss.filter((s) => s.spentOn === today).reduce((n, s) => n + s.amountMinor, 0),
        );
      }),
      { numRuns: 2000, seed: 20261114 },
    );
  });
});
