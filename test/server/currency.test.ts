import { env } from "cloudflare:workers";
import { describe, expect, it } from "vitest";
import { addDays, suggestSalaryDay, todayIn } from "../../src/money";
import { call, signIn } from "./helpers";

// Two currencies (item 15, spec 8): salary in dollars, spending in rupees.

const TZ = "Asia/Colombo";
const today = () => todayIn(TZ, Date.now());
const id = () => crypto.randomUUID();

interface Current {
  settings: { salaryCurrency: string; spendingCurrency: string; countingRate: string | null };
  cycle: { id: string };
  incomes: { kind: string; currency: string; amountMinor: number }[];
  commitments: { id: string; name: string; currency: string; plannedMinor: number }[];
  pots: { id: string; name: string; currency: string; amountMinor: number | null }[];
  spends: { id: string; currency: string; amountMinor: number; potId: string | null }[];
  savings: { kind: string; currency: string; amountMinor: number }[];
}

const send = (method: string, path: string, body: unknown, cookie: string) =>
  call(path, { method, body: body === undefined ? undefined : JSON.stringify(body) }, cookie);
const currentOf = async (cookie: string) => (await call("/api/current", {}, cookie)).json<Current>();

/** A fresh user set up with USD salary and LKR spending: Rs 10,000 and $500 held, Rs 300 a dollar. */
async function setUp(over: Record<string, unknown> = {}) {
  const u = await signIn("second");
  for (const t of ["recurring_commitment", "pot", "cycle", "counting_rate", "prepayment", "settings"]) {
    await env.DB.prepare(`delete from "${t}" where user_id = ?`).bind(u.id).run();
  }
  const cycleId = id();
  const res = await send(
    "POST",
    "/api/first-use",
    {
      settingsId: id(),
      cycleId,
      incomeId: id(),
      salaryIncomeId: id(),
      countingRateId: id(),
      salaryCurrency: "USD",
      spendingCurrency: "LKR",
      homeTimeZone: TZ,
      usualPayDay: 25,
      heldMinor: 1_000_000,
      heldSalaryMinor: 50_000,
      countingRate: "300",
      expectedSalaryOn: suggestSalaryDay(today(), 25),
      commitments: [{ id: id(), name: "Netflix", currency: "USD", plannedMinor: 1_500, dueOn: today() }],
      pots: [{ id: id(), allocationId: id(), name: "Apps", currency: "USD", amountMinor: 2_000 }],
      ...over,
    },
    u.cookie,
  );
  return { ...u, cycleId, res };
}

describe("two currencies (item 15, spec 8)", () => {
  it("first use keeps money held per currency, the counting rate, and bills and pots in dollars", async () => {
    const { cookie, res } = await setUp();
    expect(res.status).toBe(201);
    const now = await currentOf(cookie);
    expect(now.settings).toMatchObject({
      salaryCurrency: "USD",
      spendingCurrency: "LKR",
      countingRate: "300",
    });
    expect(now.incomes.map((i) => [i.kind, i.currency, i.amountMinor]).sort()).toEqual([
      ["opening", "LKR", 1_000_000],
      ["opening", "USD", 50_000],
    ]);
    expect(now.commitments).toMatchObject([{ name: "Netflix", currency: "USD", plannedMinor: 1_500 }]);
    expect(now.pots).toMatchObject([{ name: "Apps", currency: "USD", amountMinor: 2_000 }]);
  });

  it("first use with two currencies needs a counting rate; a third currency is refused", async () => {
    const noRate = await setUp({ countingRate: null });
    expect(noRate.res.status).toBe(400);
    expect(await noRate.res.json()).toEqual({ error: "invalid", problems: ["counting_rate"] });
    const third = await setUp({
      commitments: [{ id: id(), name: "Rent", currency: "EUR", plannedMinor: 1, dueOn: today() }],
    });
    expect(third.res.status).toBe(400);
    expect(await third.res.json()).toEqual({ error: "invalid", problems: ["commitment.0.currency"] });
  });

  it("the counting rate is set by hand; the newest one counts", async () => {
    const { cookie } = await setUp();
    const bad = await send("POST", "/api/counting-rates", { id: id(), rate: "abc" }, cookie);
    expect(bad.status).toBe(400);
    const ok = await send("POST", "/api/counting-rates", { id: id(), rate: "305.25" }, cookie);
    expect(ok.status).toBe(201);
    expect((await currentOf(cookie)).settings.countingRate).toBe("305.25");
  });

  it("a one-currency user has no counting rate to set", async () => {
    const { cookie } = await setUp({
      salaryCurrency: "LKR",
      salaryIncomeId: undefined,
      countingRateId: undefined,
      heldSalaryMinor: undefined,
      countingRate: undefined,
      commitments: [],
      pots: [],
    });
    const res = await send("POST", "/api/counting-rates", { id: id(), rate: "300" }, cookie);
    expect(res.status).toBe(409);
    expect((await currentOf(cookie)).settings.countingRate).toBeNull();
  });

  it("commitments, pots, savings and income take either currency", async () => {
    const { cookie } = await setUp();
    const k = await send(
      "POST",
      "/api/commitments",
      { id: id(), name: "Domain", currency: "USD", plannedMinor: 1_200, dueOn: today() },
      cookie,
    );
    expect(k.status).toBe(201);
    const pot = await send(
      "POST",
      "/api/pots",
      {
        id: id(),
        allocationId: id(),
        name: "Cloud",
        currency: "USD",
        usualAmountMinor: 500,
        amountMinor: 500,
      },
      cookie,
    );
    expect(pot.status).toBe(201);
    const put = await send(
      "POST",
      "/api/savings-movements",
      { id: id(), kind: "put_in", currency: "USD", amountMinor: 10_000 },
      cookie,
    );
    expect(put.status).toBe(201);
    // Take out: never more than is saved in that currency.
    const tooMuch = await send(
      "POST",
      "/api/savings-movements",
      { id: id(), kind: "take_out", currency: "USD", amountMinor: 10_001 },
      cookie,
    );
    expect(tooMuch.status).toBe(400);
    const income = await send(
      "POST",
      "/api/incomes",
      { id: id(), kind: "extra", currency: "USD", amountMinor: 3_000, toSavingsMinor: 1_000 },
      cookie,
    );
    expect(income.status).toBe(201);
    const eur = await send(
      "POST",
      "/api/incomes",
      { id: id(), kind: "extra", currency: "EUR", amountMinor: 1, toSavingsMinor: 0 },
      cookie,
    );
    expect(eur.status).toBe(400);
    const now = await currentOf(cookie);
    expect(now.commitments.find((c) => c.name === "Domain")?.currency).toBe("USD");
    expect(now.pots.find((p) => p.name === "Cloud")?.currency).toBe("USD");
  });

  it("a spend in a dollar pot is in dollars; one in free money is in rupees", async () => {
    const { cookie } = await setUp();
    const apps = (await currentOf(cookie)).pots[0]?.id as string;
    const inPot = id();
    expect(
      (
        await send(
          "POST",
          "/api/spends",
          { id: inPot, spentOn: today(), amountMinor: 999, potId: apps },
          cookie,
        )
      ).status,
    ).toBe(201);
    const free = id();
    expect(
      (await send("POST", "/api/spends", { id: free, spentOn: today(), amountMinor: 50_000 }, cookie)).status,
    ).toBe(201);
    // Moved out of the pot, it is a rupee spend again.
    expect((await send("PATCH", `/api/spends/${inPot}`, { potId: null }, cookie)).status).toBe(200);
    const spends = (await currentOf(cookie)).spends;
    expect(spends.find((s) => s.id === free)?.currency).toBe("LKR");
    expect(spends.find((s) => s.id === inPot)?.currency).toBe("LKR");
  });

  it("salary day: salary in dollars, reserve rate kept, the dollar leftover split (item 16)", async () => {
    const { cookie, cycleId } = await setUp({ commitments: [], pots: [] });
    await env.DB.prepare("update cycle set started_on = ? where id = ?")
      .bind(addDays(today(), -20), cycleId)
      .run();
    const newCycle = id();
    const res = await send(
      "POST",
      "/api/salary-day",
      {
        cycleId: newCycle,
        incomeId: id(),
        salaryMinor: 200_000,
        receivedOn: today(),
        expectedSalaryOn: addDays(today(), 30),
        commitments: [
          { id: id(), name: "Rent", currency: "LKR", plannedMinor: 5_000_000, dueOn: addDays(today(), 3) },
        ],
        pots: [],
        close: {
          closeId: id(),
          leftoverIncomeId: id(),
          salaryLeftoverIncomeId: id(),
          salaryCloseId: id(),
          unpaid: [],
          inHandMinor: null,
          toSavingsMinor: 0,
          overspend: null,
          salaryInHandMinor: 48_000,
          salaryToSavingsMinor: 20_000,
        },
      },
      cookie,
    );
    expect(res.status).toBe(201);
    const now = await currentOf(cookie);
    expect(now.cycle.id).toBe(newCycle);
    expect(now.incomes.map((i) => [i.kind, i.currency, i.amountMinor]).sort()).toEqual([
      ["leftover", "LKR", 1_000_000],
      ["leftover", "USD", 48_000],
      ["salary", "USD", 200_000],
    ]);
    expect(now.savings).toContainEqual(
      expect.objectContaining({ kind: "leftover", currency: "USD", amountMinor: 20_000 }),
    );
    const closes = await env.DB.prepare(
      "select currency, leftover_correction_minor as c, leftover_to_savings_minor as s from cycle_close where next_cycle_id = ? order by currency",
    )
      .bind(newCycle)
      .all();
    expect(closes.results).toEqual([
      { currency: "LKR", c: 0, s: 0 },
      { currency: "USD", c: -2_000, s: 20_000 },
    ]);
    expect(now.commitments).toMatchObject([{ name: "Rent", currency: "LKR" }]);
    const row = await env.DB.prepare("select reserve_rate from cycle where id = ?").bind(newCycle).first();
    expect(row).toEqual({ reserve_rate: "300" });
  });

  it("salary day step 6: a new counting rate is kept, is the new cycle's reserve rate, and Undo removes it", async () => {
    const { cookie, cycleId } = await setUp({ commitments: [], pots: [] });
    await env.DB.prepare("update cycle set started_on = ? where id = ?")
      .bind(addDays(today(), -20), cycleId)
      .run();
    const newCycle = id();
    const rateId = id();
    const res = await send(
      "POST",
      "/api/salary-day",
      {
        cycleId: newCycle,
        incomeId: id(),
        salaryMinor: 200_000,
        receivedOn: today(),
        expectedSalaryOn: addDays(today(), 30),
        countingRate: { id: rateId, rate: "310.25" },
        commitments: [],
        pots: [],
        close: {
          closeId: id(),
          leftoverIncomeId: id(),
          salaryLeftoverIncomeId: id(),
          salaryCloseId: id(),
          unpaid: [],
          inHandMinor: null,
          toSavingsMinor: 0,
          overspend: null,
        },
      },
      cookie,
    );
    expect(res.status).toBe(201);
    const now = await currentOf(cookie);
    expect(now.settings.countingRate).toBe("310.25");
    const row = await env.DB.prepare("select reserve_rate from cycle where id = ?").bind(newCycle).first();
    expect(row).toEqual({ reserve_rate: "310.25" });

    const undone = await send("POST", "/api/salary-day/undo", { cycleId: newCycle }, cookie);
    expect(undone.status).toBe(200);
    const after = await currentOf(cookie);
    expect(after.cycle.id).toBe(cycleId);
    expect(after.settings.countingRate).toBe("300");
    const left = await env.DB.prepare("select id from counting_rate where id = ?").bind(rateId).first();
    expect(left).toBeNull();
  });

  it("salary day refuses a counting rate that is not a plain number above zero", async () => {
    const { cookie, cycleId } = await setUp({ commitments: [], pots: [] });
    await env.DB.prepare("update cycle set started_on = ? where id = ?")
      .bind(addDays(today(), -20), cycleId)
      .run();
    const res = await send(
      "POST",
      "/api/salary-day",
      {
        cycleId: id(),
        incomeId: id(),
        salaryMinor: 200_000,
        receivedOn: today(),
        expectedSalaryOn: addDays(today(), 30),
        countingRate: { id: id(), rate: "0" },
        commitments: [],
        pots: [],
        close: {
          closeId: id(),
          leftoverIncomeId: id(),
          salaryLeftoverIncomeId: id(),
          salaryCloseId: id(),
          unpaid: [],
          inHandMinor: null,
          toSavingsMinor: 0,
          overspend: null,
        },
      },
      cookie,
    );
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "invalid", problems: ["counting_rate"] });
  });

  it("salary day needs the row for the dollar leftover when there is one", async () => {
    const { cookie, cycleId } = await setUp({ commitments: [], pots: [] });
    await env.DB.prepare("update cycle set started_on = ? where id = ?")
      .bind(addDays(today(), -20), cycleId)
      .run();
    const res = await send(
      "POST",
      "/api/salary-day",
      {
        cycleId: id(),
        incomeId: id(),
        salaryMinor: 200_000,
        receivedOn: today(),
        expectedSalaryOn: addDays(today(), 30),
        commitments: [],
        pots: [],
        close: {
          closeId: id(),
          leftoverIncomeId: id(),
          unpaid: [],
          inHandMinor: null,
          toSavingsMinor: 0,
          overspend: null,
        },
      },
      cookie,
    );
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "invalid", problems: ["close.new_id"] });
  });
});
