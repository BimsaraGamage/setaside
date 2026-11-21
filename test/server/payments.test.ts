import { env } from "cloudflare:workers";
import { describe, expect, it } from "vitest";
import { addDays, suggestSalaryDay, todayIn } from "../../src/money";
import { call, signIn } from "./helpers";

const TZ = "Asia/Colombo";
const today = () => todayIn(TZ, Date.now());

/** A fresh demo user with first use done and one open Rs 36,000 rent. */
async function setUp(startedOn?: string) {
  const u = await signIn("second");
  for (const t of ["commitment_payment", "commitment", "spend", "income", "cycle", "settings"]) {
    await env.DB.prepare(`delete from "${t}" where user_id = ?`).bind(u.id).run();
  }
  const cycleId = crypto.randomUUID();
  const res = await call(
    "/api/first-use",
    {
      method: "POST",
      body: JSON.stringify({
        settingsId: crypto.randomUUID(),
        cycleId,
        incomeId: crypto.randomUUID(),
        salaryCurrency: "LKR",
        spendingCurrency: "LKR",
        homeTimeZone: TZ,
        usualPayDay: 25,
        heldMinor: 9_000_000,
        expectedSalaryOn: suggestSalaryDay(today(), 25),
      }),
    },
    u.cookie,
  );
  expect(res.status).toBe(201);
  if (startedOn) {
    await env.DB.prepare("update cycle set started_on = ? where id = ?").bind(startedOn, cycleId).run();
  }
  const rentId = crypto.randomUUID();
  const made = await call(
    "/api/commitments",
    {
      method: "POST",
      body: JSON.stringify({ id: rentId, name: "Rent", plannedMinor: 3_600_000, dueOn: today() }),
    },
    u.cookie,
  );
  expect(made.status).toBe(201);
  return { ...u, cycleId, rentId };
}

const send = (method: string, path: string, body: unknown, cookie: string) =>
  call(path, { method, body: body === undefined ? undefined : JSON.stringify(body) }, cookie);

interface Listed {
  id: string;
  state: string;
  payments: { id: string; amountMinor: number; currency: string; paidOn: string }[];
}

async function rentOf(cookie: string): Promise<Listed> {
  const cur = await (await call("/api/current", {}, cookie)).json<{ commitments: Listed[] }>();
  return cur.commitments[0]!;
}

const payment = (amountMinor: number, extra: Record<string, unknown> = {}) => ({
  id: crypto.randomUUID(),
  amountMinor,
  paidOn: today(),
  ...extra,
});

describe("paying a commitment (item 6, spec 3)", () => {
  it("pays in full and marks it finished in one write", async () => {
    const { cookie, rentId } = await setUp();
    const p = payment(3_600_000, { finish: true });
    const res = await send("POST", `/api/commitments/${rentId}/payments`, p, cookie);
    expect(res.status).toBe(201);
    expect(await rentOf(cookie)).toMatchObject({
      state: "finished",
      payments: [{ id: p.id, amountMinor: 3_600_000, currency: "LKR", paidOn: today() }],
    });
  });

  it("pays in parts and stays open; each payment is kept; Mark finished closes it", async () => {
    const { cookie, rentId } = await setUp(addDays(today(), -2));
    await send(
      "POST",
      `/api/commitments/${rentId}/payments`,
      payment(1_000_000, { paidOn: addDays(today(), -1) }),
      cookie,
    );
    await send("POST", `/api/commitments/${rentId}/payments`, payment(500_000), cookie);
    const listed = await rentOf(cookie);
    expect(listed.state).toBe("open");
    expect(listed.payments.map((p) => p.amountMinor)).toEqual([1_000_000, 500_000]);
    expect((await send("PATCH", `/api/commitments/${rentId}`, { state: "finished" }, cookie)).status).toBe(
      200,
    );
    expect((await rentOf(cookie)).state).toBe("finished");
  });

  it("allows paying more or less than planned", async () => {
    const { cookie, rentId } = await setUp();
    expect(
      (await send("POST", `/api/commitments/${rentId}/payments`, payment(4_000_000), cookie)).status,
    ).toBe(201);
    expect((await send("POST", `/api/commitments/${rentId}/payments`, payment(1), cookie)).status).toBe(201);
  });

  it("a finished one takes no more payments until it is reopened", async () => {
    const { cookie, rentId } = await setUp();
    await send("POST", `/api/commitments/${rentId}/payments`, payment(3_000_000, { finish: true }), cookie);
    const more = await send("POST", `/api/commitments/${rentId}/payments`, payment(1), cookie);
    expect(more.status).toBe(409);
    expect(await more.json()).toEqual({ error: "not_open" });
    expect((await send("PATCH", `/api/commitments/${rentId}`, { state: "open" }, cookie)).status).toBe(200);
    expect((await send("POST", `/api/commitments/${rentId}/payments`, payment(1), cookie)).status).toBe(201);
  });

  it("refuses an amount at zero or below, a day after today or before the cycle, and bad bodies", async () => {
    const { cookie, rentId } = await setUp();
    const res = await send(
      "POST",
      `/api/commitments/${rentId}/payments`,
      payment(0, { paidOn: addDays(today(), 1) }),
      cookie,
    );
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "invalid", problems: ["amount", "paid_on"] });
    const before = payment(5, { paidOn: addDays(today(), -1) });
    expect((await send("POST", `/api/commitments/${rentId}/payments`, before, cookie)).status).toBe(400);
    expect(
      (await send("POST", `/api/commitments/${rentId}/payments`, { ...payment(5), id: "x" }, cookie)).status,
    ).toBe(400);
    expect((await send("PATCH", `/api/commitments/${rentId}`, { state: "dropped" }, cookie)).status).toBe(
      400,
    );
    expect((await rentOf(cookie)).payments).toEqual([]);
  });

  it("refuses a payment id already in use, and an unknown commitment", async () => {
    const { cookie, rentId } = await setUp();
    const p = payment(100);
    expect((await send("POST", `/api/commitments/${rentId}/payments`, p, cookie)).status).toBe(201);
    // Saved once (item 24): a resend is answered as saved and changes nothing, finish included.
    const again = await send("POST", `/api/commitments/${rentId}/payments`, { ...p, finish: true }, cookie);
    expect(again.status).toBe(200);
    expect(await again.json()).toMatchObject({ ok: true, already: true });
    expect(await rentOf(cookie)).toMatchObject({ state: "open", payments: [{ id: p.id }] });
    const missing = await send(
      "POST",
      `/api/commitments/${crypto.randomUUID()}/payments`,
      payment(1),
      cookie,
    );
    expect(missing.status).toBe(404);
  });

  it("a resent pay-and-finish is saved once, though its commitment is finished now (item 24)", async () => {
    const { cookie, rentId } = await setUp();
    const p = payment(3_600_000, { finish: true });
    expect((await send("POST", `/api/commitments/${rentId}/payments`, p, cookie)).status).toBe(201);
    expect((await send("POST", `/api/commitments/${rentId}/payments`, p, cookie)).status).toBe(200);
    expect((await rentOf(cookie)).payments).toHaveLength(1);
    // The same id sent for another commitment is not the same payment.
    const gymId = crypto.randomUUID();
    const gym = { id: gymId, name: "Gym", plannedMinor: 500_000, dueOn: today() };
    expect((await send("POST", "/api/commitments", gym, cookie)).status).toBe(201);
    const elsewhere = await send("POST", `/api/commitments/${gymId}/payments`, p, cookie);
    expect(elsewhere.status).toBe(409);
    expect(await elsewhere.json()).toEqual({ error: "conflict" });
  });

  it("edits a payment's amount and day, checked like a new one", async () => {
    const { cookie, rentId } = await setUp(addDays(today(), -3));
    const p = payment(1_000_000);
    await send("POST", `/api/commitments/${rentId}/payments`, p, cookie);
    const res = await send(
      "PATCH",
      `/api/payments/${p.id}`,
      { amountMinor: 1_200_000, paidOn: addDays(today(), -3) },
      cookie,
    );
    expect(res.status).toBe(200);
    expect((await rentOf(cookie)).payments).toMatchObject([
      { amountMinor: 1_200_000, paidOn: addDays(today(), -3) },
    ]);
    expect(
      (await send("PATCH", `/api/payments/${p.id}`, { paidOn: addDays(today(), 1) }, cookie)).status,
    ).toBe(400);
    expect(
      (await send("PATCH", `/api/payments/${crypto.randomUUID()}`, { amountMinor: 1 }, cookie)).status,
    ).toBe(404);
  });

  it("deletes a payment for real; undo adds it back with the same id", async () => {
    const { cookie, rentId } = await setUp();
    const p = payment(1_000_000);
    await send("POST", `/api/commitments/${rentId}/payments`, p, cookie);
    expect((await send("DELETE", `/api/payments/${p.id}`, undefined, cookie)).status).toBe(200);
    expect((await rentOf(cookie)).payments).toEqual([]);
    expect((await send("DELETE", `/api/payments/${p.id}`, undefined, cookie)).status).toBe(404);
    expect((await send("POST", `/api/commitments/${rentId}/payments`, p, cookie)).status).toBe(201);
    expect((await rentOf(cookie)).payments).toHaveLength(1);
  });

  it("deleting a payment of a finished commitment reopens it, so it is set aside again (SAB-57)", async () => {
    const { cookie, rentId } = await setUp();
    const p = payment(3_600_000, { finish: true });
    await send("POST", `/api/commitments/${rentId}/payments`, p, cookie);
    expect((await rentOf(cookie)).state).toBe("finished");
    expect((await send("DELETE", `/api/payments/${p.id}`, undefined, cookie)).status).toBe(200);
    expect(await rentOf(cookie)).toMatchObject({ state: "open", payments: [] });
    // Undo: the payment back, finished again in the same write.
    expect((await send("POST", `/api/commitments/${rentId}/payments`, p, cookie)).status).toBe(201);
    expect(await rentOf(cookie)).toMatchObject({ state: "finished", payments: [{ id: p.id }] });
  });

  it("deleting a commitment deletes its payments", async () => {
    const { cookie, rentId } = await setUp();
    const p = payment(1_000_000);
    await send("POST", `/api/commitments/${rentId}/payments`, p, cookie);
    expect((await send("DELETE", `/api/commitments/${rentId}`, undefined, cookie)).status).toBe(200);
    const row = await env.DB.prepare("select id from commitment_payment where id = ?").bind(p.id).first();
    expect(row).toBeNull();
  });

  it("an ended cycle is locked: no new, changed or deleted payments", async () => {
    const { cookie, id: userId, rentId } = await setUp(addDays(today(), -5));
    const p = payment(1_000_000);
    await send("POST", `/api/commitments/${rentId}/payments`, p, cookie);
    const now = Date.now();
    await env.DB.prepare(
      "insert into cycle (id, user_id, started_on, expected_salary_on, created_at, updated_at) values (?, ?, ?, ?, ?, ?)",
    )
      .bind(crypto.randomUUID(), userId, today(), addDays(today(), 30), now, now)
      .run();
    expect((await send("POST", `/api/commitments/${rentId}/payments`, payment(1), cookie)).status).toBe(409);
    expect((await send("PATCH", `/api/payments/${p.id}`, { amountMinor: 5 }, cookie)).status).toBe(409);
    expect((await send("DELETE", `/api/payments/${p.id}`, undefined, cookie)).status).toBe(409);
    expect((await send("PATCH", `/api/commitments/${rentId}`, { state: "finished" }, cookie)).status).toBe(
      409,
    );
    const row = await env.DB.prepare("select amount_minor from commitment_payment where id = ?")
      .bind(p.id)
      .first();
    expect(row).toEqual({ amount_minor: 1_000_000 });
  });
});
