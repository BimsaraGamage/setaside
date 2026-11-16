import { env } from "cloudflare:workers";
import { describe, expect, it } from "vitest";
import { addDays, suggestSalaryDay, todayIn } from "../../src/money";
import { call, signIn } from "./helpers";

const TZ = "Asia/Colombo";

function body(over: Record<string, unknown> = {}) {
  const today = todayIn(TZ, Date.now());
  return {
    settingsId: crypto.randomUUID(),
    cycleId: crypto.randomUUID(),
    incomeId: crypto.randomUUID(),
    salaryCurrency: "LKR",
    spendingCurrency: "LKR",
    homeTimeZone: TZ,
    usualPayDay: 25,
    heldMinor: 9_000_000,
    expectedSalaryOn: suggestSalaryDay(today, 25),
    ...over,
  };
}

/** A fresh signed-in user with nothing set up (the demo users are shared across tests). */
async function freshUser() {
  const u = await signIn("second");
  for (const t of ["recurring_commitment", "spend", "pot", "income", "cycle", "settings"]) {
    await env.DB.prepare(`delete from "${t}" where user_id = ?`).bind(u.id).run();
  }
  return u;
}

const post = (b: unknown, cookie: string) =>
  call("/api/first-use", { method: "POST", body: JSON.stringify(b) }, cookie);

describe("first use (item 3, spec 2)", () => {
  it("before first use, Today has no settings and no cycle", async () => {
    const { cookie } = await freshUser();
    const res = await call("/api/current", {}, cookie);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      settings: null,
      cycle: null,
      incomes: [],
      spends: [],
      commitments: [],
      pots: [],
      conversions: [],
      cards: [],
      lastCycle: null,
      dayChoices: [],
      savings: [],
      prepayments: [],
      recurring: [],
      undoSalaryDay: false,
    });
  });

  it("makes the settings row, the first cycle from today and the opening income", async () => {
    const { cookie } = await freshUser();
    const b = body();
    const res = await post(b, cookie);
    expect(res.status).toBe(201);
    const today = todayIn(TZ, Date.now());
    const cur = await (await call("/api/current", {}, cookie)).json();
    expect(cur).toEqual({
      settings: {
        salaryCurrency: "LKR",
        spendingCurrency: "LKR",
        homeTimeZone: TZ,
        usualPayDay: 25,
        countingRate: null,
      },
      cycle: { id: b.cycleId, startedOn: today, expectedSalaryOn: b.expectedSalaryOn, reserveRate: null },
      incomes: [
        {
          id: b.incomeId,
          kind: "opening",
          currency: "LKR",
          amountMinor: 9_000_000,
          toSavingsMinor: 0,
          receivedOn: today,
        },
      ],
      spends: [],
      commitments: [],
      pots: [],
      conversions: [],
      cards: [],
      lastCycle: null,
      dayChoices: [],
      savings: [],
      prepayments: [],
      recurring: [],
      undoSalaryDay: false,
    });
  });

  it("happens once", async () => {
    const { cookie } = await freshUser();
    expect((await post(body(), cookie)).status).toBe(201);
    expect((await post(body(), cookie)).status).toBe(409);
  });

  it("refuses what the money rules refuse, and saves nothing", async () => {
    const { cookie, id } = await freshUser();
    const today = todayIn(TZ, Date.now());
    const res = await post(body({ expectedSalaryOn: today, salaryCurrency: "USD" }), cookie);
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({
      error: "invalid",
      problems: ["counting_rate", "expected_salary_on", "new_id"],
    });
    const n = await env.DB.prepare("select count(*) as n from settings where user_id = ?")
      .bind(id)
      .first("n");
    expect(n).toBe(0);
  });

  it("refuses a malformed body", async () => {
    const { cookie } = await freshUser();
    expect((await post(body({ heldMinor: 12.5 }), cookie)).status).toBe(400);
    expect((await post(body({ cycleId: "x" }), cookie)).status).toBe(400);
  });

  it("writes all or nothing when an id is already taken", async () => {
    const { cookie, id } = await freshUser();
    const first = body();
    await post(first, cookie);
    await env.DB.prepare("delete from settings where user_id = ?").bind(id).run();
    // A new settings id, but the old cycle id: the whole write is refused.
    const res = await post(body({ cycleId: first.cycleId }), cookie);
    expect(res.status).toBe(409);
    const n = await env.DB.prepare("select count(*) as n from settings where user_id = ?")
      .bind(id)
      .first("n");
    expect(n).toBe(0);
  });
});

interface Current {
  commitments: {
    id: string;
    name: string;
    plannedMinor: number;
    dueOn: string;
    recurringId: string | null;
  }[];
  pots: { id: string; name: string; usualAmountMinor: number; amountMinor: number | null }[];
  recurring: { id: string; name: string; usualAmountMinor: number; usualDay: number; active: boolean }[];
}

describe("first use: bills and pots (ticket 37, spec 2 step 4)", () => {
  const today = () => todayIn(TZ, Date.now());

  it("makes the bills, Every cycle templates, pots and this cycle's pot amounts with the first cycle", async () => {
    const { cookie } = await freshUser();
    const rent = { id: crypto.randomUUID(), recurringId: crypto.randomUUID() };
    const phone = { id: crypto.randomUUID() };
    const pot = { id: crypto.randomUUID(), allocationId: crypto.randomUUID() };
    const b = body({
      commitments: [
        { ...rent, name: " Rent ", plannedMinor: 4_000_000, dueOn: today() },
        { ...phone, name: "Phone", plannedMinor: 300_000, dueOn: today() },
      ],
      pots: [{ ...pot, name: "Groceries", amountMinor: 1_500_000 }],
    });
    expect((await post(b, cookie)).status).toBe(201);
    const cur = await (await call("/api/current", {}, cookie)).json<Current>();
    expect(cur.commitments).toEqual([
      expect.objectContaining({ id: phone.id, name: "Phone", recurringId: null }),
      expect.objectContaining({
        id: rent.id,
        name: "Rent",
        plannedMinor: 4_000_000,
        dueOn: today(),
        recurringId: rent.recurringId,
      }),
    ]);
    expect(cur.recurring).toEqual([
      {
        id: rent.recurringId,
        name: "Rent",
        kind: "bill",
        currency: "LKR",
        usualAmountMinor: 4_000_000,
        usualDay: Number(today().slice(8, 10)),
        active: true,
        cardId: null,
      },
    ]);
    expect(cur.pots).toEqual([
      expect.objectContaining({
        id: pot.id,
        name: "Groceries",
        usualAmountMinor: 1_500_000,
        amountMinor: 1_500_000,
      }),
    ]);
  });

  it("refuses bad bills and pots, and saves nothing", async () => {
    const { cookie, id } = await freshUser();
    const res = await post(
      body({
        commitments: [{ id: crypto.randomUUID(), name: "", plannedMinor: 0, dueOn: addDays(today(), -1) }],
        pots: [{ id: crypto.randomUUID(), allocationId: crypto.randomUUID(), name: "Fuel", amountMinor: -1 }],
      }),
      cookie,
    );
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({
      error: "invalid",
      problems: [
        "commitment.0.name",
        "commitment.0.amount",
        "commitment.0.due_on",
        "pot.0.usual_amount",
        "pot.0.amount",
      ],
    });
    const n = await env.DB.prepare("select count(*) as n from settings where user_id = ?")
      .bind(id)
      .first("n");
    expect(n).toBe(0);
  });

  it("refuses the same pot twice", async () => {
    const { cookie } = await freshUser();
    const pot = { id: crypto.randomUUID(), name: "Fuel", amountMinor: 1 };
    const res = await post(
      body({
        pots: [
          { ...pot, allocationId: crypto.randomUUID() },
          { ...pot, allocationId: crypto.randomUUID() },
        ],
      }),
      cookie,
    );
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ problems: ["pot.twice"] });
  });
});

describe("settings (spec 10)", () => {
  it("changes the usual pay day and the home time zone", async () => {
    const { cookie } = await freshUser();
    await post(body(), cookie);
    const res = await call(
      "/api/settings",
      { method: "PATCH", body: JSON.stringify({ usualPayDay: 1, homeTimeZone: "Europe/London" }) },
      cookie,
    );
    expect(res.status).toBe(200);
    const cur = await (await call("/api/current", {}, cookie)).json<{ settings: unknown }>();
    expect(cur.settings).toMatchObject({ usualPayDay: 1, homeTimeZone: "Europe/London" });
  });

  it("refuses a bad pay day or time zone", async () => {
    const { cookie } = await freshUser();
    await post(body(), cookie);
    for (const b of [{ usualPayDay: 0 }, { homeTimeZone: "Mars/Base" }, {}]) {
      const res = await call("/api/settings", { method: "PATCH", body: JSON.stringify(b) }, cookie);
      expect(res.status).toBe(400);
    }
  });

  it("needs first use done", async () => {
    const { cookie } = await freshUser();
    const res = await call(
      "/api/settings",
      { method: "PATCH", body: JSON.stringify({ usualPayDay: 3 }) },
      cookie,
    );
    expect(res.status).toBe(404);
  });
});
