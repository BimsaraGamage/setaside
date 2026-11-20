import { env } from "cloudflare:workers";
import { describe, expect, it } from "vitest";
import { suggestSalaryDay, todayIn } from "../../src/money";
import { call, signIn } from "./helpers";

// Place balances follow entries (ticket SAB-51, spec 6 "Where my money is"): spends and payments out of a
// place, Move money between places. Today's read gives each place what moved since its balance was typed.

const TZ = "Asia/Colombo";
const today = () => todayIn(TZ, Date.now());
const id = () => crypto.randomUUID();
/** A later instant than everything saved so far (rows are compared by the millisecond they were saved). */
const later = () => new Promise((r) => setTimeout(r, 5));

interface Place {
  id: string;
  name: string;
  balanceMinor: number | null;
  movedMinor: number;
}

const send = (method: string, path: string, body: unknown, cookie: string) =>
  call(path, { method, body: body === undefined ? undefined : JSON.stringify(body) }, cookie);

/** A fresh user with first use done: Rs 90,000 held (or with $1,000 and Rs 300 a dollar). */
async function setUp(two = false) {
  const u = await signIn("second");
  for (const t of ["place", "recurring_commitment", "pot", "cycle", "card", "counting_rate", "settings"]) {
    await env.DB.prepare(`delete from "${t}" where user_id = ?`).bind(u.id).run();
  }
  const res = await send(
    "POST",
    "/api/first-use",
    {
      settingsId: id(),
      cycleId: id(),
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
  const post = (path: string, body: unknown) => send("POST", path, body, u.cookie);
  /** A place with this balance typed (none: no balance yet). */
  const addPlace = async (name: string, balanceMinor: number | null, more: Record<string, unknown> = {}) => {
    const placeId = id();
    const balance = balanceMinor === null ? {} : { balance: { id: id(), amountMinor: balanceMinor } };
    expect((await post("/api/places", { id: placeId, name, ...balance, ...more })).status).toBe(201);
    return placeId;
  };
  const places = async () =>
    (await (await call("/api/current", {}, u.cookie)).json<{ places: Place[] }>()).places;
  /** What each place holds now, by name: the balance typed plus what moved since. */
  const balances = async () =>
    Object.fromEntries(
      (await places()).map((p) => [p.name, p.balanceMinor === null ? null : p.balanceMinor + p.movedMinor]),
    );
  const spend = async (amountMinor: number, more: Record<string, unknown> = {}) => {
    const spendId = id();
    const r = await post("/api/spends", { id: spendId, spentOn: today(), amountMinor, ...more });
    return { id: spendId, status: r.status, body: await r.json<{ problems?: string[] }>() };
  };
  const commitment = async (name: string, more: Record<string, unknown> = {}) => {
    const commitmentId = id();
    const body = { id: commitmentId, name, plannedMinor: 3_600_000, dueOn: today(), ...more };
    expect((await post("/api/commitments", body)).status).toBe(201);
    return commitmentId;
  };
  const pay = async (commitmentId: string, amountMinor: number, more: Record<string, unknown> = {}) => {
    const paymentId = id();
    const r = await post(`/api/commitments/${commitmentId}/payments`, {
      id: paymentId,
      amountMinor,
      paidOn: today(),
      ...more,
    });
    return { id: paymentId, status: r.status, body: await r.json<{ problems?: string[] }>() };
  };
  const move = async (fromPlaceId: string, toPlaceId: string, amountMinor: unknown) => {
    const moveId = id();
    const r = await post("/api/places/moves", { id: moveId, fromPlaceId, toPlaceId, amountMinor });
    return { id: moveId, status: r.status };
  };
  return { ...u, addPlace, places, balances, spend, commitment, pay, move };
}

describe("place balances follow entries (ticket SAB-51)", () => {
  it("a spend comes out of its place; changed, it follows; deleted, the money is back", async () => {
    const { cookie, addPlace, balances, spend } = await setUp();
    const hand = await addPlace("In hand", 1_200_000);
    const bank = await addPlace("Bank", 4_800_000);
    const s = await spend(185_000, { placeId: hand });
    expect(s.status).toBe(201);
    expect(await balances()).toEqual({ "In hand": 1_015_000, Bank: 4_800_000 });

    expect((await send("PATCH", `/api/spends/${s.id}`, { amountMinor: 250_000 }, cookie)).status).toBe(200);
    expect(await balances()).toEqual({ "In hand": 950_000, Bank: 4_800_000 });
    // Moved to the other place.
    expect((await send("PATCH", `/api/spends/${s.id}`, { placeId: bank }, cookie)).status).toBe(200);
    expect(await balances()).toEqual({ "In hand": 1_200_000, Bank: 4_550_000 });
    // No place: it moves none.
    expect((await send("PATCH", `/api/spends/${s.id}`, { placeId: null }, cookie)).status).toBe(200);
    expect(await balances()).toEqual({ "In hand": 1_200_000, Bank: 4_800_000 });

    const again = await spend(100_000, { placeId: bank });
    expect((await send("DELETE", `/api/spends/${again.id}`, undefined, cookie)).status).toBe(200);
    expect(await balances()).toEqual({ "In hand": 1_200_000, Bank: 4_800_000 });
  });

  it("a spend with no place moves none, and its place is listed with the spend", async () => {
    const { cookie, addPlace, balances, spend } = await setUp();
    const hand = await addPlace("In hand", 1_200_000);
    await spend(185_000);
    const s = await spend(50_000, { placeId: hand });
    expect(await balances()).toEqual({ "In hand": 1_150_000 });
    const { spends } = await (await call("/api/current", {}, cookie)).json<{
      spends: { id: string; placeId: string | null }[];
    }>();
    expect(spends.find((x) => x.id === s.id)?.placeId).toBe(hand);
    expect(spends.filter((x) => x.placeId === null)).toHaveLength(1);
  });

  it("a card spend moves no place until the card bill is paid", async () => {
    const { cookie, addPlace, balances, spend, pay } = await setUp();
    const bank = await addPlace("Bank", 4_800_000);
    const cardId = id();
    expect((await send("POST", "/api/cards", { id: cardId, name: "Visa" }, cookie)).status).toBe(201);
    // Sent with a place by mistake: saved on the card, out of no place.
    const s = await spend(500_000, { cardId, placeId: bank });
    expect(s.status).toBe(201);
    expect(await balances()).toEqual({ Bank: 4_800_000 });
    // A spend put on the card leaves its place.
    const cash = await spend(100_000, { placeId: bank });
    expect(await balances()).toEqual({ Bank: 4_700_000 });
    expect((await send("PATCH", `/api/spends/${cash.id}`, { cardId }, cookie)).status).toBe(200);
    expect(await balances()).toEqual({ Bank: 4_800_000 });

    // Paying the card bill takes the money out of the bank.
    const billId = id();
    const bill = {
      id: billId,
      name: "Visa bill",
      kind: "card_bill",
      plannedMinor: 600_000,
      dueOn: today(),
      cardId,
    };
    expect((await send("POST", "/api/commitments", bill, cookie)).status).toBe(201);
    expect((await pay(billId, 600_000, { placeId: bank })).status).toBe(201);
    expect(await balances()).toEqual({ Bank: 4_200_000 });
  });

  it("a balance typed later already has the older entries; newer ones move it", async () => {
    const { cookie, addPlace, balances, spend } = await setUp();
    const hand = await addPlace("In hand", 1_200_000);
    await spend(200_000, { placeId: hand });
    expect(await balances()).toEqual({ "In hand": 1_000_000 });
    await later();
    // The wallet says Rs 9,500: typed, it is the balance, whatever was entered before.
    const check = id();
    const set = await send("POST", `/api/places/${hand}/checks`, { id: check, amountMinor: 950_000 }, cookie);
    expect(set.status).toBe(201);
    expect(await balances()).toEqual({ "In hand": 950_000 });
    await spend(50_000, { placeId: hand });
    expect(await balances()).toEqual({ "In hand": 900_000 });
    // Undo of Set balance: the balance before it, with every entry since that one.
    expect((await send("DELETE", `/api/places/${hand}/checks/${check}`, undefined, cookie)).status).toBe(200);
    expect(await balances()).toEqual({ "In hand": 950_000 });
  });

  it("a place with no balance yet stays so: entries move nothing", async () => {
    const { addPlace, balances, places, spend } = await setUp();
    const hand = await addPlace("In hand", null);
    expect((await spend(185_000, { placeId: hand })).status).toBe(201);
    expect(await balances()).toEqual({ "In hand": null });
    expect((await places())[0]?.movedMinor).toBe(0);
  });

  it("refuses a spend out of a place that is not there, is someone else's, is stopped or holds another currency", async () => {
    const { cookie, addPlace, balances, spend } = await setUp(true);
    const hand = await addPlace("In hand", 1_200_000);
    const dollars = await addPlace("Dollar account", 42_000, { currency: "USD" });
    const refused = async (placeId: string) => {
      const s = await spend(100, { placeId });
      expect(s.status).toBe(400);
      expect(s.body.problems).toEqual(["place"]);
    };
    await refused(id());
    await refused(dollars);
    const first = await signIn("demo");
    const theirs = id();
    await env.DB.prepare(
      "insert into place (id, user_id, name, currency, kind, sort_order, archived, created_at, updated_at) values (?, ?, 'Theirs', 'LKR', 'spending', 9, 0, 0, 0)",
    )
      .bind(theirs, first.id)
      .run();
    await refused(theirs);

    // A spend keeps the place it has when that place is stopped; a new one can't take it.
    const kept = await spend(100_000, { placeId: hand });
    expect((await send("PATCH", `/api/places/${hand}`, { archived: true }, cookie)).status).toBe(200);
    await refused(hand);
    expect((await send("PATCH", `/api/spends/${kept.id}`, { amountMinor: 150_000 }, cookie)).status).toBe(
      200,
    );
    expect(await balances()).toEqual({ "In hand": 1_050_000, "Dollar account": 42_000 });
  });

  it("a payment comes out of its place, in the currency it was paid in", async () => {
    const { cookie, addPlace, balances, commitment, pay } = await setUp(true);
    const bank = await addPlace("Bank", 4_800_000);
    const dollars = await addPlace("Dollar account", 42_000, { currency: "USD" });
    const rent = await commitment("Rent");
    const p = await pay(rent, 1_000_000, { placeId: bank });
    expect(p.status).toBe(201);
    expect(await balances()).toEqual({ Bank: 3_800_000, "Dollar account": 42_000 });
    // Paid in dollars: out of the dollar place, never out of a rupee one.
    expect((await pay(rent, 5_000, { currency: "USD", placeId: bank })).body.problems).toEqual(["place"]);
    expect((await pay(rent, 5_000, { currency: "USD", placeId: dollars })).status).toBe(201);
    expect(await balances()).toEqual({ Bank: 3_800_000, "Dollar account": 37_000 });

    expect((await send("PATCH", `/api/payments/${p.id}`, { amountMinor: 1_200_000 }, cookie)).status).toBe(
      200,
    );
    expect(await balances()).toEqual({ Bank: 3_600_000, "Dollar account": 37_000 });
    expect((await send("PATCH", `/api/payments/${p.id}`, { placeId: null }, cookie)).status).toBe(200);
    expect(await balances()).toEqual({ Bank: 4_800_000, "Dollar account": 37_000 });
    expect((await send("PATCH", `/api/payments/${p.id}`, { placeId: dollars }, cookie)).status).toBe(400);
    expect((await send("PATCH", `/api/payments/${p.id}`, { placeId: bank }, cookie)).status).toBe(200);
    expect((await send("DELETE", `/api/payments/${p.id}`, undefined, cookie)).status).toBe(200);
    expect(await balances()).toEqual({ Bank: 4_800_000, "Dollar account": 37_000 });

    const { commitments } = await (await call("/api/current", {}, cookie)).json<{
      commitments: { id: string; payments: { placeId: string | null }[] }[];
    }>();
    expect(commitments.find((c) => c.id === rent)?.payments.map((x) => x.placeId)).toEqual([dollars]);
  });

  it("a savings set-aside moved to savings leaves its place: it takes none", async () => {
    const { addPlace, balances, commitment, pay } = await setUp();
    const bank = await addPlace("Bank", 4_800_000);
    const saving = await commitment("Emergency fund", { kind: "savings", plannedMinor: 500_000 });
    expect((await pay(saving, 500_000, { placeId: bank })).body.problems).toEqual(["place"]);
    expect((await pay(saving, 500_000)).status).toBe(201);
    expect(await balances()).toEqual({ Bank: 4_800_000 });
  });

  it("Move money takes from one place and adds to the other; Undo puts both back", async () => {
    const { cookie, addPlace, balances, move } = await setUp();
    const bank = await addPlace("Bank", 4_800_000);
    const hand = await addPlace("In hand", 1_200_000);
    const before = await (await call("/api/current", {}, cookie)).json<Record<string, unknown>>();
    const m = await move(bank, hand, 500_000);
    expect(m.status).toBe(201);
    expect(await balances()).toEqual({ Bank: 4_300_000, "In hand": 1_700_000 });
    // Nothing else changes: free money's entries are as they were, Undo salary day too.
    const after = await (await call("/api/current", {}, cookie)).json<Record<string, unknown>>();
    expect({ ...after, places: [] }).toEqual({ ...before, places: [] });
    // Saved once.
    const again = { id: m.id, fromPlaceId: bank, toPlaceId: hand, amountMinor: 1 };
    expect((await send("POST", "/api/places/moves", again, cookie)).status).toBe(409);

    expect((await send("DELETE", `/api/places/moves/${m.id}`, undefined, cookie)).status).toBe(200);
    expect(await balances()).toEqual({ Bank: 4_800_000, "In hand": 1_200_000 });
    expect((await send("DELETE", `/api/places/moves/${m.id}`, undefined, cookie)).status).toBe(404);
  });

  it("refuses a move of nothing, to the same place, to another currency's place or with a stopped place", async () => {
    const { cookie, addPlace, balances, move } = await setUp(true);
    const bank = await addPlace("Bank", 4_800_000);
    const hand = await addPlace("In hand", 1_200_000);
    const dollars = await addPlace("Dollar account", 42_000, { currency: "USD" });
    expect((await move(bank, hand, 0)).status).toBe(400);
    expect((await move(bank, hand, -100)).status).toBe(400);
    expect((await move(bank, hand, 10.5)).status).toBe(400);
    expect((await move(bank, bank, 100)).status).toBe(400);
    expect((await move(bank, dollars, 100)).status).toBe(400);
    expect((await move(bank, id(), 100)).status).toBe(400);
    expect((await send("PATCH", `/api/places/${hand}`, { archived: true }, cookie)).status).toBe(200);
    expect((await move(bank, hand, 100)).status).toBe(400);
    expect((await move(hand, bank, 100)).status).toBe(400);
    expect(await balances()).toEqual({ Bank: 4_800_000, "In hand": 1_200_000, "Dollar account": 42_000 });
  });

  it("a deleted place takes its moves with it; the other place gets its money back", async () => {
    const { id: userId, cookie, addPlace, balances, move, spend } = await setUp();
    const bank = await addPlace("Bank", 4_800_000);
    const hand = await addPlace("In hand", 1_200_000);
    await move(bank, hand, 500_000);
    const s = await spend(100_000, { placeId: hand });
    expect((await send("DELETE", `/api/places/${hand}?balances=delete`, undefined, cookie)).status).toBe(200);
    expect(await balances()).toEqual({ Bank: 4_800_000 });
    const left = await env.DB.prepare("select count(*) as n from place_move where user_id = ?")
      .bind(userId)
      .first<{ n: number }>();
    expect(left?.n).toBe(0);
    // The spend stays a spend; it can still be changed.
    expect((await send("PATCH", `/api/spends/${s.id}`, { amountMinor: 120_000 }, cookie)).status).toBe(200);
  });
});
