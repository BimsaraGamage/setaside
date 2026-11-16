import { describe, expect, it } from "vitest";
import {
  type CloseEntry,
  type CommitmentEntry,
  commitmentEnding,
  endedOn,
  howItEnded,
  type PastEntries,
  pastCycleView,
  totalsByCurrency,
} from "../../src/money";

// Item 21 · Past cycles (spec 10): the list and one ended cycle, read only.

const C = "LKR";
const D = "USD";

const close = (more: Partial<CloseEntry> = {}): CloseEntry => ({
  currency: C,
  leftoverMinor: 0,
  correctionMinor: 0,
  toSavingsMinor: 0,
  overspendChoice: null,
  ...more,
});

describe("an ended cycle's dates", () => {
  it("ends the day before the next cycle started", () => {
    expect(endedOn("2026-11-01", "2026-12-01")).toBe("2026-11-30");
    expect(endedOn("2027-02-01", "2027-03-01")).toBe("2027-02-28");
  });

  it("a cycle ended the day it started lasted that one day", () => {
    expect(endedOn("2026-11-16", "2026-11-16")).toBe("2026-11-16");
  });
});

describe("totals by currency (salary, spent)", () => {
  it("adds each currency's rows, the spending currency first, none for a currency with nothing", () => {
    expect(
      totalsByCurrency(
        [
          { currency: D, amountMinor: 1_000 },
          { currency: C, amountMinor: 500 },
          { currency: C, amountMinor: 700 },
          { currency: D, amountMinor: -1_000 },
        ],
        C,
      ),
    ).toEqual([{ currency: C, minor: 1_200 }]);
    expect(totalsByCurrency([{ currency: D, amountMinor: 300 }], C)).toEqual([{ currency: D, minor: 300 }]);
    expect(totalsByCurrency([], C)).toEqual([]);
  });
});

describe("how it ended (spec 6: the leftover and its split, or the overspend)", () => {
  it("a leftover kept as worked out: what went to savings and to the new cycle", () => {
    expect(howItEnded([close({ leftoverMinor: 5_000_000, toSavingsMinor: 2_000_000 })], C)).toEqual([
      {
        currency: C,
        kind: "leftover",
        leftoverMinor: 5_000_000,
        inHandMinor: 5_000_000,
        toSavingsMinor: 2_000_000,
        toNewCycleMinor: 3_000_000,
      },
    ]);
  });

  it("a corrected leftover: what was actually in hand is what was split", () => {
    const [e] = howItEnded([close({ leftoverMinor: 5_000_000, correctionMinor: -1_000_000 })], C);
    expect(e).toMatchObject({ kind: "leftover", leftoverMinor: 5_000_000, inHandMinor: 4_000_000 });
    expect(e).toMatchObject({ toNewCycleMinor: 4_000_000 });
  });

  it("an overspend: how far over and whether it was taken from the new cycle or ignored", () => {
    expect(howItEnded([close({ leftoverMinor: -300_000, overspendChoice: "take" })], C)).toEqual([
      { currency: C, kind: "overspend", overMinor: 300_000, choice: "take" },
    ]);
    expect(howItEnded([close({ leftoverMinor: -300_000, overspendChoice: "ignore" })], C)).toEqual([
      { currency: C, kind: "overspend", overMinor: 300_000, choice: "ignore" },
    ]);
  });

  it("dollars below zero carry over whole (spec 6, two currencies): taken from the new cycle", () => {
    expect(howItEnded([close({ currency: D, leftoverMinor: -2_500 })], C)).toEqual([
      { currency: D, kind: "overspend", overMinor: 2_500, choice: "take" },
    ]);
  });

  it("two currencies: the spending currency first", () => {
    const list = howItEnded([close({ currency: D, leftoverMinor: 10_000 }), close({ leftoverMinor: 1 })], C);
    expect(list.map((e) => e.currency)).toEqual([C, D]);
  });

  it("a cycle closed before the leftover was kept: only what is stored", () => {
    expect(howItEnded([close({ leftoverMinor: null, toSavingsMinor: 100 })], C)).toEqual([
      {
        currency: C,
        kind: "leftover",
        leftoverMinor: null,
        inHandMinor: null,
        toSavingsMinor: 100,
        toNewCycleMinor: null,
      },
    ]);
    expect(howItEnded([close({ leftoverMinor: null, overspendChoice: "ignore" })], C)).toEqual([
      { currency: C, kind: "overspend", overMinor: null, choice: "ignore" },
    ]);
  });
});

describe("a commitment at the end of its cycle (planned vs paid, carried)", () => {
  const k = (more: Partial<CommitmentEntry> = {}): CommitmentEntry => ({
    dueOn: "2026-11-10",
    currency: C,
    plannedMinor: 1_000_000,
    state: "finished",
    payments: [{ amountMinor: 1_000_000, currency: C, paidOn: "2026-11-10" }],
    ...more,
  });

  it("paid in full", () => {
    expect(commitmentEnding(k())).toEqual({ kind: "paid", paidMinor: 1_000_000, restMinor: 0 });
  });

  it("finished with less paid (Mark finished)", () => {
    expect(
      commitmentEnding(k({ payments: [{ amountMinor: 600_000, currency: C, paidOn: "2026-11-10" }] })),
    ).toEqual({ kind: "finished", paidMinor: 600_000, restMinor: 400_000 });
  });

  it("carried: what was still to pay went to the next cycle", () => {
    expect(
      commitmentEnding(
        k({ state: "carried", payments: [{ amountMinor: 250_000, currency: C, paidOn: "2026-11-10" }] }),
      ),
    ).toEqual({ kind: "carried", paidMinor: 250_000, restMinor: 750_000 });
  });

  it("dropped", () => {
    expect(commitmentEnding(k({ state: "dropped", payments: [] }))).toEqual({
      kind: "dropped",
      paidMinor: 0,
      restMinor: 1_000_000,
    });
  });

  it("left open (a cycle closed before step 2 existed): unpaid", () => {
    expect(commitmentEnding(k({ state: "open", payments: [] }))).toEqual({
      kind: "unpaid",
      paidMinor: 0,
      restMinor: 1_000_000,
    });
  });

  it("paid in the other currency counts what it covered when saved (spec 8)", () => {
    expect(
      commitmentEnding(
        k({ payments: [{ amountMinor: 3_000, currency: D, coversMinor: 1_000_000, paidOn: "2026-11-10" }] }),
      ),
    ).toMatchObject({ kind: "paid", paidMinor: 1_000_000 });
  });
});

describe("one ended cycle (spec 10)", () => {
  const entries = (more: Partial<PastEntries> = {}): PastEntries => ({
    spendingCurrency: C,
    startedOn: "2026-11-01",
    nextStartedOn: "2026-11-11",
    incomes: [
      { kind: "salary", currency: C, amountMinor: 20_000_000, toSavingsMinor: 0 },
      { kind: "leftover", currency: C, amountMinor: 500_000, toSavingsMinor: 0 },
    ],
    spends: [
      { id: "a", spentOn: "2026-11-02", currency: C, amountMinor: 100_000 },
      { id: "b", spentOn: "2026-11-02", currency: C, amountMinor: 50_000, potId: "fuel" },
      { id: "c", spentOn: "2026-11-05", currency: C, amountMinor: 900_000, oneOff: true },
      { id: "d", spentOn: "2026-11-09", currency: D, amountMinor: 1_200, potId: "trip" },
    ],
    pots: [
      { id: "fuel", name: "Fuel", currency: C, amountMinor: 40_000, archived: false },
      { id: "trip", name: "Trip", currency: D, amountMinor: 5_000, archived: false },
    ],
    commitments: [],
    closes: [close({ leftoverMinor: 1_000 })],
    ...more,
  });

  it("dates, salary and spent per currency", () => {
    const v = pastCycleView(entries());
    expect(v.endedOn).toBe("2026-11-10");
    expect(v.days).toBe(10);
    expect(v.salary).toEqual([{ currency: C, minor: 20_000_000 }]);
    expect(v.opening).toEqual([]);
    expect(v.spent).toEqual([
      { currency: C, minor: 1_050_000 },
      { currency: D, minor: 1_200 },
    ]);
  });

  it("the very first cycle has no salary: what it started with", () => {
    const v = pastCycleView(
      entries({ incomes: [{ kind: "opening", currency: C, amountMinor: 9_000_000, toSavingsMinor: 0 }] }),
    );
    expect(v.salary).toEqual([]);
    expect(v.opening).toEqual([{ currency: C, minor: 9_000_000 }]);
  });

  it("average a day is the cycle's spending speed over its whole length (spec 7)", () => {
    // Rs 1,000 (a) + Rs 100 past the empty Fuel pot; the one-off is left out; 10 days.
    const v = pastCycleView(entries());
    expect(v.speed).toEqual({ totalMinor: 110_000, days: 10 });
    expect(v.perDayMinor).toBe(11_000);
  });

  it("pots with what was spent, left or over", () => {
    const v = pastCycleView(entries());
    expect(v.pots.map((p) => [p.name, p.spentMinor, p.leftMinor, p.overMinor])).toEqual([
      ["Fuel", 50_000, 0, 10_000],
      ["Trip", 1_200, 3_800, 0],
    ]);
  });

  it("spends by day, newest first, with each day's total in the spending currency", () => {
    const v = pastCycleView(entries());
    expect(v.spendDays.map((d) => [d.day, d.totalMinor, d.spends.map((s) => s.id)])).toEqual([
      ["2026-11-09", 0, ["d"]],
      ["2026-11-05", 900_000, ["c"]],
      ["2026-11-02", 150_000, ["a", "b"]],
    ]);
  });

  it("commitments with planned vs paid, in due order", () => {
    const v = pastCycleView(
      entries({
        commitments: [
          {
            name: "Rent",
            dueOn: "2026-11-05",
            currency: C,
            plannedMinor: 100,
            state: "carried",
            payments: [],
          },
          { name: "Gym", dueOn: "2026-11-03", currency: C, plannedMinor: 50, state: "dropped", payments: [] },
        ],
      }),
    );
    expect(v.commitments.map((k) => [k.name, k.ending.kind, k.ending.restMinor])).toEqual([
      ["Gym", "dropped", 50],
      ["Rent", "carried", 100],
    ]);
  });

  it("how it ended", () => {
    expect(pastCycleView(entries()).ending).toMatchObject([{ kind: "leftover", leftoverMinor: 1_000 }]);
  });
});
