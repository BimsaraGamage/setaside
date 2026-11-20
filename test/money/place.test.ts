import { describe, expect, it } from "vitest";
import {
  appCountsMinor,
  type CardEntry,
  type CycleEntries,
  checkPlace,
  freeHeldMinor,
  freeMoney,
  isPlaceBalance,
  type PlaceEntry,
  placesView,
} from "../../src/money";

// Places (spec 6 "Where my money is", ticket SAB-50). Each case names the rule it checks (spec 16).

const SALARY = "2026-12-25";

/** Rs 100,000 held, Rs 30,000 rent set aside, a Rs 10,000 pot with Rs 4,000 spent: free money Rs 60,000. */
const one: CycleEntries = {
  spendingCurrency: "LKR",
  startedOn: "2026-11-25",
  expectedSalaryOn: SALARY,
  incomes: [
    {
      kind: "opening",
      currency: "LKR",
      amountMinor: 10_000_000,
      toSavingsMinor: 0,
      receivedOn: "2026-11-25",
    },
  ],
  commitments: [{ dueOn: "2026-12-20", currency: "LKR", plannedMinor: 3_000_000, state: "open" }],
  pots: [{ id: "food", currency: "LKR", amountMinor: 1_000_000, archived: false }],
  spends: [{ spentOn: "2026-11-26", currency: "LKR", amountMinor: 400_000, potId: "food" }],
};

/** $1,000 and Rs 10,000 held, Rs 300 a dollar. */
const two: CycleEntries = {
  spendingCurrency: "LKR",
  salaryCurrency: "USD",
  countingRate: "300",
  reserveRate: "300",
  startedOn: "2026-11-25",
  expectedSalaryOn: SALARY,
  incomes: [
    { kind: "salary", currency: "USD", amountMinor: 100_000, toSavingsMinor: 0, receivedOn: "2026-11-25" },
    { kind: "opening", currency: "LKR", amountMinor: 1_000_000, toSavingsMinor: 0, receivedOn: "2026-11-25" },
  ],
  spends: [],
};

const place = (
  id: string,
  balanceMinor: number | null,
  more: Partial<PlaceEntry> = {},
): PlaceEntry & { name: string } => ({
  id,
  name: id,
  currency: "LKR",
  kind: "spending",
  archived: false,
  balanceMinor,
  ...more,
});

const view = (places: PlaceEntry[], entries = one, more: { savings?: never[]; cards?: CardEntry[] } = {}) =>
  placesView(places, { entries, savings: more.savings ?? [], cards: more.cards ?? [] });

describe("a place (spec 6)", () => {
  it("needs a name, one of the user's currencies and a kind", () => {
    const ctx = { spendingCurrency: "LKR", salaryCurrency: "USD" };
    expect(checkPlace({ name: "Pan Asia Bank", currency: "LKR", kind: "spending" }, ctx)).toEqual([]);
    expect(checkPlace({ name: "Dollar account", currency: "USD", kind: "kept" }, ctx)).toEqual([]);
    expect(checkPlace({ name: "  ", currency: "LKR", kind: "spending" }, ctx)).toEqual(["name"]);
    expect(checkPlace({ name: "x".repeat(41), currency: "LKR", kind: "spending" }, ctx)).toEqual(["name"]);
    expect(checkPlace({ name: "Euro", currency: "EUR", kind: "spending" }, ctx)).toEqual(["currency"]);
    expect(checkPlace({ name: "Safe", currency: "LKR", kind: "vault" }, ctx)).toEqual(["kind"]);
  });

  it("holds a balance of zero or more, in whole minor units", () => {
    expect(isPlaceBalance(0)).toBe(true);
    expect(isPlaceBalance(4_800_000)).toBe(true);
    expect(isPlaceBalance(-1)).toBe(false);
    expect(isPlaceBalance(10.5)).toBe(false);
    expect(isPlaceBalance(Number.NaN)).toBe(false);
  });
});

describe("what the app counts in one currency (spec 6)", () => {
  it("is free money + still set aside + what is left in the pots", () => {
    // 60,000 free + 30,000 rent + 6,000 left in the pot: the Rs 96,000 actually still held.
    expect(appCountsMinor({ entries: one, savings: [], cards: [] }, "LKR")).toBe(9_600_000);
  });

  it("adds savings and the money held for card balances", () => {
    const entries: CycleEntries = {
      ...one,
      spends: [
        ...one.spends,
        { spentOn: "2026-11-27", currency: "LKR", amountMinor: 500_000, cardId: "visa" },
      ],
    };
    const cards: CardEntry[] = [{ id: "visa", currency: "LKR", archived: false, earlierMinor: 200_000 }];
    const savings = [{ currency: "LKR", amountMinor: 2_500_000 }];
    // The card spend is out of free money but still in the bank: 55,000 + 30,000 + 6,000 + 7,000 held + 25,000 saved.
    expect(appCountsMinor({ entries, savings, cards }, "LKR")).toBe(12_300_000);
  });

  it("counts each currency apart, a rupee shortfall too", () => {
    const entries: CycleEntries = {
      ...two,
      commitments: [{ dueOn: "2026-12-20", currency: "LKR", plannedMinor: 4_000_000, state: "open" }],
    };
    // Rs 10,000 are held (all of it, and more, set aside); the dollars are all still there.
    expect(appCountsMinor({ entries, savings: [], cards: [] }, "LKR")).toBe(1_000_000);
    expect(appCountsMinor({ entries, savings: [], cards: [] }, "USD")).toBe(100_000);
  });
});

describe("free money held in each currency (spec 6, 8)", () => {
  it("is free money itself with one currency", () => {
    expect(freeHeldMinor(one, "LKR")).toBe(freeMoney(one));
    expect(freeHeldMinor(one, "USD")).toBe(0);
  });

  it("is each currency's own free money while the rupees cover the rupee set-asides", () => {
    expect(freeHeldMinor(two, "LKR")).toBe(1_000_000);
    expect(freeHeldMinor(two, "USD")).toBe(100_000);
  });

  it("takes the dollars reserved for rupee set-asides out of the free dollars", () => {
    const entries: CycleEntries = {
      ...two,
      commitments: [{ dueOn: "2026-12-20", currency: "LKR", plannedMinor: 4_000_000, state: "open" }],
    };
    // Rs 30,000 short: $100 reserved at Rs 300; no rupees are free.
    expect(freeHeldMinor(entries, "LKR")).toBe(0);
    expect(freeHeldMinor(entries, "USD")).toBe(90_000);
    expect(freeMoney(entries)).toBe(27_000_000);
  });
});

describe("where my money is (spec 6)", () => {
  it("shows each place's balance and the total", () => {
    const v = view([place("Pan Asia", 4_800_000), place("In hand", 1_200_000)]);
    expect(v.lines.map((l) => [l.place.id, l.balanceMinor])).toEqual([
      ["Pan Asia", 4_800_000],
      ["In hand", 1_200_000],
    ]);
    expect(v.totals).toEqual([
      expect.objectContaining({ currency: "LKR", totalMinor: 6_000_000, appMinor: 9_600_000 }),
    ]);
    expect(v.totalCountedMinor).toBe(6_000_000);
  });

  it("shares free money out: For spending places first, in list order, each up to its balance", () => {
    // Free money Rs 60,000.
    const v = view([
      place("Kept", 5_000_000, { kind: "kept" }),
      place("In hand", 1_200_000),
      place("Pan Asia", 4_000_000),
    ]);
    const can = Object.fromEntries(v.lines.map((l) => [l.place.id, l.canSpendMinor]));
    expect(can).toEqual({ "In hand": 1_200_000, "Pan Asia": 4_000_000, Kept: 800_000 });
  });

  it("gives a place nothing once free money is shared out", () => {
    const v = view([place("In hand", 7_000_000), place("Pan Asia", 4_000_000)]);
    expect(v.lines.map((l) => l.canSpendMinor)).toEqual([6_000_000, 0]);
  });

  it("the parts add up to free money when the places hold what the app counts", () => {
    const v = view([place("In hand", 2_600_000), place("Bank", 7_000_000, { kind: "kept" })]);
    expect(v.lines.reduce((sum, l) => sum + l.canSpendMinor, 0)).toBe(freeMoney(one));
    expect(v.totals[0]?.differenceMinor).toBe(0);
  });

  it("shares nothing while free money is at zero or below", () => {
    const over: CycleEntries = {
      ...one,
      spends: [...one.spends, { spentOn: "2026-11-27", currency: "LKR", amountMinor: 7_000_000 }],
    };
    expect(view([place("In hand", 500_000)], over).lines[0]?.canSpendMinor).toBe(0);
  });

  it("says how far the places are from what the app counts", () => {
    // The app counts Rs 96,000.
    expect(view([place("Bank", 9_280_000)]).totals[0]?.differenceMinor).toBe(-320_000);
    expect(view([place("Bank", 10_000_000)]).totals[0]?.differenceMinor).toBe(400_000);
  });

  it("leaves the difference out while a place has no balance yet", () => {
    const v = view([place("Bank", 9_000_000), place("In hand", null)]);
    expect(v.lines[1]).toMatchObject({ balanceMinor: null, canSpendMinor: 0 });
    expect(v.totals[0]).toMatchObject({ totalMinor: 9_000_000, differenceMinor: null });
  });

  it("leaves places not in use out of everything but the list", () => {
    const v = view([place("Old bank", 5_000_000, { archived: true }), place("In hand", 1_000_000)]);
    expect(v.lines.map((l) => l.place.id)).toEqual(["In hand"]);
    expect(v.notInUse.map((p) => p.id)).toEqual(["Old bank"]);
    expect(v.totals[0]?.totalMinor).toBe(1_000_000);
  });

  it("is empty with no places", () => {
    expect(view([])).toEqual({ lines: [], notInUse: [], totals: [], totalCountedMinor: 0 });
  });
});

describe("a dollar place (spec 6, 8)", () => {
  const places = [place("In hand", 1_000_000), place("Dollar account", 42_033, { currency: "USD" })];

  it("shows its balance in rupees at the counting rate, rounded down", () => {
    const v = view(places, { ...two, countingRate: "302.57" });
    // $420.33 × 302.57 = Rs 127,179.2481.
    expect(v.lines[1]).toMatchObject({ balanceMinor: 42_033, countedMinor: 12_717_924 });
    expect(v.lines[0]?.countedMinor).toBeNull();
  });

  it("shows no rupees without a counting rate", () => {
    const v = view(places, { ...two, countingRate: null, reserveRate: null });
    expect(v.lines[1]).toMatchObject({
      balanceMinor: 42_033,
      countedMinor: null,
      canSpendCountedMinor: null,
    });
    expect(v.totalCountedMinor).toBe(1_000_000);
  });

  it("shares the free dollars among the dollar places, and counts them in rupees", () => {
    const v = view(places, two);
    // $1,000 free, $420.33 in the place: all of it can be spent.
    expect(v.lines[1]).toMatchObject({ canSpendMinor: 42_033, canSpendCountedMinor: 12_609_900 });
    expect(v.lines[0]).toMatchObject({ canSpendMinor: 1_000_000, canSpendCountedMinor: null });
  });

  it("holds back the dollars reserved for rupee set-asides", () => {
    const entries: CycleEntries = {
      ...two,
      incomes: [
        { kind: "salary", currency: "USD", amountMinor: 50_000, toSavingsMinor: 0, receivedOn: "2026-11-25" },
        {
          kind: "opening",
          currency: "LKR",
          amountMinor: 1_000_000,
          toSavingsMinor: 0,
          receivedOn: "2026-11-25",
        },
      ],
      commitments: [{ dueOn: "2026-12-20", currency: "LKR", plannedMinor: 4_000_000, state: "open" }],
    };
    // Rs 30,000 short → $100 reserved; $400 free. No rupees are free.
    const v = view(places, entries);
    expect(v.lines[0]?.canSpendMinor).toBe(0);
    expect(v.lines[1]).toMatchObject({ canSpendMinor: 40_000, canSpendCountedMinor: 12_000_000 });
  });

  it("totals each currency, and all of it in rupees", () => {
    const v = view(places, two);
    expect(v.totals.map((t) => [t.currency, t.totalMinor, t.differenceMinor])).toEqual([
      ["LKR", 1_000_000, 0],
      ["USD", 42_033, -57_967],
    ]);
    // Rs 10,000 + $420.33 at Rs 300.
    expect(v.totalCountedMinor).toBe(1_000_000 + 12_609_900);
  });
});
