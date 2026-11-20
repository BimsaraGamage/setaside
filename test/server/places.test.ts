import { env } from "cloudflare:workers";
import { describe, expect, it } from "vitest";
import { suggestSalaryDay, todayIn } from "../../src/money";
import { call, signIn } from "./helpers";

// Places and their typed balances (ticket SAB-50, spec 6 "Where my money is").

const TZ = "Asia/Colombo";
const today = () => todayIn(TZ, Date.now());
const id = () => crypto.randomUUID();

interface Place {
  id: string;
  name: string;
  currency: string;
  kind: string;
  archived: boolean;
  balanceMinor: number | null;
  checkedAt: number | null;
}

const send = (method: string, path: string, body: unknown, cookie: string) =>
  call(path, { method, body: body === undefined ? undefined : JSON.stringify(body) }, cookie);
const placesOf = async (cookie: string) =>
  (await (await call("/api/current", {}, cookie)).json<{ places: Place[] }>()).places;

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
  const addPlace = async (name: string, more: Record<string, unknown> = {}) => {
    const placeId = id();
    const r = await send("POST", "/api/places", { id: placeId, name, ...more }, u.cookie);
    expect(r.status).toBe(201);
    return placeId;
  };
  const setBalance = async (placeId: string, amountMinor: number) => {
    const checkId = id();
    const r = await send("POST", `/api/places/${placeId}/checks`, { id: checkId, amountMinor }, u.cookie);
    expect(r.status).toBe(201);
    return checkId;
  };
  return { ...u, addPlace, setBalance };
}

describe("places (ticket SAB-50)", () => {
  it("adds a place with no balance yet, in the spending currency, For spending", async () => {
    const { cookie, addPlace } = await setUp();
    const placeId = await addPlace(" In hand ");
    expect(await placesOf(cookie)).toEqual([
      {
        id: placeId,
        name: "In hand",
        currency: "LKR",
        kind: "spending",
        archived: false,
        balanceMinor: null,
        checkedAt: null,
      },
    ]);
  });

  it("adds a place with the balance typed with it", async () => {
    const { cookie, addPlace } = await setUp(true);
    const before = Date.now();
    await addPlace("Dollar account", {
      currency: "USD",
      kind: "kept",
      balance: { id: id(), amountMinor: 42_033 },
    });
    const [p] = await placesOf(cookie);
    expect(p).toMatchObject({ name: "Dollar account", currency: "USD", kind: "kept", balanceMinor: 42_033 });
    expect(p?.checkedAt).toBeGreaterThanOrEqual(before);
  });

  it("refuses a place without a name, in a currency the user doesn't have, of no kind, or with a balance below zero", async () => {
    const { cookie } = await setUp();
    const post = (body: Record<string, unknown>) =>
      send("POST", "/api/places", { id: id(), ...body }, cookie);
    expect((await post({ name: " " })).status).toBe(400);
    expect((await post({ name: "Dollars", currency: "USD" })).status).toBe(400);
    expect((await post({ name: "Safe", kind: "vault" })).status).toBe(400);
    expect((await post({ name: "Bank", balance: { id: id(), amountMinor: -1 } })).status).toBe(400);
    expect((await post({ name: "Bank", balance: { id: id(), amountMinor: 10.5 } })).status).toBe(400);
    expect(await placesOf(cookie)).toEqual([]);
  });

  it("the same id is saved once", async () => {
    const { cookie, addPlace } = await setUp();
    const placeId = await addPlace("Bank");
    expect((await send("POST", "/api/places", { id: placeId, name: "Bank 2" }, cookie)).status).toBe(409);
    expect((await placesOf(cookie)).map((p) => p.name)).toEqual(["Bank"]);
  });

  it("Set balance: the newest typed balance is the balance; Undo puts the one before back", async () => {
    const { cookie, addPlace, setBalance } = await setUp();
    const placeId = await addPlace("Bank");
    await setBalance(placeId, 4_800_000);
    const second = await setBalance(placeId, 4_500_000);
    expect((await placesOf(cookie))[0]?.balanceMinor).toBe(4_500_000);
    expect((await send("DELETE", `/api/places/${placeId}/checks/${second}`, undefined, cookie)).status).toBe(
      200,
    );
    expect((await placesOf(cookie))[0]?.balanceMinor).toBe(4_800_000);
    expect((await send("DELETE", `/api/places/${placeId}/checks/${second}`, undefined, cookie)).status).toBe(
      404,
    );
  });

  it("refuses a balance below zero, not whole, or for a place that is not there", async () => {
    const { cookie, addPlace } = await setUp();
    const placeId = await addPlace("Bank");
    const set = (pid: string, amountMinor: unknown) =>
      send("POST", `/api/places/${pid}/checks`, { id: id(), amountMinor }, cookie);
    expect((await set(placeId, -100)).status).toBe(400);
    expect((await set(placeId, 0.5)).status).toBe(400);
    expect((await set(placeId, "100")).status).toBe(400);
    expect((await set(id(), 100)).status).toBe(404);
    expect((await set(placeId, 0)).status).toBe(201);
    expect((await placesOf(cookie))[0]?.balanceMinor).toBe(0);
  });

  it("renames, changes the kind, stops using and uses again; the currency stays", async () => {
    const { cookie, addPlace } = await setUp(true);
    const placeId = await addPlace("Bank");
    const patch = (body: unknown) => send("PATCH", `/api/places/${placeId}`, body, cookie);
    expect((await patch({ name: " Pan Asia ", kind: "kept", archived: true })).status).toBe(200);
    expect((await placesOf(cookie))[0]).toMatchObject({ name: "Pan Asia", kind: "kept", archived: true });
    expect((await patch({ archived: false, currency: "USD" })).status).toBe(200);
    expect((await placesOf(cookie))[0]).toMatchObject({ archived: false, currency: "LKR" });
    expect((await patch({ name: "" })).status).toBe(400);
    expect((await patch({ kind: "vault" })).status).toBe(400);
    expect((await send("PATCH", `/api/places/${id()}`, { name: "x" }, cookie)).status).toBe(404);
  });

  it("lists places in the order added, and in the order given after a reorder", async () => {
    const { cookie, addPlace } = await setUp();
    const a = await addPlace("A");
    const b = await addPlace("B");
    const c = await addPlace("C");
    expect((await placesOf(cookie)).map((p) => p.name)).toEqual(["A", "B", "C"]);
    const reorder = (ids: string[]) => send("PUT", "/api/places/order", { ids }, cookie);
    expect((await reorder([c, a, b])).status).toBe(200);
    expect((await placesOf(cookie)).map((p) => p.name)).toEqual(["C", "A", "B"]);
    // Every place once, nothing else.
    expect((await reorder([a, b])).status).toBe(400);
    expect((await reorder([a, a, b])).status).toBe(400);
    expect((await reorder([a, b, id()])).status).toBe(400);
    expect((await placesOf(cookie)).map((p) => p.name)).toEqual(["C", "A", "B"]);
    // A new one goes to the end.
    await addPlace("D");
    expect((await placesOf(cookie)).map((p) => p.name)).toEqual(["C", "A", "B", "D"]);
  });

  it("deletes a place with no balance at once; one with balances only when told to", async () => {
    const { id: userId, cookie, addPlace, setBalance } = await setUp();
    const empty = await addPlace("Empty");
    const bank = await addPlace("Bank");
    await setBalance(bank, 100_000);
    await setBalance(bank, 200_000);
    expect((await send("DELETE", `/api/places/${empty}`, undefined, cookie)).status).toBe(200);
    expect((await send("DELETE", `/api/places/${bank}`, undefined, cookie)).status).toBe(409);
    expect((await placesOf(cookie)).map((p) => p.name)).toEqual(["Bank"]);
    expect((await send("DELETE", `/api/places/${bank}?balances=delete`, undefined, cookie)).status).toBe(200);
    expect(await placesOf(cookie)).toEqual([]);
    const left = await env.DB.prepare("select count(*) as n from place_check where user_id = ?")
      .bind(userId)
      .first<{ n: number }>();
    expect(left?.n).toBe(0);
    expect((await send("DELETE", `/api/places/${bank}`, undefined, cookie)).status).toBe(404);
  });

  it("keeps at most 20 places", async () => {
    const { cookie, addPlace } = await setUp();
    for (let i = 0; i < 20; i++) await addPlace(`Place ${i}`);
    expect((await send("POST", "/api/places", { id: id(), name: "One more" }, cookie)).status).toBe(409);
  });

  it("changing places never takes Undo salary day away, and never touches free money's entries", async () => {
    const { cookie, addPlace, setBalance } = await setUp();
    const before = await (await call("/api/current", {}, cookie)).json<Record<string, unknown>>();
    const placeId = await addPlace("Bank");
    await setBalance(placeId, 100_000);
    const after = await (await call("/api/current", {}, cookie)).json<Record<string, unknown>>();
    expect({ ...after, places: [] }).toEqual(before);
  });
});
