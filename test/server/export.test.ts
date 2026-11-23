import { env } from "cloudflare:workers";
import { describe, expect, it } from "vitest";
import { suggestSalaryDay, todayIn } from "../../src/money";
import { call, signIn } from "./helpers";

// Item 27 · Download my data (spec 14): one JSON file with every record; a CSV of spends.

const TZ = "Asia/Colombo";
const today = () => todayIn(TZ, Date.now());
const id = () => crypto.randomUUID();

const send = (method: string, path: string, body: unknown, cookie: string) =>
  call(path, { method, body: body === undefined ? undefined : JSON.stringify(body) }, cookie);

/** A user with first use done, a pot, a card, two spends and a phone with alerts on. */
async function setUp() {
  const u = await signIn("second");
  for (const t of [
    "spend",
    "card",
    "push_subscription",
    "recurring_commitment",
    "pot",
    "cycle",
    "settings",
  ]) {
    await env.DB.prepare(`delete from "${t}" where user_id = ?`).bind(u.id).run();
  }
  const cycleId = id();
  const potId = id();
  const res = await send(
    "POST",
    "/api/first-use",
    {
      settingsId: id(),
      cycleId,
      incomeId: id(),
      salaryCurrency: "LKR",
      spendingCurrency: "LKR",
      homeTimeZone: TZ,
      usualPayDay: 25,
      heldMinor: 9_000_000,
      expectedSalaryOn: suggestSalaryDay(today(), 25),
      pots: [{ id: potId, allocationId: id(), name: "Fuel, petrol", amountMinor: 1_000_000 }],
    },
    u.cookie,
  );
  expect(res.status).toBe(201);
  const cardId = id();
  expect((await send("POST", "/api/cards", { id: cardId, name: "Visa" }, u.cookie)).status).toBe(201);
  const spends = [
    { id: id(), spentOn: today(), amountMinor: 185_050, note: "=lunch", potId },
    { id: id(), spentOn: today(), amountMinor: 50_000, note: "Bus", cardId, oneOff: true },
  ];
  for (const s of spends) expect((await send("POST", "/api/spends", s, u.cookie)).status).toBe(201);
  const endpoint = "https://fcm.googleapis.com/fcm/send/export-device";
  const sub = await send(
    "POST",
    "/api/push-subscriptions",
    { endpoint, p256dh: "B".repeat(87), auth: "A".repeat(22) },
    u.cookie,
  );
  expect(sub.ok).toBe(true);
  return { ...u, cycleId, potId, cardId, spends, endpoint };
}

describe("download my data: JSON (spec 14)", () => {
  it("is a file named for today with every record of the account", async () => {
    const u = await setUp();
    const res = await call("/api/export", {}, u.cookie);
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("application/json");
    expect(res.headers.get("content-disposition")).toBe(
      `attachment; filename="setaside-data-${today()}.json"`,
    );
    expect(res.headers.get("cache-control")).toBe("no-store");
    const body = await res.json<{
      app: string;
      format: number;
      account: { id: string; email: string };
      records: Record<string, Record<string, unknown>[]>;
    }>();
    expect(body.app).toBe("setaside");
    expect(body.format).toBe(1);
    expect(body.account).toMatchObject({ id: u.id, email: u.email });
    expect(body.records.spend?.map((s) => s.id).sort()).toEqual(u.spends.map((s) => s.id).sort());
    expect(body.records.cycle?.map((c) => c.id)).toEqual([u.cycleId]);
    expect(body.records.pot?.[0]).toMatchObject({ id: u.potId, name: "Fuel, petrol" });
    expect(body.records.card?.[0]).toMatchObject({ id: u.cardId, name: "Visa" });
    expect(body.records.settings?.[0]).toMatchObject({ homeTimeZone: TZ });
  });

  it("has a list for every table the user owns, empty ones too", async () => {
    const u = await setUp();
    const body = await (await call("/api/export", {}, u.cookie)).json<{
      records: Record<string, unknown[]>;
    }>();
    const tables = await env.DB.prepare(
      "select name from sqlite_master where type = 'table' and name not like '\\_%' escape '\\' and name not like 'sqlite%'",
    ).all<{ name: string }>();
    const owned: string[] = [];
    for (const { name } of tables.results) {
      const cols = await env.DB.prepare(`select name from pragma_table_info('${name}')`).all<{
        name: string;
      }>();
      if (cols.results.some((c) => c.name === "user_id")) owned.push(name);
    }
    // Login tables are summed up outside `records`, without their secrets.
    const login = ["session", "account", "passkey"];
    expect(Object.keys(body.records).sort()).toEqual(owned.filter((t) => !login.includes(t)).sort());
    expect(body.records.instalment_plan).toEqual([]);
  });

  it("holds no secrets: no session tokens, sign-in tokens, passkey keys or push addresses", async () => {
    const u = await setUp();
    const text = await (await call("/api/export", {}, u.cookie)).text();
    const session = await env.DB.prepare("select token from session where user_id = ?")
      .bind(u.id)
      .first<{ token: string }>();
    expect(session?.token).toBeTruthy();
    expect(text).not.toContain(session?.token);
    expect(text).not.toContain(u.endpoint);
    expect(text).not.toContain("A".repeat(22));
    expect(text).not.toContain('"userId"');
    const body = JSON.parse(text) as { records: { push_subscription: Record<string, unknown>[] } };
    expect(body.records.push_subscription).toHaveLength(1);
    expect(Object.keys(body.records.push_subscription[0] ?? {}).sort()).toEqual([
      "createdAt",
      "id",
      "lastOkAt",
      "updatedAt",
    ]);
  });

  it("works before first use: the account and empty lists", async () => {
    const u = await signIn("second");
    for (const t of [
      "spend",
      "card",
      "push_subscription",
      "recurring_commitment",
      "pot",
      "cycle",
      "settings",
    ]) {
      await env.DB.prepare(`delete from "${t}" where user_id = ?`).bind(u.id).run();
    }
    const res = await call("/api/export", {}, u.cookie);
    expect(res.status).toBe(200);
    expect(res.headers.get("content-disposition")).toMatch(/setaside-data-\d{4}-\d{2}-\d{2}\.json/);
    const body = await res.json<{ records: Record<string, unknown[]> }>();
    expect(body.records.settings).toEqual([]);
  });
});

describe("download my data: CSV of spends (spec 14)", () => {
  it("is a spreadsheet file of every spend, with pot and card names", async () => {
    const u = await setUp();
    // A spend to finish with no amount has an empty amount cell (SAB-83).
    const blank = { id: crypto.randomUUID(), spentOn: today(), amountMinor: 0, note: "Taxi", toFinish: true };
    expect((await send("POST", "/api/spends", blank, u.cookie)).status).toBe(201);
    const res = await call("/api/export/spends.csv", {}, u.cookie);
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("text/csv; charset=utf-8");
    expect(res.headers.get("content-disposition")).toBe(
      `attachment; filename="setaside-spends-${today()}.csv"`,
    );
    const csvLines = (await res.text()).replace(/^﻿/, "").trimEnd().split("\r\n");
    expect(csvLines[0]).toBe("Date,Amount,Currency,Note,Pot,Card,One-off,Cycle started");
    const started = (
      await env.DB.prepare("select started_on from cycle where id = ?")
        .bind(u.cycleId)
        .first<{ started_on: string }>()
    )?.started_on;
    expect(csvLines.slice(1)).toEqual([
      `${today()},1850.50,LKR,'=lunch,"Fuel, petrol",,,${started}`,
      `${today()},500.00,LKR,Bus,,Visa,yes,${started}`,
      `${today()},,LKR,Taxi,,,,${started}`,
    ]);
  });
});
