import { env } from "cloudflare:workers";
import { describe, expect, it } from "vitest";
import { suggestSalaryDay, todayIn } from "../../src/money";
import { call, signIn } from "./helpers";

// Paid in the other currency (item 17, spec 8): salary in dollars, spending in rupees.

const TZ = "Asia/Colombo";
const today = () => todayIn(TZ, Date.now());
const id = () => crypto.randomUUID();

interface Listed {
  id: string;
  state: string;
  payments: {
    id: string;
    amountMinor: number;
    currency: string;
    coversMinor: number | null;
    paidOn: string;
  }[];
}

const send = (method: string, path: string, body: unknown, cookie: string) =>
  call(path, { method, body: body === undefined ? undefined : JSON.stringify(body) }, cookie);
const commitmentOf = async (cookie: string, cid: string) =>
  (await (await call("/api/current", {}, cookie)).json<{ commitments: Listed[] }>()).commitments.find(
    (k) => k.id === cid,
  )!;

/** A fresh user: Rs 90,000 and $1,000 held, Rs 300 a dollar, one $20 bill. */
async function setUp() {
  const u = await signIn("second");
  for (const t of ["recurring_commitment", "pot", "cycle", "counting_rate", "prepayment", "settings"]) {
    await env.DB.prepare(`delete from "${t}" where user_id = ?`).bind(u.id).run();
  }
  const res = await send(
    "POST",
    "/api/first-use",
    {
      settingsId: id(),
      cycleId: id(),
      incomeId: id(),
      salaryIncomeId: id(),
      countingRateId: id(),
      salaryCurrency: "USD",
      spendingCurrency: "LKR",
      homeTimeZone: TZ,
      usualPayDay: 25,
      heldMinor: 9_000_000,
      heldSalaryMinor: 100_000,
      countingRate: "300",
      expectedSalaryOn: suggestSalaryDay(today(), 25),
      commitments: [],
      pots: [],
    },
    u.cookie,
  );
  expect(res.status).toBe(201);
  const make = async (body: Record<string, unknown>) => {
    const cid = id();
    const r = await send("POST", "/api/commitments", { id: cid, dueOn: today(), ...body }, u.cookie);
    expect(r.status).toBe(201);
    return cid;
  };
  const billId = await make({ name: "Domain", currency: "USD", plannedMinor: 2_000 });
  return { ...u, billId, make };
}

describe("paid in the other currency (item 17, spec 8)", () => {
  it("a dollar bill paid in rupees keeps what it covers at the counting rate", async () => {
    const { cookie, billId } = await setUp();
    const p = { id: id(), amountMinor: 610_000, currency: "LKR", paidOn: today(), finish: true };
    expect((await send("POST", `/api/commitments/${billId}/payments`, p, cookie)).status).toBe(201);
    expect(await commitmentOf(cookie, billId)).toMatchObject({
      state: "finished",
      payments: [{ id: p.id, amountMinor: 610_000, currency: "LKR", coversMinor: 2_033, paidOn: today() }],
    });
  });

  it("a payment in the commitment's own currency keeps no cover", async () => {
    const { cookie, billId } = await setUp();
    const p = { id: id(), amountMinor: 1_000, paidOn: today() };
    expect((await send("POST", `/api/commitments/${billId}/payments`, p, cookie)).status).toBe(201);
    expect((await commitmentOf(cookie, billId)).payments).toMatchObject([
      { currency: "USD", amountMinor: 1_000, coversMinor: null },
    ]);
  });

  it("a rupee bill paid in dollars covers rupees", async () => {
    const { cookie, make } = await setUp();
    const rent = await make({ name: "Rent", currency: "LKR", plannedMinor: 3_000_000 });
    const p = { id: id(), amountMinor: 5_000, currency: "USD", paidOn: today() };
    expect((await send("POST", `/api/commitments/${rent}/payments`, p, cookie)).status).toBe(201);
    expect((await commitmentOf(cookie, rent)).payments).toMatchObject([
      { currency: "USD", amountMinor: 5_000, coversMinor: 1_500_000 },
    ]);
  });

  it("a savings set-aside takes only its own currency; a third currency is refused", async () => {
    const { cookie, billId, make } = await setUp();
    const saving = await make({ name: "Save", kind: "savings", currency: "USD", plannedMinor: 10_000 });
    const bad = { id: id(), amountMinor: 300_000, currency: "LKR", paidOn: today() };
    const res = await send("POST", `/api/commitments/${saving}/payments`, bad, cookie);
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "invalid", problems: ["currency"] });
    const eur = await send(
      "POST",
      `/api/commitments/${billId}/payments`,
      { ...bad, currency: "EUR" },
      cookie,
    );
    expect(eur.status).toBe(400);
  });

  it("changing the amount covers again at today's counting rate; changing only the date keeps the cover", async () => {
    const { cookie, billId } = await setUp();
    const pid = id();
    const p = { id: pid, amountMinor: 300_000, currency: "LKR", paidOn: today() };
    await send("POST", `/api/commitments/${billId}/payments`, p, cookie);
    expect((await send("POST", "/api/counting-rates", { id: id(), rate: "250" }, cookie)).status).toBe(201);
    expect((await send("PATCH", `/api/payments/${pid}`, { paidOn: today() }, cookie)).status).toBe(200);
    expect((await commitmentOf(cookie, billId)).payments[0]!.coversMinor).toBe(1_000);
    expect((await send("PATCH", `/api/payments/${pid}`, { amountMinor: 500_000 }, cookie)).status).toBe(200);
    expect((await commitmentOf(cookie, billId)).payments[0]).toMatchObject({
      amountMinor: 500_000,
      coversMinor: 2_000,
    });
    expect(
      (await send("PATCH", `/api/payments/${pid}`, { currency: "USD", amountMinor: 900 }, cookie)).status,
    ).toBe(200);
    expect((await commitmentOf(cookie, billId)).payments[0]).toMatchObject({
      currency: "USD",
      coversMinor: null,
    });
  });
});
