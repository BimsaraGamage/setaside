import { env } from "cloudflare:workers";
import { describe, expect, it } from "vitest";
import { addDays, suggestSalaryDay, todayIn } from "../../src/money";
import { call, signIn } from "./helpers";

const TZ = "Asia/Colombo";
const today = () => todayIn(TZ, Date.now());

/** A fresh demo user with first use done today: Rs 90,000 held. */
async function setUp(startedOn?: string) {
  const u = await signIn("second");
  for (const t of ["commitment", "spend", "income", "cycle", "settings"]) {
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

async function commitmentsOf(cookie: string) {
  const cur = await (await call("/api/current", {}, cookie)).json<{ commitments: unknown[] }>();
  return cur.commitments;
}

const rent = () => ({ id: crypto.randomUUID(), name: " Rent ", plannedMinor: 3_600_000, dueOn: today() });

describe("commitments (item 5, spec 3)", () => {
  it("adds a bill to the current cycle, in the spending currency, and lists it", async () => {
    const { cookie, cycleId } = await setUp();
    const b = rent();
    const res = await send("POST", "/api/commitments", b, cookie);
    expect(res.status).toBe(201);
    expect(await res.json()).toEqual({ ok: true, cycleId });
    expect(await commitmentsOf(cookie)).toEqual([
      {
        id: b.id,
        name: "Rent",
        kind: "bill",
        currency: "LKR",
        plannedMinor: 3_600_000,
        dueOn: today(),
        state: "open",
        recurringId: null,
        carriedFromId: null,
        prepaymentId: null,
        cardId: null,
        planId: null,
        payments: [],
      },
    ]);
  });

  it("lists them by due day", async () => {
    const { cookie } = await setUp();
    const later = { ...rent(), name: "Water", dueOn: addDays(today(), 3) };
    const sooner = { ...rent(), name: "Phone", dueOn: addDays(today(), 1) };
    await send("POST", "/api/commitments", later, cookie);
    await send("POST", "/api/commitments", sooner, cookie);
    expect(await commitmentsOf(cookie)).toMatchObject([{ name: "Phone" }, { name: "Water" }]);
  });

  it("can be due after the expected salary day (coming up only) but not before the cycle started", async () => {
    const { cookie } = await setUp(addDays(today(), -3));
    const ahead = { ...rent(), dueOn: addDays(today(), 60) };
    expect((await send("POST", "/api/commitments", ahead, cookie)).status).toBe(201);
    const back = { ...rent(), dueOn: addDays(today(), -3) };
    expect((await send("POST", "/api/commitments", back, cookie)).status).toBe(201);
    const before = await send("POST", "/api/commitments", { ...rent(), dueOn: addDays(today(), -4) }, cookie);
    expect(before.status).toBe(400);
    expect(await before.json()).toEqual({ error: "invalid", problems: ["due_on"] });
    expect(await commitmentsOf(cookie)).toHaveLength(2);
  });

  it("refuses an empty name, amounts at zero or below, and bad bodies", async () => {
    const { cookie } = await setUp();
    const res = await send("POST", "/api/commitments", { ...rent(), name: "  ", plannedMinor: 0 }, cookie);
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "invalid", problems: ["name", "amount"] });
    expect((await send("POST", "/api/commitments", { ...rent(), id: "x" }, cookie)).status).toBe(400);
    expect(await commitmentsOf(cookie)).toEqual([]);
  });

  it("refuses an id already in use", async () => {
    const { cookie } = await setUp();
    const b = rent();
    expect((await send("POST", "/api/commitments", b, cookie)).status).toBe(201);
    expect((await send("POST", "/api/commitments", { ...b, plannedMinor: 1 }, cookie)).status).toBe(409);
    expect(await commitmentsOf(cookie)).toMatchObject([{ plannedMinor: 3_600_000 }]);
  });

  it("needs first use done", async () => {
    const u = await signIn("second");
    for (const t of ["commitment", "spend", "income", "cycle", "settings"]) {
      await env.DB.prepare(`delete from "${t}" where user_id = ?`).bind(u.id).run();
    }
    expect((await send("POST", "/api/commitments", rent(), u.cookie)).status).toBe(404);
  });

  it("edits name, amount and due day, checked like a new one", async () => {
    const { cookie } = await setUp();
    const b = rent();
    await send("POST", "/api/commitments", b, cookie);
    const res = await send(
      "PATCH",
      `/api/commitments/${b.id}`,
      { name: "House rent", plannedMinor: 3_700_000, dueOn: addDays(today(), 2) },
      cookie,
    );
    expect(res.status).toBe(200);
    expect(await commitmentsOf(cookie)).toMatchObject([
      { id: b.id, name: "House rent", plannedMinor: 3_700_000, dueOn: addDays(today(), 2) },
    ]);
    const bad = await send("PATCH", `/api/commitments/${b.id}`, { plannedMinor: -1 }, cookie);
    expect(bad.status).toBe(400);
    const missing = await send("PATCH", `/api/commitments/${crypto.randomUUID()}`, { name: "x" }, cookie);
    expect(missing.status).toBe(404);
  });

  it("deletes for real; undo adds it back with the same id", async () => {
    const { cookie } = await setUp();
    const b = rent();
    await send("POST", "/api/commitments", b, cookie);
    expect((await send("DELETE", `/api/commitments/${b.id}`, undefined, cookie)).status).toBe(200);
    expect(await commitmentsOf(cookie)).toEqual([]);
    expect((await send("DELETE", `/api/commitments/${b.id}`, undefined, cookie)).status).toBe(404);
    expect((await send("POST", "/api/commitments", b, cookie)).status).toBe(201);
    expect(await commitmentsOf(cookie)).toHaveLength(1);
  });

  it("an ended cycle is locked: its commitments can't be changed or deleted", async () => {
    const { cookie, id: userId, cycleId } = await setUp(addDays(today(), -5));
    const b = rent();
    await send("POST", "/api/commitments", b, cookie);
    // A newer cycle starts (salary day comes with item 11).
    const now = Date.now();
    await env.DB.prepare(
      "insert into cycle (id, user_id, started_on, expected_salary_on, created_at, updated_at) values (?, ?, ?, ?, ?, ?)",
    )
      .bind(crypto.randomUUID(), userId, today(), addDays(today(), 30), now, now)
      .run();
    expect((await send("PATCH", `/api/commitments/${b.id}`, { plannedMinor: 5 }, cookie)).status).toBe(409);
    expect((await send("DELETE", `/api/commitments/${b.id}`, undefined, cookie)).status).toBe(409);
    const row = await env.DB.prepare("select planned_minor, cycle_id from commitment where id = ?")
      .bind(b.id)
      .first();
    expect(row).toEqual({ planned_minor: 3_600_000, cycle_id: cycleId });
    // The new cycle doesn't list the old cycle's commitments.
    expect(await commitmentsOf(cookie)).toEqual([]);
  });
});
