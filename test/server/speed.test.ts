import { env } from "cloudflare:workers";
import { describe, expect, it } from "vitest";
import { addDays, suggestSalaryDay, todayIn } from "../../src/money";
import { call, signIn } from "./helpers";

// Item 8 · Spending speed and verdict: the one-off mark and last cycle's speed (spec 7).

const TZ = "Asia/Colombo";
const today = () => todayIn(TZ, Date.now());

/** A fresh user with first use done today: Rs 90,000 held, no pots. */
async function setUp() {
  const u = await signIn("second");
  for (const t of ["spend", "pot_allocation", "pot", "income", "cycle", "settings"]) {
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
  return { ...u, cycleId };
}

const send = (method: string, path: string, body: unknown, cookie: string) =>
  call(path, { method, body: JSON.stringify(body) }, cookie);

interface Current {
  spends: { id: string; oneOff: boolean }[];
  lastCycle: { speed: { totalMinor: number; days: number }; pots: Record<string, unknown> } | null;
}
const current = async (cookie: string) => (await call("/api/current", {}, cookie)).json<Current>();

describe("one-off spends (item 8, spec 7)", () => {
  it("a spend can be saved as one-off; it is not one-off unless asked", async () => {
    const { cookie } = await setUp();
    const a = crypto.randomUUID();
    const b = crypto.randomUUID();
    await send("POST", "/api/spends", { id: a, spentOn: today(), amountMinor: 100, oneOff: true }, cookie);
    await send("POST", "/api/spends", { id: b, spentOn: today(), amountMinor: 100 }, cookie);
    const { spends } = await current(cookie);
    expect(spends.find((s) => s.id === a)?.oneOff).toBe(true);
    expect(spends.find((s) => s.id === b)?.oneOff).toBe(false);
  });

  it("can be set or undone at any time, leaving the rest of the spend as it was", async () => {
    const { cookie } = await setUp();
    const id = crypto.randomUUID();
    await send("POST", "/api/spends", { id, spentOn: today(), amountMinor: 100, note: "tv" }, cookie);
    expect((await send("PATCH", `/api/spends/${id}`, { oneOff: true }, cookie)).status).toBe(200);
    expect((await current(cookie)).spends).toMatchObject([
      { id, oneOff: true, note: "tv", amountMinor: 100 },
    ]);
    await send("PATCH", `/api/spends/${id}`, { oneOff: false }, cookie);
    expect((await current(cookie)).spends).toMatchObject([{ id, oneOff: false }]);
  });

  it("refuses a one-off mark that is not true or false", async () => {
    const { cookie } = await setUp();
    const res = await send(
      "POST",
      "/api/spends",
      { id: crypto.randomUUID(), spentOn: today(), amountMinor: 100, oneOff: "yes" },
      cookie,
    );
    expect(res.status).toBe(400);
  });
});

describe("last cycle's speed (item 8, spec 7)", () => {
  it("none on the very first cycle", async () => {
    const { cookie } = await setUp();
    expect((await current(cookie)).lastCycle).toBeNull();
  });

  it("is the whole ended cycle's speed: one-offs and pot spends left out, the part past a pot counted", async () => {
    const { cookie, id: userId, cycleId } = await setUp();
    // The cycle before this one: 10 days, ending the day before this one started.
    const started = today();
    const lastId = crypto.randomUUID();
    const potId = crypto.randomUUID();
    const now = Date.now();
    const db = env.DB;
    await db.batch([
      db
        .prepare(
          "insert into cycle (id, user_id, started_on, expected_salary_on, created_at, updated_at) values (?, ?, ?, ?, ?, ?)",
        )
        .bind(lastId, userId, addDays(started, -10), started, now - 1000, now - 1000),
      db
        .prepare(
          "insert into pot (id, user_id, name, currency, usual_amount_minor, archived, created_at, updated_at) values (?, ?, 'Groceries', 'LKR', 500000, 0, ?, ?)",
        )
        .bind(potId, userId, now, now),
      db
        .prepare(
          "insert into pot_allocation (id, user_id, pot_id, cycle_id, amount_minor, created_at, updated_at) values (?, ?, ?, ?, 500000, ?, ?)",
        )
        .bind(crypto.randomUUID(), userId, potId, lastId, now, now),
      ...[
        [3_000_000, null, 0],
        [9_000_000, null, 1],
        [800_000, potId, 0],
      ].map(([amount, pot, oneOff]) =>
        db
          .prepare(
            "insert into spend (id, user_id, cycle_id, spent_on, amount_minor, currency, pot_id, one_off, created_at, updated_at) values (?, ?, ?, ?, ?, 'LKR', ?, ?, ?, ?)",
          )
          .bind(crypto.randomUUID(), userId, lastId, addDays(started, -5), amount, pot, oneOff, now, now),
      ),
    ]);
    // This cycle's own spends do not change last cycle's speed.
    await send(
      "POST",
      "/api/spends",
      { id: crypto.randomUUID(), spentOn: today(), amountMinor: 100 },
      cookie,
    );
    const cur = await current(cookie);
    expect(cur.lastCycle).toEqual({
      speed: { totalMinor: 3_300_000, days: 10 },
      pots: { [potId]: { totalMinor: 800_000, days: 10 } },
    });
    expect(cycleId).not.toBe(lastId);
  });
});
