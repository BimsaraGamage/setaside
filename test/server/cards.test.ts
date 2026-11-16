import { env } from "cloudflare:workers";
import { describe, expect, it } from "vitest";
import { addDays, suggestSalaryDay, todayIn } from "../../src/money";
import { call, signIn } from "./helpers";

// Cards and card balance (item 18, spec 9, 6).

const TZ = "Asia/Colombo";
const today = () => todayIn(TZ, Date.now());
const id = () => crypto.randomUUID();

interface Current {
  cycle: { id: string };
  incomes: { kind: string; amountMinor: number; toSavingsMinor: number }[];
  spends: { id: string; cardId: string | null }[];
  cards: { id: string; name: string; currency: string; archived: boolean; earlierMinor: number }[];
  commitments: {
    id: string;
    kind: string;
    currency: string;
    cardId: string | null;
    plannedMinor: number;
    state: string;
    recurringId: string | null;
  }[];
  recurring: { id: string; kind: string; cardId: string | null }[];
  undoSalaryDay: boolean;
}

const send = (method: string, path: string, body: unknown, cookie: string) =>
  call(path, { method, body: body === undefined ? undefined : JSON.stringify(body) }, cookie);
const currentOf = async (cookie: string) => (await call("/api/current", {}, cookie)).json<Current>();

/** A fresh user, first use 20 days ago: Rs 90,000 held (or with $1,000 and Rs 300 a dollar). */
async function setUp(two = false) {
  const u = await signIn("second");
  for (const t of ["recurring_commitment", "pot", "cycle", "card", "counting_rate", "settings"]) {
    await env.DB.prepare(`delete from "${t}" where user_id = ?`).bind(u.id).run();
  }
  const cycleId = id();
  const res = await send(
    "POST",
    "/api/first-use",
    {
      settingsId: id(),
      cycleId,
      incomeId: id(),
      salaryCurrency: two ? "USD" : "LKR",
      spendingCurrency: "LKR",
      homeTimeZone: TZ,
      usualPayDay: 25,
      heldMinor: 9_000_000,
      ...(two
        ? { salaryIncomeId: id(), countingRateId: id(), heldSalaryMinor: 100_000, countingRate: "300" }
        : {}),
      expectedSalaryOn: suggestSalaryDay(today(), 25),
      commitments: [],
      pots: [],
    },
    u.cookie,
  );
  expect(res.status).toBe(201);
  await env.DB.prepare("update cycle set started_on = ? where id = ?")
    .bind(addDays(today(), -20), cycleId)
    .run();
  const addCard = async (name = "Visa", currency?: string) => {
    const cardId = id();
    const r = await send("POST", "/api/cards", { id: cardId, name, currency }, u.cookie);
    expect(r.status).toBe(201);
    return cardId;
  };
  const spend = async (amountMinor: number, cardId: string | null) => {
    const sid = id();
    const r = await send("POST", "/api/spends", { id: sid, spentOn: today(), amountMinor, cardId }, u.cookie);
    return { sid, status: r.status };
  };
  return { ...u, addCard, spend };
}

describe("cards (item 18)", () => {
  it("adds, renames, stops and deletes a card nothing uses", async () => {
    const { cookie, addCard } = await setUp();
    const cardId = await addCard(" Visa ");
    expect((await currentOf(cookie)).cards).toEqual([
      { id: cardId, name: "Visa", currency: "LKR", archived: false, earlierMinor: 0 },
    ]);
    expect(
      (await send("PATCH", `/api/cards/${cardId}`, { name: "Amex", archived: true }, cookie)).status,
    ).toBe(200);
    expect((await currentOf(cookie)).cards[0]).toMatchObject({ name: "Amex", archived: true });
    expect((await send("DELETE", `/api/cards/${cardId}`, undefined, cookie)).status).toBe(200);
    expect((await currentOf(cookie)).cards).toEqual([]);
  });

  it("refuses a card without a name or in a currency the user doesn't have", async () => {
    const { cookie } = await setUp();
    expect((await send("POST", "/api/cards", { id: id(), name: " " }, cookie)).status).toBe(400);
    expect(
      (await send("POST", "/api/cards", { id: id(), name: "Visa", currency: "USD" }, cookie)).status,
    ).toBe(400);
  });

  it("a card with spends can't be deleted: stop using it instead", async () => {
    const { cookie, addCard, spend } = await setUp();
    const cardId = await addCard();
    await spend(100_000, cardId);
    expect((await send("DELETE", `/api/cards/${cardId}`, undefined, cookie)).status).toBe(409);
  });
});

describe("card spends (item 18, spec 9)", () => {
  it("keeps the card; refuses an unknown card, a stopped one, or one in another currency", async () => {
    const { cookie, addCard, spend } = await setUp(true);
    const visa = await addCard();
    const usd = await addCard("Dollar card", "USD");
    const { sid, status } = await spend(100_000, visa);
    expect(status).toBe(201);
    expect((await currentOf(cookie)).spends.find((s) => s.id === sid)?.cardId).toBe(visa);
    expect((await spend(100_000, id())).status).toBe(400);
    expect((await spend(100_000, usd)).status).toBe(400);
    await send("PATCH", `/api/cards/${visa}`, { archived: true }, cookie);
    expect((await spend(100_000, visa)).status).toBe(400);
    // A spend already on the stopped card may stay on it when changed.
    expect((await send("PATCH", `/api/spends/${sid}`, { amountMinor: 200_000 }, cookie)).status).toBe(200);
    expect((await send("PATCH", `/api/spends/${sid}`, { cardId: null }, cookie)).status).toBe(200);
    expect((await send("PATCH", `/api/spends/${sid}`, { cardId: visa }, cookie)).status).toBe(400);
  });

  it("refuses another user's card", async () => {
    const other = await signIn("demo");
    const theirs = id();
    const now = Date.now();
    await env.DB.prepare(
      "insert into card (id, user_id, name, currency, archived, created_at, updated_at) values (?, ?, 'Theirs', 'LKR', 0, ?, ?)",
    )
      .bind(theirs, other.id, now, now)
      .run();
    const { spend } = await setUp();
    expect((await spend(100_000, theirs)).status).toBe(400);
  });
});

describe("card bills (item 18, spec 9)", () => {
  it("is made for one of the user's cards, in its currency, and paid in that currency only", async () => {
    const { cookie, addCard } = await setUp(true);
    const usd = await addCard("Dollar card", "USD");
    const billId = id();
    const bill = {
      id: billId,
      kind: "card_bill",
      cardId: usd,
      name: "Dollar card bill",
      plannedMinor: 5_000,
      dueOn: today(),
    };
    expect((await send("POST", "/api/commitments", bill, cookie)).status).toBe(201);
    expect((await currentOf(cookie)).commitments.find((k) => k.id === billId)).toMatchObject({
      kind: "card_bill",
      currency: "USD",
      cardId: usd,
    });
    const pay = (currency: string) =>
      send(
        "POST",
        `/api/commitments/${billId}/payments`,
        { id: id(), amountMinor: 1_000, paidOn: today(), currency },
        cookie,
      );
    expect((await pay("LKR")).status).toBe(400);
    expect((await pay("USD")).status).toBe(201);
    // A card bill keeps its kind.
    expect((await send("PATCH", `/api/commitments/${billId}`, { kind: "bill" }, cookie)).status).toBe(400);
  });

  it("needs a card of the user's; a bill can't have one", async () => {
    const { cookie, addCard } = await setUp();
    const visa = await addCard();
    const base = { name: "Visa bill", plannedMinor: 5_000, dueOn: today() };
    expect(
      (await send("POST", "/api/commitments", { id: id(), kind: "card_bill", ...base }, cookie)).status,
    ).toBe(400);
    expect(
      (await send("POST", "/api/commitments", { id: id(), kind: "card_bill", cardId: id(), ...base }, cookie))
        .status,
    ).toBe(400);
    expect((await send("POST", "/api/commitments", { id: id(), cardId: visa, ...base }, cookie)).status).toBe(
      400,
    );
  });

  it("Every cycle keeps the card on the template", async () => {
    const { cookie, addCard } = await setUp();
    const visa = await addCard();
    const bill = {
      id: id(),
      kind: "card_bill",
      cardId: visa,
      name: "Visa bill",
      plannedMinor: 5_000,
      dueOn: today(),
    };
    const recurringId = id();
    expect((await send("POST", "/api/commitments", { ...bill, recurringId }, cookie)).status).toBe(201);
    expect((await currentOf(cookie)).recurring).toEqual([
      expect.objectContaining({ id: recurringId, kind: "card_bill", cardId: visa }),
    ]);
  });
});

describe("salary day with cards (item 18, spec 6, 9)", () => {
  it("held money is not leftover; ended cycles' balance carries over; the next bill keeps its card", async () => {
    const { cookie, addCard, spend } = await setUp();
    const visa = await addCard();
    await spend(500_000, visa);
    const billId = id();
    const recurringId = id();
    const bill = {
      id: billId,
      kind: "card_bill",
      cardId: visa,
      name: "Visa bill",
      plannedMinor: 500_000,
      dueOn: today(),
      recurringId,
    };
    expect((await send("POST", "/api/commitments", bill, cookie)).status).toBe(201);
    const payment = { id: id(), amountMinor: 200_000, paidOn: today() };
    expect((await send("POST", `/api/commitments/${billId}/payments`, payment, cookie)).status).toBe(201);

    const nextBill = id();
    const res = await send(
      "POST",
      "/api/salary-day",
      {
        cycleId: id(),
        incomeId: id(),
        salaryMinor: 25_000_000,
        receivedOn: today(),
        expectedSalaryOn: addDays(today(), 30),
        commitments: [
          {
            id: nextBill,
            kind: "card_bill",
            cardId: visa,
            name: "Visa bill",
            plannedMinor: 300_000,
            dueOn: addDays(today(), 10),
            recurringId,
            everyCycle: true,
          },
        ],
        pots: [],
        close: {
          closeId: id(),
          leftoverIncomeId: id(),
          unpaid: [{ id: billId, choice: "drop" }],
          inHandMinor: null,
          toSavingsMinor: 0,
          overspend: null,
        },
      },
      cookie,
    );
    expect(res.status).toBe(201);
    const now = await currentOf(cookie);
    // Rs 90,000 less the Rs 5,000 card spend; the bill and its payment took nothing more, dropping it gives nothing back.
    expect(now.incomes.find((i) => i.kind === "leftover")?.amountMinor).toBe(8_500_000);
    expect(now.cards[0]?.earlierMinor).toBe(300_000);
    expect(now.commitments.find((k) => k.id === nextBill)).toMatchObject({
      kind: "card_bill",
      cardId: visa,
      recurringId,
    });
    expect(now.undoSalaryDay).toBe(true);
    // A card changed after salary day is something new: undo is no longer offered.
    await send("PATCH", `/api/cards/${visa}`, { name: "Visa gold" }, cookie);
    expect((await currentOf(cookie)).undoSalaryDay).toBe(false);
  });

  it("refuses a card bill without the user's card, or in another currency", async () => {
    const { cookie, addCard } = await setUp(true);
    const usd = await addCard("Dollar card", "USD");
    const body = (row: Record<string, unknown>) => ({
      cycleId: id(),
      incomeId: id(),
      salaryMinor: 100_000,
      receivedOn: today(),
      expectedSalaryOn: addDays(today(), 30),
      countingRate: null,
      commitments: [{ id: id(), name: "Card bill", plannedMinor: 1_000, dueOn: addDays(today(), 3), ...row }],
      pots: [],
      close: {
        closeId: id(),
        leftoverIncomeId: id(),
        salaryLeftoverIncomeId: id(),
        salaryCloseId: id(),
        unpaid: [],
        inHandMinor: null,
        toSavingsMinor: 0,
        overspend: null,
      },
    });
    const problems = async (row: Record<string, unknown>) =>
      (await (await send("POST", "/api/salary-day", body(row), cookie)).json<{ problems?: string[] }>())
        .problems;
    expect(await problems({ kind: "card_bill" })).toContain("commitment.0.card");
    expect(await problems({ kind: "card_bill", cardId: usd, currency: "LKR" })).toContain(
      "commitment.0.card",
    );
    expect(await problems({ kind: "bill", cardId: usd })).toContain("commitment.0.card");
  });
});
