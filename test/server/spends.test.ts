import { env } from "cloudflare:workers";
import { describe, expect, it } from "vitest";
import { addDays, suggestSalaryDay, todayIn } from "../../src/money";
import { call, signIn } from "./helpers";

const TZ = "Asia/Colombo";
const today = () => todayIn(TZ, Date.now());

/** A fresh demo user with first use done today: Rs 90,000 held. */
async function setUp(startedOn?: string) {
  const u = await signIn("second");
  for (const t of ["spend", "income", "cycle", "settings"]) {
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
  return { ...u, cycleId };
}

const send = (method: string, path: string, body: unknown, cookie: string) =>
  call(path, { method, body: body === undefined ? undefined : JSON.stringify(body) }, cookie);

async function spendsOf(cookie: string) {
  const cur = await (await call("/api/current", {}, cookie)).json<{ spends: unknown[] }>();
  return cur.spends;
}

describe("spends (item 4, spec 7)", () => {
  it("adds a spend to the current cycle, in the spending currency, and lists it", async () => {
    const { cookie, cycleId } = await setUp();
    const id = crypto.randomUUID();
    const res = await send(
      "POST",
      "/api/spends",
      { id, spentOn: today(), amountMinor: 185_000, note: " lunch " },
      cookie,
    );
    expect(res.status).toBe(201);
    expect(await res.json()).toEqual({ ok: true, cycleId });
    expect(await spendsOf(cookie)).toEqual([
      {
        id,
        spentOn: today(),
        currency: "LKR",
        amountMinor: 185_000,
        note: "lunch",
        potId: null,
        cardId: null,
        oneOff: false,
      },
    ]);
  });

  it("saves no note when it is empty", async () => {
    const { cookie } = await setUp();
    const id = crypto.randomUUID();
    await send("POST", "/api/spends", { id, spentOn: today(), amountMinor: 100, note: "  " }, cookie);
    expect(await spendsOf(cookie)).toMatchObject([{ id, note: null }]);
  });

  it("can be dated back within the current cycle only, never ahead", async () => {
    const { cookie } = await setUp(addDays(today(), -3));
    const ok = await send(
      "POST",
      "/api/spends",
      { id: crypto.randomUUID(), spentOn: addDays(today(), -3), amountMinor: 100 },
      cookie,
    );
    expect(ok.status).toBe(201);
    for (const spentOn of [addDays(today(), -4), addDays(today(), 1)]) {
      const res = await send(
        "POST",
        "/api/spends",
        { id: crypto.randomUUID(), spentOn, amountMinor: 100 },
        cookie,
      );
      expect(res.status).toBe(400);
      expect(await res.json()).toEqual({ error: "invalid", problems: ["spent_on"] });
    }
    expect(await spendsOf(cookie)).toHaveLength(1);
  });

  it("refuses amounts at zero or below, and bad bodies", async () => {
    const { cookie } = await setUp();
    const zero = await send(
      "POST",
      "/api/spends",
      { id: crypto.randomUUID(), spentOn: today(), amountMinor: 0 },
      cookie,
    );
    expect(await zero.json()).toEqual({ error: "invalid", problems: ["amount"] });
    const bad = await send("POST", "/api/spends", { id: "x", spentOn: today(), amountMinor: 1 }, cookie);
    expect(bad.status).toBe(400);
    expect(await spendsOf(cookie)).toEqual([]);
  });

  it("a resent spend (same id) is saved once (item 24, spec 11)", async () => {
    const { cookie } = await setUp();
    const b = { id: crypto.randomUUID(), spentOn: today(), amountMinor: 100 };
    expect((await send("POST", "/api/spends", b, cookie)).status).toBe(201);
    const again = await send("POST", "/api/spends", { ...b, amountMinor: 999 }, cookie);
    expect(again.status).toBe(200);
    expect(await again.json()).toMatchObject({ ok: true, already: true });
    expect(await spendsOf(cookie)).toMatchObject([{ amountMinor: 100 }]);
  });

  it("another user's spend id is refused, never treated as saved", async () => {
    const other = await signIn("demo");
    const { cookie } = await setUp();
    const b = { id: crypto.randomUUID(), spentOn: today(), amountMinor: 100 };
    expect((await send("POST", "/api/spends", b, cookie)).status).toBe(201);
    const theirs = await send("POST", "/api/spends", b, other.cookie);
    expect([404, 409]).toContain(theirs.status);
    expect(await theirs.json()).not.toMatchObject({ ok: true });
  });

  it("an unsent spend sent after its cycle ended moves to the current cycle's first day (item 24)", async () => {
    const { cookie } = await setUp(addDays(today(), -2));
    const b = { id: crypto.randomUUID(), spentOn: addDays(today(), -5), amountMinor: 100, queued: true };
    const res = await send("POST", "/api/spends", b, cookie);
    expect(res.status).toBe(201);
    expect(await res.json()).toMatchObject({ ok: true, movedFrom: addDays(today(), -5) });
    expect(await spendsOf(cookie)).toMatchObject([{ id: b.id, spentOn: addDays(today(), -2) }]);
    // Not from the queue: refused as before.
    const live = { ...b, id: crypto.randomUUID(), queued: undefined };
    expect((await send("POST", "/api/spends", live, cookie)).status).toBe(400);
  });

  it("needs first use done", async () => {
    const u = await signIn("second");
    for (const t of ["spend", "income", "cycle", "settings"]) {
      await env.DB.prepare(`delete from "${t}" where user_id = ?`).bind(u.id).run();
    }
    const res = await send(
      "POST",
      "/api/spends",
      { id: crypto.randomUUID(), spentOn: today(), amountMinor: 1 },
      u.cookie,
    );
    expect(res.status).toBe(404);
  });

  it("edits a spend: amount, date and note, checked like a new one", async () => {
    const { cookie } = await setUp(addDays(today(), -2));
    const id = crypto.randomUUID();
    await send("POST", "/api/spends", { id, spentOn: today(), amountMinor: 100, note: "tea" }, cookie);
    const res = await send(
      "PATCH",
      `/api/spends/${id}`,
      { amountMinor: 250_000, spentOn: addDays(today(), -1), note: "" },
      cookie,
    );
    expect(res.status).toBe(200);
    expect(await spendsOf(cookie)).toEqual([
      {
        id,
        spentOn: addDays(today(), -1),
        currency: "LKR",
        amountMinor: 250_000,
        note: null,
        potId: null,
        cardId: null,
        oneOff: false,
      },
    ]);
    const ahead = await send("PATCH", `/api/spends/${id}`, { spentOn: addDays(today(), 1) }, cookie);
    expect(ahead.status).toBe(400);
    const missing = await send("PATCH", `/api/spends/${crypto.randomUUID()}`, { amountMinor: 1 }, cookie);
    expect(missing.status).toBe(404);
  });

  it("deletes a spend for real; undo adds it back with the same id", async () => {
    const { cookie } = await setUp();
    const b = { id: crypto.randomUUID(), spentOn: today(), amountMinor: 100, note: "tea" };
    await send("POST", "/api/spends", b, cookie);
    expect((await send("DELETE", `/api/spends/${b.id}`, undefined, cookie)).status).toBe(200);
    expect(await spendsOf(cookie)).toEqual([]);
    expect((await send("DELETE", `/api/spends/${b.id}`, undefined, cookie)).status).toBe(404);
    expect((await send("POST", "/api/spends", b, cookie)).status).toBe(201);
    expect(await spendsOf(cookie)).toHaveLength(1);
  });

  it("an ended cycle is locked: its spends can't be changed or deleted", async () => {
    const { cookie, id: userId, cycleId } = await setUp(addDays(today(), -5));
    const id = crypto.randomUUID();
    await send("POST", "/api/spends", { id, spentOn: today(), amountMinor: 100 }, cookie);
    // A newer cycle starts (salary day comes with item 11).
    const now = Date.now();
    await env.DB.prepare(
      "insert into cycle (id, user_id, started_on, expected_salary_on, created_at, updated_at) values (?, ?, ?, ?, ?, ?)",
    )
      .bind(crypto.randomUUID(), userId, today(), addDays(today(), 30), now, now)
      .run();
    expect((await send("PATCH", `/api/spends/${id}`, { amountMinor: 5 }, cookie)).status).toBe(409);
    expect((await send("DELETE", `/api/spends/${id}`, undefined, cookie)).status).toBe(409);
    const row = await env.DB.prepare("select amount_minor, cycle_id from spend where id = ?")
      .bind(id)
      .first();
    expect(row).toEqual({ amount_minor: 100, cycle_id: cycleId });
  });
});
