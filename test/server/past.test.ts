import { env } from "cloudflare:workers";
import { describe, expect, it } from "vitest";
import { addDays, howItEnded, suggestSalaryDay, todayIn } from "../../src/money";
import { call, signIn } from "./helpers";

// Item 21 · Past cycles (spec 10): the list and one ended cycle, read only.

const TZ = "Asia/Colombo";
const today = () => todayIn(TZ, Date.now());
const id = () => crypto.randomUUID();

const send = (method: string, path: string, body: unknown, cookie: string) =>
  call(path, { method, body: body === undefined ? undefined : JSON.stringify(body) }, cookie);

/** A user with first use done 20 days ago: Rs 90,000 held. */
async function setUp() {
  const u = await signIn("second");
  for (const t of ["recurring_commitment", "pot", "cycle", "settings"]) {
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
      salaryCurrency: "LKR",
      spendingCurrency: "LKR",
      homeTimeZone: TZ,
      usualPayDay: 25,
      heldMinor: 9_000_000,
      expectedSalaryOn: suggestSalaryDay(today(), 25),
    },
    u.cookie,
  );
  expect(res.status).toBe(201);
  const startedOn = addDays(today(), -20);
  await env.DB.prepare("update cycle set started_on = ? where id = ?").bind(startedOn, cycleId).run();
  return { ...u, cycleId, startedOn };
}

/** Salary day today: Rs 250,000, with steps 2 and 3 as given. */
const salaryDay = (close: Record<string, unknown> = {}) => ({
  cycleId: id(),
  incomeId: id(),
  salaryMinor: 25_000_000,
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
    ...close,
  },
});

interface PastList {
  cycles: {
    id: string;
    startedOn: string;
    nextStartedOn: string;
    incomes: { kind: string; currency: string; amountMinor: number }[];
    spends: { currency: string; amountMinor: number }[];
    closes: {
      currency: string;
      leftoverMinor: number | null;
      correctionMinor: number;
      toSavingsMinor: number;
      overspendChoice: "take" | "ignore" | null;
    }[];
  }[];
}

describe("Past cycles (item 21, spec 10)", () => {
  it("lists nothing before the first salary day", async () => {
    const { cookie } = await setUp();
    const res = await call("/api/past", {}, cookie);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ cycles: [] });
  });

  it("lists each ended cycle, newest first, with its dates, money in, spent and how it ended", async () => {
    const { cookie, cycleId, startedOn } = await setUp();
    const potId = id();
    await send(
      "POST",
      "/api/pots",
      {
        id: potId,
        allocationId: id(),
        name: "Groceries",
        usualAmountMinor: 1_000_000,
        amountMinor: 1_000_000,
      },
      cookie,
    );
    await send(
      "POST",
      "/api/spends",
      { id: id(), spentOn: addDays(today(), -3), amountMinor: 300_000, potId },
      cookie,
    );
    await send(
      "POST",
      "/api/spends",
      { id: id(), spentOn: addDays(today(), -10), amountMinor: 500_000 },
      cookie,
    );
    const rent = id();
    await send(
      "POST",
      "/api/commitments",
      { id: rent, name: "Rent", plannedMinor: 2_000_000, dueOn: addDays(today(), -5) },
      cookie,
    );
    await send(
      "POST",
      `/api/commitments/${rent}/payments`,
      { id: id(), amountMinor: 500_000, paidOn: addDays(today(), -5) },
      cookie,
    );
    // Leftover: Rs 90,000 − Groceries Rs 10,000 − Rs 5,000 − Rent Rs 20,000 + Rs 7,000 left in the pot.
    const first = salaryDay({
      unpaid: [{ id: rent, choice: "carry", newId: id() }],
      inHandMinor: 6_000_000,
      toSavingsMinor: 1_000_000,
    });
    expect((await send("POST", "/api/salary-day", first, cookie)).status).toBe(201);

    const list = await (await call("/api/past", {}, cookie)).json<PastList>();
    expect(list.cycles).toEqual([
      {
        id: cycleId,
        startedOn,
        nextStartedOn: today(),
        incomes: [{ kind: "opening", currency: "LKR", amountMinor: 9_000_000 }],
        spends: [{ currency: "LKR", amountMinor: 800_000 }],
        closes: [
          {
            currency: "LKR",
            leftoverMinor: 6_200_000,
            correctionMinor: -200_000,
            toSavingsMinor: 1_000_000,
            overspendChoice: null,
          },
        ],
      },
    ]);
    expect(howItEnded(list.cycles[0]?.closes ?? [], "LKR")).toEqual([
      {
        currency: "LKR",
        kind: "leftover",
        leftoverMinor: 6_200_000,
        inHandMinor: 6_000_000,
        toSavingsMinor: 1_000_000,
        toNewCycleMinor: 5_000_000,
      },
    ]);

    // One ended cycle: its own rows, read only.
    const one = await call(`/api/past/${cycleId}`, {}, cookie);
    expect(one.status).toBe(200);
    const body = await one.json<{
      cycle: unknown;
      spends: unknown[];
      pots: unknown[];
      commitments: unknown[];
      closes: unknown[];
    }>();
    expect(body.cycle).toMatchObject({ id: cycleId, startedOn, nextStartedOn: today() });
    expect(body.spends).toMatchObject([
      { amountMinor: 300_000, potId },
      { amountMinor: 500_000, potId: null },
    ]);
    expect(body.pots).toEqual([
      { id: potId, name: "Groceries", currency: "LKR", amountMinor: 1_000_000, archived: false },
    ]);
    expect(body.commitments).toMatchObject([
      {
        id: rent,
        name: "Rent",
        plannedMinor: 2_000_000,
        state: "carried",
        payments: [{ amountMinor: 500_000 }],
      },
    ]);
    expect(body.closes).toMatchObject([{ leftoverMinor: 6_200_000 }]);
  });

  it("keeps an overspend, ignored or taken", async () => {
    const { cookie, cycleId } = await setUp();
    await send("POST", "/api/spends", { id: id(), spentOn: today(), amountMinor: 10_000_000 }, cookie);
    const b = salaryDay({ overspend: "ignore" });
    expect((await send("POST", "/api/salary-day", b, cookie)).status).toBe(201);
    const list = await (await call("/api/past", {}, cookie)).json<PastList>();
    expect(list.cycles[0]?.id).toBe(cycleId);
    expect(howItEnded(list.cycles[0]?.closes ?? [], "LKR")).toEqual([
      { currency: "LKR", kind: "overspend", overMinor: 1_000_000, choice: "ignore" },
    ]);
  });

  it("orders cycles newest first; the current cycle and unknown ids are not in Past", async () => {
    const { cookie, cycleId } = await setUp();
    const second = salaryDay();
    expect((await send("POST", "/api/salary-day", second, cookie)).status).toBe(201);
    // Make the second cycle older so a third salary day can follow it today.
    await env.DB.prepare("update cycle set started_on = ? where id = ?")
      .bind(addDays(today(), -10), second.cycleId)
      .run();
    const third = salaryDay();
    expect((await send("POST", "/api/salary-day", third, cookie)).status).toBe(201);

    const list = await (await call("/api/past", {}, cookie)).json<PastList>();
    expect(list.cycles.map((k) => [k.id, k.nextStartedOn])).toEqual([
      [second.cycleId, today()],
      [cycleId, addDays(today(), -10)],
    ]);
    expect(list.cycles[0]?.incomes).toEqual([{ kind: "salary", currency: "LKR", amountMinor: 25_000_000 }]);
    expect((await call(`/api/past/${third.cycleId}`, {}, cookie)).status).toBe(404);
    expect((await call(`/api/past/${id()}`, {}, cookie)).status).toBe(404);
  });
});
