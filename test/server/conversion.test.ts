import { env } from "cloudflare:workers";
import { describe, expect, it } from "vitest";
import { addDays, suggestSalaryDay, todayIn } from "../../src/money";
import { call, signIn } from "./helpers";

// Change dollars (item 16, spec 8): salary in dollars, spending in rupees.

const TZ = "Asia/Colombo";
const today = () => todayIn(TZ, Date.now());
const id = () => crypto.randomUUID();

interface Current {
  settings: { countingRate: string | null };
  cycle: { id: string; reserveRate: string | null };
  conversions: {
    id: string;
    givenMinor: number;
    receivedMinor: number;
    rate: string;
    coveredMinor: number;
    gainMinor: number;
    doneOn: string;
  }[];
  savings: { id: string; kind: string; currency: string; amountMinor: number }[];
  undoSalaryDay: boolean;
}

const send = (method: string, path: string, body: unknown, cookie: string) =>
  call(path, { method, body: body === undefined ? undefined : JSON.stringify(body) }, cookie);
const currentOf = async (cookie: string) => (await call("/api/current", {}, cookie)).json<Current>();

/** A fresh user: $1,000 held, no rupees, a Rs 30,000 rupee bill; Rs 300 a dollar. */
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
      heldMinor: 0,
      heldSalaryMinor: 100_000,
      countingRate: "300",
      expectedSalaryOn: suggestSalaryDay(today(), 25),
      commitments: [{ id: id(), name: "Rent", currency: "LKR", plannedMinor: 3_000_000, dueOn: today() }],
      pots: [],
      ...over,
    },
    u.cookie,
  );
  expect(res.status).toBe(201);
  return { ...u, cycleId };
}

describe("change dollars (item 16, spec 8)", () => {
  it("first use keeps the first counting rate as the cycle's reserve rate", async () => {
    const { cookie } = await setUp();
    expect((await currentOf(cookie)).cycle.reserveRate).toBe("300");
  });

  it("covers the rupee bill first, keeps the gain to savings, and its rate becomes the counting rate", async () => {
    const { cookie } = await setUp();
    const cv = id();
    const res = await send(
      "POST",
      "/api/conversions",
      { id: cv, givenMinor: 20_000, receivedMinor: 6_200_000, doneOn: today() },
      cookie,
    );
    expect(res.status).toBe(201);
    expect(await res.json()).toEqual({
      ok: true,
      rate: "310",
      coveredMinor: 3_000_000,
      toFreeMinor: 3_100_000,
      gainMinor: 100_000,
    });
    const now = await currentOf(cookie);
    expect(now.settings.countingRate).toBe("310");
    expect(now.conversions).toEqual([
      {
        id: cv,
        givenMinor: 20_000,
        receivedMinor: 6_200_000,
        rate: "310",
        coveredMinor: 3_000_000,
        gainMinor: 100_000,
        doneOn: today(),
      },
    ]);
    expect(now.savings).toContainEqual({
      id: cv,
      kind: "rate_gain",
      cycleId: now.cycle.id,
      currency: "LKR",
      amountMinor: 100_000,
      on: today(),
      name: null,
    });
  });

  it("Undo deletes the conversion and its counting rate", async () => {
    const { cookie } = await setUp();
    const cv = id();
    await send(
      "POST",
      "/api/conversions",
      { id: cv, givenMinor: 10_000, receivedMinor: 3_100_000, doneOn: today() },
      cookie,
    );
    expect((await send("DELETE", `/api/conversions/${cv}`, undefined, cookie)).status).toBe(200);
    const now = await currentOf(cookie);
    expect(now.conversions).toEqual([]);
    expect(now.settings.countingRate).toBe("300");
    expect(now.savings).toEqual([]);
    expect((await send("DELETE", `/api/conversions/${cv}`, undefined, cookie)).status).toBe(404);
  });

  it("refuses amounts not above zero, a day outside the cycle, and a one-currency user", async () => {
    const { cookie } = await setUp();
    const bad = await send(
      "POST",
      "/api/conversions",
      { id: id(), givenMinor: 0, receivedMinor: 100, doneOn: addDays(today(), 1) },
      cookie,
    );
    expect(bad.status).toBe(400);
    expect(await bad.json()).toEqual({ error: "invalid", problems: ["given", "done_on"] });

    const one = await setUp({
      salaryCurrency: "LKR",
      salaryIncomeId: undefined,
      countingRateId: undefined,
      countingRate: undefined,
      heldSalaryMinor: undefined,
      heldMinor: 100_000,
    });
    const res = await send(
      "POST",
      "/api/conversions",
      { id: id(), givenMinor: 100, receivedMinor: 100, doneOn: today() },
      one.cookie,
    );
    expect(res.status).toBe(409);
  });

  it("a conversion after salary day ends Undo salary day", async () => {
    const { cookie, cycleId } = await setUp({ commitments: [] });
    await env.DB.prepare("update cycle set started_on = ? where id = ?")
      .bind(addDays(today(), -20), cycleId)
      .run();
    const started = await send(
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
    expect(started.status).toBe(201);
    expect((await currentOf(cookie)).undoSalaryDay).toBe(true);
    await send(
      "POST",
      "/api/conversions",
      { id: id(), givenMinor: 100, receivedMinor: 30_000, doneOn: today() },
      cookie,
    );
    expect((await currentOf(cookie)).undoSalaryDay).toBe(false);
  });
});
