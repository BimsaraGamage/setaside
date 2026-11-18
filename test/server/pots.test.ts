import { env } from "cloudflare:workers";
import { describe, expect, it } from "vitest";
import { suggestSalaryDay, todayIn } from "../../src/money";
import { call, signIn } from "./helpers";

const TZ = "Asia/Colombo";
const today = () => todayIn(TZ, Date.now());

/** A fresh demo user with first use done today: Rs 90,000 held, no pots. */
async function setUp(user: "second" | "demo" = "second") {
  const u = await signIn(user);
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
  call(path, { method, body: body === undefined ? undefined : JSON.stringify(body) }, cookie);

interface Listed {
  pots: {
    id: string;
    name: string;
    currency: string;
    usualAmountMinor: number;
    archived: boolean;
    amountMinor: number | null;
  }[];
  spends: { id: string; potId: string | null }[];
}

const listed = async (cookie: string) => (await call("/api/current", {}, cookie)).json<Listed>();

const newPot = (name = "Groceries", amountMinor = 1_800_000) => ({
  id: crypto.randomUUID(),
  allocationId: crypto.randomUUID(),
  name,
  usualAmountMinor: amountMinor,
  amountMinor,
});

const newSpend = (potId: string | null, amountMinor = 250_000) => ({
  id: crypto.randomUUID(),
  spentOn: today(),
  amountMinor,
  potId,
});

describe("pots (item 7, spec 4)", () => {
  it("a new pot and its amount this cycle are saved and listed", async () => {
    const { cookie } = await setUp();
    const p = newPot("  Groceries ");
    expect((await send("POST", "/api/pots", p, cookie)).status).toBe(201);
    expect((await listed(cookie)).pots).toEqual([
      {
        id: p.id,
        name: "Groceries",
        currency: "LKR",
        usualAmountMinor: 1_800_000,
        archived: false,
        amountMinor: 1_800_000,
      },
    ]);
  });

  it("refuses a pot with no name or a negative amount", async () => {
    const { cookie } = await setUp();
    const res = await send("POST", "/api/pots", { ...newPot(" "), amountMinor: -1 }, cookie);
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "invalid", problems: ["name", "amount"] });
  });

  it("refuses an id already in use", async () => {
    const { cookie } = await setUp();
    const p = newPot();
    await send("POST", "/api/pots", p, cookie);
    expect((await send("POST", "/api/pots", p, cookie)).status).toBe(409);
  });

  it("renames, changes the usual amount and this cycle's amount", async () => {
    const { cookie } = await setUp();
    const p = newPot();
    await send("POST", "/api/pots", p, cookie);
    const res = await send(
      "PATCH",
      `/api/pots/${p.id}`,
      { name: "Food", usualAmountMinor: 2_000_000, amountMinor: 1_500_000 },
      cookie,
    );
    expect(res.status).toBe(200);
    expect((await listed(cookie)).pots[0]).toMatchObject({
      name: "Food",
      usualAmountMinor: 2_000_000,
      amountMinor: 1_500_000,
    });
  });

  it("a pot with no amount this cycle gets one with the given allocation id", async () => {
    const { cookie, id } = await setUp();
    const p = newPot();
    await send("POST", "/api/pots", p, cookie);
    await env.DB.prepare("delete from pot_allocation where user_id = ?").bind(id).run();
    expect((await listed(cookie)).pots[0]?.amountMinor).toBeNull();
    // Without an allocation id there is nothing to make it with.
    expect((await send("PATCH", `/api/pots/${p.id}`, { amountMinor: 5 }, cookie)).status).toBe(400);
    const res = await send(
      "PATCH",
      `/api/pots/${p.id}`,
      { amountMinor: 700_000, allocationId: crypto.randomUUID() },
      cookie,
    );
    expect(res.status).toBe(200);
    expect((await listed(cookie)).pots[0]?.amountMinor).toBe(700_000);
  });

  it("Stop using this pot and use it again", async () => {
    const { cookie } = await setUp();
    const p = newPot();
    await send("POST", "/api/pots", p, cookie);
    await send("PATCH", `/api/pots/${p.id}`, { archived: true }, cookie);
    expect((await listed(cookie)).pots[0]?.archived).toBe(true);
    await send("PATCH", `/api/pots/${p.id}`, { archived: false }, cookie);
    expect((await listed(cookie)).pots[0]?.archived).toBe(false);
  });

  it("deletes a pot with no spends, with its amount", async () => {
    const { cookie, id } = await setUp();
    const p = newPot();
    await send("POST", "/api/pots", p, cookie);
    expect((await send("DELETE", `/api/pots/${p.id}`, undefined, cookie)).status).toBe(200);
    expect((await listed(cookie)).pots).toEqual([]);
    const left = await env.DB.prepare("select count(*) as n from pot_allocation where user_id = ?")
      .bind(id)
      .first<{ n: number }>();
    expect(left?.n).toBe(0);
  });

  it("will not delete a pot that has spends: stop using it instead", async () => {
    const { cookie } = await setUp();
    const p = newPot();
    await send("POST", "/api/pots", p, cookie);
    await send("POST", "/api/spends", newSpend(p.id), cookie);
    const res = await send("DELETE", `/api/pots/${p.id}`, undefined, cookie);
    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({ error: "has_spends" });
  });

  it("will not delete a pot with an amount in an ended cycle", async () => {
    const { cookie, id, cycleId } = await setUp();
    const p = newPot();
    await send("POST", "/api/pots", p, cookie);
    // A newer cycle ends the first one.
    const now = Date.now();
    await env.DB.prepare(
      "insert into cycle (id, user_id, started_on, expected_salary_on, created_at, updated_at) values (?, ?, ?, '2999-01-01', ?, ?)",
    )
      .bind(crypto.randomUUID(), id, today(), now + 1, now + 1)
      .run();
    expect(cycleId).toBeTruthy();
    const res = await send("DELETE", `/api/pots/${p.id}`, undefined, cookie);
    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({ error: "locked" });
  });
});

describe("a spend's pot (item 7, spec 4)", () => {
  it("a spend can come from a pot and be moved back to free money", async () => {
    const { cookie } = await setUp();
    const p = newPot();
    await send("POST", "/api/pots", p, cookie);
    const s = newSpend(p.id);
    expect((await send("POST", "/api/spends", s, cookie)).status).toBe(201);
    expect((await listed(cookie)).spends).toMatchObject([{ id: s.id, potId: p.id }]);
    await send("PATCH", `/api/spends/${s.id}`, { potId: null }, cookie);
    expect((await listed(cookie)).spends).toMatchObject([{ id: s.id, potId: null }]);
  });

  it("refuses a stopped pot for a new spend, but a spend already in it keeps it", async () => {
    const { cookie } = await setUp();
    const p = newPot();
    await send("POST", "/api/pots", p, cookie);
    const s = newSpend(p.id);
    await send("POST", "/api/spends", s, cookie);
    await send("PATCH", `/api/pots/${p.id}`, { archived: true }, cookie);
    const refused = await send("POST", "/api/spends", newSpend(p.id), cookie);
    expect(refused.status).toBe(400);
    expect(await refused.json()).toEqual({ error: "invalid", problems: ["pot"] });
    expect((await send("PATCH", `/api/spends/${s.id}`, { amountMinor: 1_000 }, cookie)).status).toBe(200);
  });

  it("a spend leaving a stopped pot can move to a pot in use, but not back", async () => {
    const { cookie } = await setUp();
    const stopped = newPot();
    const inUse = newPot();
    await send("POST", "/api/pots", stopped, cookie);
    await send("POST", "/api/pots", inUse, cookie);
    const s = newSpend(stopped.id);
    await send("POST", "/api/spends", s, cookie);
    await send("PATCH", `/api/pots/${stopped.id}`, { archived: true }, cookie);
    expect((await send("PATCH", `/api/spends/${s.id}`, { potId: inUse.id }, cookie)).status).toBe(200);
    expect((await listed(cookie)).spends).toMatchObject([{ id: s.id, potId: inUse.id }]);
    const back = await send("PATCH", `/api/spends/${s.id}`, { potId: stopped.id }, cookie);
    expect(back.status).toBe(400);
    expect(await back.json()).toEqual({ error: "invalid", problems: ["pot"] });
  });

  it("refuses another user's pot", async () => {
    const other = await setUp("demo");
    const theirs = newPot();
    await send("POST", "/api/pots", theirs, other.cookie);
    const { cookie } = await setUp();
    const res = await send("POST", "/api/spends", newSpend(theirs.id), cookie);
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "invalid", problems: ["pot"] });
  });
});
