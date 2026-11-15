import { env } from "cloudflare:workers";
import { describe, expect, it } from "vitest";
import { addDays, suggestSalaryDay, todayIn } from "../../src/money";
import { call, signIn } from "./helpers";

// Item 9 · Underspend question: the stored morning answer (spec 7).

const TZ = "Asia/Colombo";
const today = () => todayIn(TZ, Date.now());

/** A fresh user with first use done today. */
async function setUp() {
  const u = await signIn("second");
  for (const t of ["day_choice", "spend", "pot_allocation", "pot", "income", "cycle", "settings"]) {
    await env.DB.prepare(`delete from "${t}" where user_id = ?`).bind(u.id).run();
  }
  const res = await call(
    "/api/first-use",
    {
      method: "POST",
      body: JSON.stringify({
        settingsId: crypto.randomUUID(),
        cycleId: crypto.randomUUID(),
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
  return u;
}

const answer = (body: unknown, cookie: string) =>
  call("/api/day-choices", { method: "POST", body: JSON.stringify(body) }, cookie);

const dayChoices = async (cookie: string) =>
  (await (await call("/api/current", {}, cookie)).json<{ dayChoices: unknown[] }>()).dayChoices;

describe("underspend answer (item 9, spec 7)", () => {
  it("today's answer is stored and comes back with the cycle", async () => {
    const { cookie } = await setUp();
    const res = await answer({ id: crypto.randomUUID(), dayOn: today(), choice: "today" }, cookie);
    expect(res.status).toBe(201);
    expect(await dayChoices(cookie)).toEqual([{ dayOn: today(), choice: "today" }]);
  });

  it("is given once a day", async () => {
    const { cookie } = await setUp();
    await answer({ id: crypto.randomUUID(), dayOn: today(), choice: "spread" }, cookie);
    const again = await answer({ id: crypto.randomUUID(), dayOn: today(), choice: "today" }, cookie);
    expect(again.status).toBe(409);
    expect(await dayChoices(cookie)).toEqual([{ dayOn: today(), choice: "spread" }]);
  });

  it("only today can be answered", async () => {
    const { cookie } = await setUp();
    for (const dayOn of [addDays(today(), -1), addDays(today(), 1), "nope"]) {
      const res = await answer({ id: crypto.randomUUID(), dayOn, choice: "spread" }, cookie);
      expect(res.status).toBe(400);
    }
    expect(await dayChoices(cookie)).toEqual([]);
  });

  it("refuses an unknown answer", async () => {
    const { cookie } = await setUp();
    const res = await answer({ id: crypto.randomUUID(), dayOn: today(), choice: "later" }, cookie);
    expect(res.status).toBe(400);
  });

  it("needs first use done", async () => {
    const u = await signIn("second");
    for (const t of ["day_choice", "spend", "pot_allocation", "pot", "income", "cycle", "settings"]) {
      await env.DB.prepare(`delete from "${t}" where user_id = ?`).bind(u.id).run();
    }
    const res = await answer({ id: crypto.randomUUID(), dayOn: today(), choice: "spread" }, u.cookie);
    expect(res.status).toBe(404);
  });
});
