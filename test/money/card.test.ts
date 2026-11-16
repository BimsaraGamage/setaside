import { describe, expect, it } from "vitest";
import {
  type CardEntry,
  type ClosingEntries,
  type CommitmentEntry,
  type CycleEntries,
  cardBalanceMinor,
  cardBillFillMinor,
  checkCard,
  checkSpend,
  freeMoney,
  heldForCardsMinor,
  leftoverOf,
  type PaymentEntry,
  type SpendEntry,
  salaryDayDrafts,
  salaryDayGapMinor,
  setAsideMinor,
} from "../../src/money";

// Item 18 · Cards and card balance (spec 9, 6). Each case names the rule it checks (spec 16).

const SALARY = "2026-11-30";
const CARD: CardEntry = { id: "visa", currency: "LKR", archived: false, earlierMinor: 0 };

const cardSpend = (amountMinor: number, cardId: string | null = "visa", potId?: string): SpendEntry => ({
  spentOn: "2026-11-10",
  currency: "LKR",
  amountMinor,
  cardId,
  ...(potId ? { potId } : {}),
});

const paid = (amountMinor: number, currency = "LKR"): PaymentEntry => ({
  amountMinor,
  currency,
  paidOn: "2026-11-15",
});

const cardBill = (
  plannedMinor: number,
  payments: PaymentEntry[] = [],
  state: CommitmentEntry["state"] = "open",
  cardId = "visa",
): CommitmentEntry & { id: string; kind: string; cardId: string } => ({
  id: `bill-${cardId}-${plannedMinor}`,
  kind: "card_bill",
  cardId,
  dueOn: "2026-11-25",
  currency: "LKR",
  plannedMinor,
  state,
  payments,
});

/** Rs 100,000 to spend. */
function cycle(spends: SpendEntry[], commitments: CommitmentEntry[] = []): CycleEntries {
  return {
    spendingCurrency: "LKR",
    expectedSalaryOn: SALARY,
    startedOn: "2026-11-01",
    incomes: [{ kind: "salary", currency: "LKR", amountMinor: 10_000_000, toSavingsMinor: 0 }],
    spends,
    commitments,
  };
}

describe("card spend (spec 9)", () => {
  it("lowers free money the day it is made, like cash", () => {
    expect(freeMoney(cycle([cardSpend(500_000)]))).toBe(9_500_000);
    expect(freeMoney(cycle([cardSpend(500_000)]), "2026-11-10")).toBe(10_000_000);
  });

  it("adds to its card's balance; a cash spend does not", () => {
    const spends = [cardSpend(500_000), cardSpend(200_000), cardSpend(300_000, null)];
    expect(cardBalanceMinor(CARD, spends, [])).toBe(700_000);
  });

  it("counts the balance from ended cycles too", () => {
    expect(cardBalanceMinor({ ...CARD, earlierMinor: 400_000 }, [cardSpend(100_000)], [])).toBe(500_000);
  });

  it("from a pot comes out of the pot first, and still adds to the card", () => {
    const pots = [{ id: "food", currency: "LKR", amountMinor: 300_000, archived: false }];
    const entries = { ...cycle([cardSpend(400_000, "visa", "food")]), pots };
    // Rs 3,000 set aside for the pot, Rs 1,000 past it from free money.
    expect(freeMoney(entries)).toBe(10_000_000 - 300_000 - 100_000);
    expect(cardBalanceMinor(CARD, entries.spends, [])).toBe(400_000);
  });

  it("beyond free money is overspend", () => {
    expect(freeMoney(cycle([cardSpend(12_000_000)]))).toBe(-2_000_000);
  });
});

describe("card bill (spec 9)", () => {
  it("is not set aside: its money is already out of free money as card spends", () => {
    const entries = cycle([cardSpend(500_000)], [cardBill(500_000)]);
    expect(freeMoney(entries)).toBe(9_500_000);
    expect(setAsideMinor(entries.commitments ?? [], SALARY, "LKR")).toBe(0);
  });

  it("paying it does not lower free money again, in full or in part", () => {
    const full = cycle([cardSpend(500_000)], [cardBill(500_000, [paid(500_000)], "finished")]);
    const part = cycle([cardSpend(500_000)], [cardBill(500_000, [paid(200_000)])]);
    expect(freeMoney(full)).toBe(9_500_000);
    expect(freeMoney(part)).toBe(9_500_000);
  });

  it("payments take the balance down; the rest stays owed", () => {
    const bills = [cardBill(500_000, [paid(200_000)])];
    expect(cardBalanceMinor(CARD, [cardSpend(500_000)], bills)).toBe(300_000);
  });

  it("only its own card's bills take its balance down", () => {
    const bills = [cardBill(500_000, [paid(200_000)], "open", "amex")];
    expect(cardBalanceMinor(CARD, [cardSpend(500_000)], bills)).toBe(500_000);
  });

  it("is filled from the balance, less what other open bills of the card still owe", () => {
    expect(cardBillFillMinor(700_000, [])).toBe(700_000);
    expect(cardBillFillMinor(700_000, [cardBill(300_000, [paid(100_000)])])).toBe(500_000);
    expect(cardBillFillMinor(200_000, [cardBill(300_000)])).toBe(0);
  });

  it("is left out of the salary-day gap", () => {
    const gap = salaryDayGapMinor({
      commitments: [cardBill(5_000_000)],
      pots: [],
      salaryMinor: 1_000_000,
      expectedSalaryOn: SALARY,
      currency: "LKR",
    });
    expect(gap).toBe(0);
  });
});

describe("held money at cycle end (spec 6)", () => {
  it("is not leftover", () => {
    const entries: ClosingEntries = {
      ...cycle([cardSpend(500_000)], [cardBill(500_000)]),
      commitments: [cardBill(500_000)],
    };
    expect(leftoverOf(entries, [{ id: "bill-visa-500000", choice: "carry" }]).leftoverMinor).toBe(9_500_000);
  });

  it("a dropped or carried card bill adds nothing to the leftover or the money carried", () => {
    const entries: ClosingEntries = { ...cycle([cardSpend(500_000)]), commitments: [cardBill(500_000)] };
    const dropped = leftoverOf(entries, [{ id: "bill-visa-500000", choice: "drop" }]);
    const carried = leftoverOf(entries, [{ id: "bill-visa-500000", choice: "carry" }]);
    expect(dropped.droppedMinor).toBe(0);
    expect(dropped.leftoverMinor).toBe(9_500_000);
    expect(carried.carriedMinor).toBe(0);
  });

  it("held for cards: what the cards in that currency owe (never below zero)", () => {
    const usd: CardEntry = { id: "usd", currency: "USD", archived: false, earlierMinor: 9_000 };
    const credit: CardEntry = { id: "credit", currency: "LKR", archived: false, earlierMinor: -50_000 };
    const held = heldForCardsMinor([CARD, usd, credit], [cardSpend(500_000)], [], "LKR");
    expect(held).toBe(500_000);
  });
});

describe("checks", () => {
  const ctx = { spendingCurrency: "LKR", salaryCurrency: "USD" };

  it("a card has a name and one of the user's currencies", () => {
    expect(checkCard({ name: "Visa", currency: "USD" }, ctx)).toEqual([]);
    expect(checkCard({ name: " ", currency: "EUR" }, ctx)).toEqual(["name", "currency"]);
  });

  it("a card spend uses a card in use, in the spend's currency", () => {
    const base = {
      amountMinor: 1_000,
      spentOn: "2026-11-10",
      currency: "LKR",
    };
    const sctx = {
      ...ctx,
      today: "2026-11-16",
      cycleStartedOn: "2026-11-01",
      cards: [CARD, { ...CARD, id: "usd", currency: "USD" }, { ...CARD, id: "old", archived: true }],
    };
    expect(checkSpend({ ...base, cardId: "visa" }, sctx)).toEqual([]);
    expect(checkSpend({ ...base, cardId: "usd" }, sctx)).toEqual(["card"]);
    expect(checkSpend({ ...base, cardId: "old" }, sctx)).toEqual(["card"]);
    expect(checkSpend({ ...base, cardId: "old" }, { ...sctx, keepCardId: "old" })).toEqual([]);
    expect(checkSpend({ ...base, cardId: "nope" }, sctx)).toEqual(["card"]);
  });
});

describe("salary day step 4 (spec 6, 9)", () => {
  const template = {
    id: "t-visa",
    name: "Visa bill",
    kind: "card_bill" as const,
    currency: "LKR",
    usualAmountMinor: 1,
    usualDay: 5,
    active: true,
    cardId: "visa",
  };

  it("an Every cycle card bill is filled from its card, not the last amount", () => {
    const rows = salaryDayDrafts({
      recurring: [template],
      comingUp: [],
      startedOn: "2026-11-25",
      cardFill: () => 700_000,
    });
    expect(rows).toEqual([
      expect.objectContaining({
        kind: "card_bill",
        cardId: "visa",
        plannedMinor: 700_000,
        dueOn: "2026-12-05",
        everyCycle: true,
      }),
    ]);
  });

  it("is left out when the card owes nothing", () => {
    const rows = salaryDayDrafts({
      recurring: [template],
      comingUp: [],
      startedOn: "2026-11-25",
      cardFill: () => 0,
    });
    expect(rows).toEqual([]);
  });

  it("a coming-up card bill carries on with its card and stands in for the template", () => {
    const comingUp = {
      ...cardBill(300_000),
      dueOn: "2026-12-05",
      recurringId: "t-visa",
      name: "Visa bill",
      kind: "card_bill" as const,
    };
    const rows = salaryDayDrafts({
      recurring: [template],
      comingUp: [comingUp],
      startedOn: "2026-11-25",
      cardFill: () => 700_000,
    });
    expect(rows).toEqual([
      expect.objectContaining({ cardId: "visa", plannedMinor: 300_000, carriedFromId: "bill-visa-300000" }),
    ]);
  });
});
