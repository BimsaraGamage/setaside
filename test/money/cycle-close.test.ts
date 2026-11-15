import fc from "fast-check";
import { describe, expect, it } from "vitest";
import {
  broughtIn,
  type CloseInput,
  type ClosingEntries,
  type CommitmentEntry,
  checkCycleClose,
  type Leftover,
  leftoverOf,
  paidItOn,
  salaryDayGapMinor,
  salaryDayView,
  unpaidAtEnd,
} from "../../src/money";

// Item 12 · Salary day: closing the old cycle. Each case names the rule it checks (spec 3, 6).

const C = "LKR";
const EXPECTED = "2026-11-25";

/** A cycle from 1 Nov to salary 25 Nov: Rs 100,000 in, nothing else yet. */
const base = (more: Partial<ClosingEntries> = {}): ClosingEntries => ({
  spendingCurrency: C,
  startedOn: "2026-11-01",
  expectedSalaryOn: EXPECTED,
  incomes: [{ kind: "salary", currency: C, amountMinor: 10_000_000, toSavingsMinor: 0 }],
  spends: [],
  commitments: [],
  pots: [],
  ...more,
});

const bill = (id: string, plannedMinor: number, dueOn: string, more: Partial<CommitmentEntry> = {}) => ({
  id,
  name: id,
  currency: C,
  plannedMinor,
  dueOn,
  state: "open" as const,
  ...more,
});

describe("step 3 lists last cycle's unpaid commitments (spec 3: unpaid at cycle end)", () => {
  it("open ones due by the expected salary day, late ones too; not coming-up, finished or carried ones", () => {
    const list = [
      bill("rent", 3_000_000, "2026-11-05"),
      bill("phone", 200_000, EXPECTED),
      bill("next", 100_000, "2026-11-28"),
      bill("done", 100_000, "2026-11-10", { state: "finished" }),
      bill("gone", 100_000, "2026-11-10", { state: "carried" }),
    ];
    expect(unpaidAtEnd(list, EXPECTED).map((c) => c.id)).toEqual(["rent", "phone"]);
  });
});

describe("the leftover (spec 6: free money left + unused pot money + dropped commitments)", () => {
  it("an overspend in step 2 is decided before drops: dropped money still reaches the new cycle", () => {
    expect(
      checkCycleClose(close({ overspend: "take" }), { unpaidIds: [], leftover: left(-100, 0, 500) }),
    ).toEqual([]);
  });

  it("is free money left plus what is left in pots in use", () => {
    const entries = base({
      spends: [
        { spentOn: "2026-11-03", currency: C, amountMinor: 1_000_000 },
        { spentOn: "2026-11-04", currency: C, amountMinor: 300_000, potId: "food" },
      ],
      pots: [
        { id: "food", currency: C, amountMinor: 2_000_000, archived: false },
        { id: "fuel", currency: C, amountMinor: 500_000, archived: true },
      ],
    });
    const l = leftoverOf(entries, []);
    // 100,000 − food 20,000 − spent 10,000 = 70,000 free; food has 17,000 left; fuel is stopped.
    expect(l).toEqual<Leftover>({
      freeMinor: 7_000_000,
      potsMinor: 1_700_000,
      droppedMinor: 0,
      carriedMinor: 0,
      stepTwoMinor: 8_700_000,
      leftoverMinor: 8_700_000,
    });
  });

  it("a used-up pot leaves nothing; its spends past the amount already came out of free money", () => {
    const entries = base({
      spends: [{ spentOn: "2026-11-04", currency: C, amountMinor: 2_500_000, potId: "food" }],
      pots: [{ id: "food", currency: C, amountMinor: 2_000_000, archived: false }],
    });
    expect(leftoverOf(entries, []).potsMinor).toBe(0);
    expect(leftoverOf(entries, []).leftoverMinor).toBe(7_500_000);
  });

  it("a dropped commitment's still to pay joins the leftover; a carried one's goes with it", () => {
    const entries = base({
      commitments: [
        bill("rent", 3_000_000, "2026-11-05", {
          payments: [{ amountMinor: 1_000_000, currency: C, paidOn: "2026-11-05" }],
        }),
        bill("gym", 500_000, "2026-11-20"),
        bill("phone", 200_000, "2026-11-21"),
      ],
    });
    const l = leftoverOf(entries, [
      { id: "rent", choice: "carry" },
      { id: "gym", choice: "drop" },
      { id: "phone", choice: "paid" },
    ]);
    // 100,000 − 30,000 rent (10,000 paid + 20,000 still set aside) − 5,000 − 2,000 = 63,000 free.
    expect(l).toEqual<Leftover>({
      freeMinor: 6_300_000,
      potsMinor: 0,
      droppedMinor: 500_000,
      carriedMinor: 2_000_000,
      stepTwoMinor: 6_300_000,
      leftoverMinor: 6_800_000,
    });
  });

  it("below zero is an overspend", () => {
    const entries = base({ spends: [{ spentOn: "2026-11-03", currency: C, amountMinor: 10_400_000 }] });
    expect(leftoverOf(entries, []).leftoverMinor).toBe(-400_000);
  });

  it("whatever the choices, leftover + carried = free money + pots + every unpaid one's still to pay", () => {
    const choice = fc.constantFrom("paid" as const, "carry" as const, "drop" as const);
    fc.assert(
      fc.property(
        fc.array(fc.tuple(fc.integer({ min: 1, max: 5_000_000 }), choice), { maxLength: 6 }),
        fc.integer({ min: 0, max: 20_000_000 }),
        (rows, spent) => {
          const commitments = rows.map(([m], i) => bill(`c${i}`, m, "2026-11-10"));
          const entries = base({
            commitments,
            spends: [{ spentOn: "2026-11-02", currency: C, amountMinor: spent }],
          });
          const l = leftoverOf(
            entries,
            rows.map(([, c], i) => ({ id: `c${i}`, choice: c })),
          );
          const owed = rows.reduce((t, [m]) => t + m, 0);
          const paid = rows.reduce((t, [m, c]) => t + (c === "paid" ? m : 0), 0);
          return l.leftoverMinor + l.carriedMinor === l.freeMinor + l.potsMinor + owed - paid;
        },
      ),
      { seed: 20261115 },
    );
  });
});

describe("Paid it is dated in the old cycle (spec 2: ended cycles are locked)", () => {
  it("on its due day, or the old cycle's last day when the salary came first", () => {
    expect(paidItOn("2026-11-10", "2026-11-01", "2026-11-25")).toBe("2026-11-10");
    expect(paidItOn("2026-11-25", "2026-11-01", "2026-11-22")).toBe("2026-11-21");
    expect(paidItOn("2026-10-20", "2026-11-01", "2026-11-25")).toBe("2026-11-01");
    expect(paidItOn("2026-11-10", "2026-11-01", "2026-11-01")).toBe("2026-11-01");
  });
});

const left = (stepTwoMinor: number, carriedMinor = 0, droppedMinor = 0): Leftover => ({
  freeMinor: stepTwoMinor,
  potsMinor: 0,
  droppedMinor,
  carriedMinor,
  stepTwoMinor,
  leftoverMinor: stepTwoMinor + droppedMinor,
});

const close = (more: Partial<CloseInput> = {}): CloseInput => ({
  unpaid: [],
  inHandMinor: null,
  toSavingsMinor: 0,
  overspend: null,
  ...more,
});

describe("checks on the closing choices (spec 6 steps 2 and 3)", () => {
  it("every unpaid commitment gets one choice, and only those", () => {
    const ctx = { unpaidIds: ["a", "b"], leftover: left(1_000) };
    expect(checkCycleClose(close({ unpaid: [{ id: "a", choice: "paid" }] }), ctx)).toEqual(["unpaid"]);
    expect(
      checkCycleClose(
        close({
          unpaid: [
            { id: "a", choice: "paid" },
            { id: "a", choice: "drop" },
          ],
        }),
        ctx,
      ),
    ).toEqual(["unpaid"]);
    expect(
      checkCycleClose(
        close({
          unpaid: [
            { id: "a", choice: "paid" },
            { id: "b", choice: "drop" },
            { id: "x", choice: "drop" },
          ],
        }),
        ctx,
      ),
    ).toEqual(["unpaid"]);
    expect(
      checkCycleClose(
        close({
          unpaid: [
            { id: "b", choice: "carry" },
            { id: "a", choice: "drop" },
          ],
        }),
        ctx,
      ),
    ).toEqual([]);
  });

  it("a leftover: the amount in hand is zero or more, savings at most that", () => {
    const ctx = { unpaidIds: [], leftover: left(1_000_000) };
    expect(checkCycleClose(close({ inHandMinor: -1 }), ctx)).toEqual(["in_hand"]);
    expect(checkCycleClose(close({ toSavingsMinor: 1_000_001 }), ctx)).toEqual(["to_savings"]);
    expect(checkCycleClose(close({ inHandMinor: 500_000, toSavingsMinor: 600_000 }), ctx)).toEqual([
      "to_savings",
    ]);
    expect(checkCycleClose(close({ toSavingsMinor: -1 }), ctx)).toEqual(["to_savings"]);
    expect(checkCycleClose(close({ inHandMinor: 1_200_000, toSavingsMinor: 1_200_000 }), ctx)).toEqual([]);
    expect(checkCycleClose(close({ overspend: "take" }), ctx)).toEqual(["overspend"]);
  });

  it("an overspend: take or ignore must be chosen; nothing to correct or save", () => {
    const ctx = { unpaidIds: [], leftover: left(-5_000) };
    expect(checkCycleClose(close(), ctx)).toEqual(["overspend"]);
    expect(checkCycleClose(close({ overspend: "ignore" }), ctx)).toEqual([]);
    expect(checkCycleClose(close({ overspend: "take", toSavingsMinor: 1 }), ctx)).toEqual(["to_savings"]);
    expect(checkCycleClose(close({ overspend: "take", inHandMinor: 0 }), ctx)).toEqual(["in_hand"]);
  });
});

describe("what the old cycle brings into the new one (spec 6)", () => {
  it("step 2's amount split into savings and the new cycle, plus dropped and carried ones' money", () => {
    expect(broughtIn(close({ toSavingsMinor: 300_000 }), left(1_000_000, 200_000, 50_000))).toEqual({
      amountMinor: 1_250_000,
      toSavingsMinor: 300_000,
      correctionMinor: 0,
    });
  });

  it("the amount actually in hand replaces step 2's amount; the gap is the correction", () => {
    expect(broughtIn(close({ inHandMinor: 700_000 }), left(1_000_000, 0, 50_000))).toEqual({
      amountMinor: 750_000,
      toSavingsMinor: 0,
      correctionMinor: -300_000,
    });
  });

  it("an overspend taken from the new cycle lowers its free money; ignored, it doesn't", () => {
    expect(broughtIn(close({ overspend: "take" }), left(-400_000, 100_000))).toEqual({
      amountMinor: -300_000,
      toSavingsMinor: 0,
      correctionMinor: 0,
    });
    expect(broughtIn(close({ overspend: "ignore" }), left(-400_000, 100_000, 50_000)).amountMinor).toBe(
      150_000,
    );
  });
});

describe("the summary counts what the old cycle brings in (spec 6 step 7)", () => {
  const input = {
    salaryMinor: 10_000_000,
    receivedOn: "2026-11-25",
    expectedSalaryOn: "2026-12-25",
    commitments: [{ name: "Rent", plannedMinor: 3_000_000, dueOn: "2026-12-01" }],
    pots: [],
  };

  it("new free money = salary + leftover kept − set-asides; a carried one costs nothing", () => {
    const v = salaryDayView({
      input,
      spendingCurrency: C,
      today: "2026-11-25",
      lastSpeed: null,
      broughtIn: { amountMinor: 1_200_000, toSavingsMinor: 200_000 },
      carried: [{ currency: C, plannedMinor: 200_000, dueOn: "2026-11-20", state: "open" }],
    });
    // 100,000 + 8,000 kept (10,000 less 2,000 saved) + 2,000 carried − 30,000 rent − 2,000 late = 78,000.
    expect(v.today.freeMinor).toBe(7_800_000);
  });

  it("the gap compares set-asides with the salary plus the money brought in", () => {
    expect(
      salaryDayGapMinor({
        salaryMinor: 1_000_000,
        expectedSalaryOn: EXPECTED,
        currency: C,
        commitments: [bill("rent", 1_500_000, "2026-11-10")],
        pots: [],
        broughtInMinor: 300_000,
      }),
    ).toBe(200_000);
  });
});
