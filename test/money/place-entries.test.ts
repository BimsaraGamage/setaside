import { describe, expect, it } from "vitest";
import {
  type CycleEntries,
  checkPayment,
  checkPlaceMove,
  checkSpend,
  type PlaceEntry,
  placeBalanceMinor,
  placesView,
  placeUsable,
  staysInPlaces,
} from "../../src/money";

// Place balances follow entries (spec 6 "Where my money is", ticket SAB-51). Each case names the rule it checks.

const places = [
  { id: "hand", currency: "LKR", archived: false },
  { id: "bank", currency: "LKR", archived: false },
  { id: "dollars", currency: "USD", archived: false },
  { id: "old", currency: "LKR", archived: true },
];

describe("a place's balance now (spec 6)", () => {
  it("is the balance typed, moved by the entries saved since", () => {
    expect(placeBalanceMinor({ id: "hand", balanceMinor: 1_200_000, movedMinor: -185_000 })).toBe(1_015_000);
    expect(placeBalanceMinor({ id: "hand", balanceMinor: 1_200_000, movedMinor: 500_000 })).toBe(1_700_000);
    // A saved copy from before balances moved has no `movedMinor`.
    expect(placeBalanceMinor({ id: "hand", balanceMinor: 1_200_000 })).toBe(1_200_000);
  });

  it("takes the unsent spends and payments out of their own place only", () => {
    const unsent = [
      { placeId: "hand", amountMinor: 50_000 },
      { placeId: "bank", amountMinor: 700_000 },
      { placeId: null, amountMinor: 999 },
      { amountMinor: 999 },
    ];
    expect(placeBalanceMinor({ id: "hand", balanceMinor: 1_200_000, movedMinor: -200_000 }, unsent)).toBe(
      950_000,
    );
  });

  it("stays unknown while no balance was typed, whatever was entered", () => {
    const unsent = [{ placeId: "hand", amountMinor: 50_000 }];
    expect(placeBalanceMinor({ id: "hand", balanceMinor: null, movedMinor: -200_000 }, unsent)).toBeNull();
  });

  it("can go below zero when entries take more than was typed; nothing can be spent from it then", () => {
    expect(placeBalanceMinor({ id: "hand", balanceMinor: 100_000, movedMinor: -150_000 })).toBe(-50_000);
    const entries: CycleEntries = {
      spendingCurrency: "LKR",
      startedOn: "2026-11-25",
      expectedSalaryOn: "2026-12-25",
      incomes: [
        {
          kind: "opening",
          currency: "LKR",
          amountMinor: 6_000_000,
          toSavingsMinor: 0,
          receivedOn: "2026-11-25",
        },
      ],
      spends: [],
    };
    const mine: PlaceEntry[] = [
      { id: "hand", currency: "LKR", kind: "spending", archived: false, balanceMinor: -50_000 },
      { id: "bank", currency: "LKR", kind: "spending", archived: false, balanceMinor: 4_000_000 },
    ];
    const view = placesView(mine, { entries, savings: [], cards: [] });
    expect(view.lines.map((l) => l.canSpendMinor)).toEqual([0, 4_000_000]);
    // The total still counts what is owed to the place.
    expect(view.totals[0]?.totalMinor).toBe(3_950_000);
  });
});

describe("the place an entry comes out of (spec 6)", () => {
  it("is the user's, in use and in the entry's currency", () => {
    expect(placeUsable("hand", "LKR", places)).toBe(true);
    expect(placeUsable("dollars", "LKR", places)).toBe(false);
    expect(placeUsable("dollars", "USD", places)).toBe(true);
    expect(placeUsable("nowhere", "LKR", places)).toBe(false);
    expect(placeUsable("hand", "LKR", undefined)).toBe(false);
  });

  it("a stopped place is kept by the entry that already has it, not taken by another", () => {
    expect(placeUsable("old", "LKR", places)).toBe(false);
    expect(placeUsable("old", "LKR", places, "old")).toBe(true);
    expect(placeUsable("old", "LKR", places, "hand")).toBe(false);
  });

  const sctx = { today: "2026-11-27", cycleStartedOn: "2026-11-25", spendingCurrency: "LKR", places };
  const spend = { amountMinor: 185_000, spentOn: "2026-11-27", currency: "LKR" };

  it("a spend takes a place of its currency, or none", () => {
    expect(checkSpend(spend, sctx)).toEqual([]);
    expect(checkSpend({ ...spend, placeId: null }, sctx)).toEqual([]);
    expect(checkSpend({ ...spend, placeId: "hand" }, sctx)).toEqual([]);
    expect(checkSpend({ ...spend, placeId: "dollars" }, sctx)).toEqual(["place"]);
    expect(checkSpend({ ...spend, placeId: "old" }, sctx)).toEqual(["place"]);
    expect(checkSpend({ ...spend, placeId: "old" }, { ...sctx, keepPlaceId: "old" })).toEqual([]);
  });

  it("a card spend takes no place: nothing leaves a place until the card bill is paid", () => {
    const cards = [{ id: "visa", currency: "LKR", archived: false }];
    expect(checkSpend({ ...spend, cardId: "visa" }, { ...sctx, cards })).toEqual([]);
    expect(checkSpend({ ...spend, cardId: "visa", placeId: "hand" }, { ...sctx, cards })).toEqual(["place"]);
  });

  const pctx = { today: "2026-11-27", cycleStartedOn: "2026-11-25", currency: "LKR", places };
  const payment = { amountMinor: 3_600_000, paidOn: "2026-11-27", currency: "LKR" };

  it("a payment takes a place of the currency it is paid in", () => {
    expect(checkPayment(payment, pctx)).toEqual([]);
    expect(checkPayment({ ...payment, placeId: "bank" }, pctx)).toEqual([]);
    expect(checkPayment({ ...payment, placeId: "dollars" }, pctx)).toEqual(["place"]);
    const inDollars = { ...payment, currency: "USD", amountMinor: 12_000 };
    const two = { ...pctx, otherCurrency: "USD" };
    expect(checkPayment({ ...inDollars, placeId: "dollars" }, two)).toEqual([]);
    expect(checkPayment({ ...inDollars, placeId: "bank" }, two)).toEqual(["place"]);
    expect(checkPayment({ ...payment, placeId: "old" }, { ...pctx, keepPlaceId: "old" })).toEqual([]);
  });

  it("a savings set-aside moved to savings leaves no place", () => {
    expect(staysInPlaces("savings")).toBe(true);
    expect(staysInPlaces("savings_payback")).toBe(true);
    expect(staysInPlaces("bill")).toBe(false);
    expect(staysInPlaces("card_bill")).toBe(false);
    expect(checkPayment({ ...payment, placeId: "bank" }, { ...pctx, noPlace: true })).toEqual(["place"]);
    expect(checkPayment(payment, { ...pctx, noPlace: true })).toEqual([]);
  });
});

describe("Move money (spec 6)", () => {
  const move = (fromPlaceId: string, toPlaceId: string, amountMinor = 500_000) =>
    checkPlaceMove({ fromPlaceId, toPlaceId, amountMinor }, places);

  it("goes between two places in use of one currency", () => {
    expect(move("bank", "hand")).toEqual([]);
    expect(move("hand", "bank", 1)).toEqual([]);
  });

  it("needs an amount above zero, in whole minor units", () => {
    expect(move("bank", "hand", 0)).toEqual(["amount"]);
    expect(move("bank", "hand", -100)).toEqual(["amount"]);
    expect(move("bank", "hand", 10.5)).toEqual(["amount"]);
  });

  it("refuses the same place, another currency's place, a stopped place and one that is not there", () => {
    expect(move("bank", "bank")).toEqual(["to"]);
    expect(move("bank", "dollars")).toEqual(["to"]);
    expect(move("bank", "old")).toEqual(["to"]);
    expect(move("old", "bank")).toEqual(["from"]);
    expect(move("nowhere", "bank")).toEqual(["from"]);
    expect(move("bank", "nowhere")).toEqual(["to"]);
  });
});
