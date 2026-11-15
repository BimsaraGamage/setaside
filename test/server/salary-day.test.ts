import { env } from "cloudflare:workers";
import { describe, expect, it } from "vitest";
import { addDays, suggestSalaryDay, todayIn } from "../../src/money";
import { call, signIn } from "./helpers";

const TZ = "Asia/Colombo";
const today = () => todayIn(TZ, Date.now());
const id = () => crypto.randomUUID();

interface Current {
  cycle: { id: string; startedOn: string; expectedSalaryOn: string };
  incomes: { kind: string; amountMinor: number; receivedOn: string }[];
  commitments: {
    id: string;
    name: string;
    plannedMinor: number;
    dueOn: string;
    state: string;
    recurringId: string | null;
    carriedFromId: string | null;
  }[];
  pots: { id: string; name: string; amountMinor: number | null; archived: boolean }[];
  recurring: { id: string; name: string; usualAmountMinor: number; usualDay: number; active: boolean }[];
}

/** A user with first use done 20 days ago: Rs 90,000 held. `who` "demo" is the other user. */
async function setUp(who: "demo" | "second" = "second") {
  const u = await signIn(who);
  for (const t of ["recurring_commitment", "pot", "cycle", "settings"]) {
    await env.DB.prepare(`delete from "${t}" where user_id = ?`).bind(u.id).run();
  }
  const cycleId = id();
  const res = await call(
    "/api/first-use",
    {
      method: "POST",
      body: JSON.stringify({
        settingsId: id(),
        cycleId,
        incomeId: id(),
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
  const startedOn = addDays(today(), -20);
  await env.DB.prepare("update cycle set started_on = ? where id = ?").bind(startedOn, cycleId).run();
  return { ...u, cycleId, startedOn, expectedSalaryOn: suggestSalaryDay(today(), 25) };
}

const send = (method: string, path: string, body: unknown, cookie: string) =>
  call(path, { method, body: body === undefined ? undefined : JSON.stringify(body) }, cookie);

const currentOf = async (cookie: string) => (await call("/api/current", {}, cookie)).json<Current>();

/** A salary day with nothing in it but the salary. */
const salaryDay = (more: Record<string, unknown> = {}) => ({
  cycleId: id(),
  incomeId: id(),
  salaryMinor: 25_000_000,
  receivedOn: today(),
  expectedSalaryOn: addDays(today(), 30),
  commitments: [],
  pots: [],
  ...more,
});

describe("salary day starts a new cycle (item 11, spec 2, 6)", () => {
  it("makes the new cycle from the day received, with the salary, commitments and pot amounts", async () => {
    const { cookie } = await setUp();
    const potId = id();
    await send(
      "POST",
      "/api/pots",
      {
        id: potId,
        allocationId: id(),
        name: "Groceries",
        usualAmountMinor: 1_800_000,
        amountMinor: 1_000_000,
      },
      cookie,
    );
    const b = salaryDay({
      receivedOn: addDays(today(), -1),
      commitments: [{ id: id(), name: " Rent ", plannedMinor: 3_600_000, dueOn: addDays(today(), 5) }],
      pots: [
        { id: potId, allocationId: id(), amountMinor: 2_000_000 },
        { id: id(), allocationId: id(), amountMinor: 500_000, name: "Fuel", usualAmountMinor: 600_000 },
      ],
    });
    const res = await send("POST", "/api/salary-day", b, cookie);
    expect(res.status).toBe(201);
    expect(await res.json()).toEqual({ ok: true, cycleId: b.cycleId });

    const cur = await currentOf(cookie);
    expect(cur.cycle).toEqual({
      id: b.cycleId,
      startedOn: addDays(today(), -1),
      expectedSalaryOn: b.expectedSalaryOn,
    });
    expect(cur.incomes).toMatchObject([
      { kind: "salary", amountMinor: 25_000_000, receivedOn: addDays(today(), -1) },
    ]);
    expect(cur.commitments).toMatchObject([
      { name: "Rent", plannedMinor: 3_600_000, state: "open", recurringId: null },
    ]);
    expect(cur.pots.map((p) => [p.name, p.amountMinor])).toEqual([
      ["Groceries", 2_000_000],
      ["Fuel", 500_000],
    ]);
  });

  it("locks the cycle that ended: its spends and commitments can't be changed", async () => {
    const { cookie } = await setUp();
    const spendId = id();
    const commitmentId = id();
    await send("POST", "/api/spends", { id: spendId, spentOn: today(), amountMinor: 100_000 }, cookie);
    await send(
      "POST",
      "/api/commitments",
      { id: commitmentId, name: "Water", plannedMinor: 100_000, dueOn: today() },
      cookie,
    );
    expect((await send("POST", "/api/salary-day", salaryDay(), cookie)).status).toBe(201);
    expect((await send("PATCH", `/api/spends/${spendId}`, { amountMinor: 1 }, cookie)).status).toBe(409);
    expect((await send("DELETE", `/api/commitments/${commitmentId}`, undefined, cookie)).status).toBe(409);
    // New spends go into the new cycle, dated within it only.
    const s = await send(
      "POST",
      "/api/spends",
      { id: id(), spentOn: addDays(today(), -1), amountMinor: 1 },
      cookie,
    );
    expect(s.status).toBe(400);
  });

  it("refuses a salary dated after today or before the cycle that ends, and an expected day not after today", async () => {
    const { cookie, startedOn } = await setUp();
    const bad = async (more: Record<string, unknown>) => {
      const res = await send("POST", "/api/salary-day", salaryDay(more), cookie);
      expect(res.status).toBe(400);
      return ((await res.json()) as { problems: string[] }).problems;
    };
    expect(await bad({ receivedOn: addDays(today(), 1) })).toEqual(["received_on"]);
    expect(await bad({ receivedOn: addDays(startedOn, -1) })).toEqual(["received_on"]);
    expect(await bad({ expectedSalaryOn: today() })).toEqual(["expected_salary_on"]);
    expect(await bad({ salaryMinor: 0 })).toEqual(["salary"]);
    expect(
      await bad({ commitments: [{ id: id(), name: "Old", plannedMinor: 1, dueOn: addDays(today(), -1) }] }),
    ).toEqual(["commitment.0.due_on"]);
    expect((await currentOf(cookie)).cycle.startedOn).toBe(startedOn);
  });

  it("refuses a stopped pot and the same pot twice", async () => {
    const { cookie } = await setUp();
    const potId = id();
    await send(
      "POST",
      "/api/pots",
      { id: potId, allocationId: id(), name: "Fuel", usualAmountMinor: 1, amountMinor: 1 },
      cookie,
    );
    const twice = salaryDay({
      pots: [
        { id: potId, allocationId: id(), amountMinor: 1 },
        { id: potId, allocationId: id(), amountMinor: 1 },
      ],
    });
    expect((await send("POST", "/api/salary-day", twice, cookie)).status).toBe(400);
    await send("PATCH", `/api/pots/${potId}`, { archived: true }, cookie);
    const stopped = salaryDay({ pots: [{ id: potId, allocationId: id(), amountMinor: 1 }] });
    const res = await send("POST", "/api/salary-day", stopped, cookie);
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ problems: ["pot.0.archived"] });
  });

  it("an id already in use changes nothing", async () => {
    const { cookie, cycleId } = await setUp();
    const res = await send("POST", "/api/salary-day", salaryDay({ cycleId }), cookie);
    expect(res.status).toBe(409);
    expect((await currentOf(cookie)).incomes.map((i) => i.kind)).toEqual(["opening"]);
  });
});

describe("last cycle's coming-up commitments move to the new cycle (spec 3)", () => {
  it("the new row points back and the old one is marked carried", async () => {
    const { cookie, expectedSalaryOn } = await setUp();
    const gym = id();
    await send(
      "POST",
      "/api/commitments",
      { id: gym, name: "Gym", plannedMinor: 500_000, dueOn: addDays(expectedSalaryOn, 2) },
      cookie,
    );
    const newId = id();
    const b = salaryDay({
      commitments: [
        {
          id: newId,
          name: "Gym",
          plannedMinor: 500_000,
          dueOn: addDays(expectedSalaryOn, 2),
          carriedFromId: gym,
        },
      ],
    });
    expect((await send("POST", "/api/salary-day", b, cookie)).status).toBe(201);
    expect((await currentOf(cookie)).commitments).toMatchObject([{ id: newId, carriedFromId: gym }]);
    const old = await env.DB.prepare("select state from commitment where id = ?")
      .bind(gym)
      .first<{ state: string }>();
    expect(old?.state).toBe("carried");
  });

  it("refuses to carry one that belongs to the cycle that ends", async () => {
    const { cookie } = await setUp();
    const water = id();
    await send(
      "POST",
      "/api/commitments",
      { id: water, name: "Water", plannedMinor: 1, dueOn: today() },
      cookie,
    );
    const b = salaryDay({
      commitments: [
        { id: id(), name: "Water", plannedMinor: 1, dueOn: addDays(today(), 1), carriedFromId: water },
      ],
    });
    const res = await send("POST", "/api/salary-day", b, cookie);
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ problems: ["carried_from"] });
  });
});

describe("Every cycle (spec 3, 10)", () => {
  it("the switch on a commitment makes a template with its amount and day, kept in step", async () => {
    const { cookie } = await setUp();
    const k = id();
    const r = id();
    const dueOn = addDays(today(), 3);
    const made = await send(
      "POST",
      "/api/commitments",
      { id: k, name: "Rent", plannedMinor: 3_600_000, dueOn, recurringId: r },
      cookie,
    );
    expect(made.status).toBe(201);
    let cur = await currentOf(cookie);
    expect(cur.commitments[0]?.recurringId).toBe(r);
    expect(cur.recurring).toEqual([
      {
        id: r,
        name: "Rent",
        kind: "bill",
        currency: "LKR",
        usualAmountMinor: 3_600_000,
        usualDay: Number(dueOn.slice(8)),
        active: true,
      },
    ]);

    await send("PATCH", `/api/commitments/${k}`, { plannedMinor: 3_700_000 }, cookie);
    cur = await currentOf(cookie);
    expect(cur.recurring[0]?.usualAmountMinor).toBe(3_700_000);

    // Off: it stops repeating; on again needs a new template id.
    await send("PATCH", `/api/commitments/${k}`, { everyCycle: false }, cookie);
    cur = await currentOf(cookie);
    expect(cur.recurring).toEqual([]);
    expect(cur.commitments[0]?.recurringId).toBeNull();
    expect((await send("PATCH", `/api/commitments/${k}`, { everyCycle: true }, cookie)).status).toBe(400);
    const r2 = id();
    await send("PATCH", `/api/commitments/${k}`, { everyCycle: true, recurringId: r2 }, cookie);
    expect((await currentOf(cookie)).recurring.map((x) => x.id)).toEqual([r2]);

    // Deleting the commitment stops it repeating.
    await send("DELETE", `/api/commitments/${k}`, undefined, cookie);
    expect((await currentOf(cookie)).recurring).toEqual([]);
  });

  it("paused and back on", async () => {
    const { cookie } = await setUp();
    const r = id();
    await send(
      "POST",
      "/api/commitments",
      { id: id(), name: "Rent", plannedMinor: 1, dueOn: today(), recurringId: r },
      cookie,
    );
    expect((await send("PATCH", `/api/recurring-commitments/${r}`, { active: false }, cookie)).status).toBe(
      200,
    );
    expect((await currentOf(cookie)).recurring[0]?.active).toBe(false);
    await send("PATCH", `/api/recurring-commitments/${r}`, { active: true }, cookie);
    expect((await currentOf(cookie)).recurring[0]?.active).toBe(true);
    expect((await send("PATCH", `/api/recurring-commitments/${id()}`, { active: true }, cookie)).status).toBe(
      404,
    );
  });

  it("salary day keeps the confirmed amount and day as the last ones; off stops it repeating", async () => {
    const { cookie } = await setUp();
    const rent = id();
    const phone = id();
    await send(
      "POST",
      "/api/commitments",
      { id: id(), name: "Rent", plannedMinor: 3_600_000, dueOn: today(), recurringId: rent },
      cookie,
    );
    await send(
      "POST",
      "/api/commitments",
      { id: id(), name: "Phone", plannedMinor: 250_000, dueOn: today(), recurringId: phone },
      cookie,
    );
    const newDue = addDays(today(), 10);
    const b = salaryDay({
      commitments: [
        {
          id: id(),
          name: "Rent",
          plannedMinor: 3_800_000,
          dueOn: newDue,
          recurringId: rent,
          everyCycle: true,
        },
        {
          id: id(),
          name: "Phone",
          plannedMinor: 250_000,
          dueOn: newDue,
          recurringId: phone,
          everyCycle: false,
        },
        { id: id(), name: "Gym", plannedMinor: 500_000, dueOn: newDue, recurringId: id(), everyCycle: true },
      ],
    });
    expect((await send("POST", "/api/salary-day", b, cookie)).status).toBe(201);
    const cur = await currentOf(cookie);
    expect(cur.recurring.map((r) => [r.name, r.usualAmountMinor, r.usualDay])).toEqual([
      ["Gym", 500_000, Number(newDue.slice(8))],
      ["Rent", 3_800_000, Number(newDue.slice(8))],
    ]);
    expect(cur.commitments.find((k) => k.name === "Phone")?.recurringId).toBeNull();
  });
});

describe("another user's ids (spec 13)", () => {
  it("salary day aimed at the first user's cycle, template and pot changes nothing of theirs", async () => {
    const owner = await setUp("demo");
    const r = id();
    const potId = id();
    await send(
      "POST",
      "/api/commitments",
      { id: id(), name: "Rent", plannedMinor: 1, dueOn: today(), recurringId: r },
      owner.cookie,
    );
    await send(
      "POST",
      "/api/pots",
      { id: potId, allocationId: id(), name: "Fuel", usualAmountMinor: 1, amountMinor: 1 },
      owner.cookie,
    );
    const before = await currentOf(owner.cookie);
    const other = await setUp("second");
    const tries = [
      salaryDay({ cycleId: owner.cycleId }),
      salaryDay({
        commitments: [
          { id: id(), name: "x", plannedMinor: 1, dueOn: today(), recurringId: r, everyCycle: true },
        ],
      }),
      salaryDay({
        pots: [{ id: potId, allocationId: id(), amountMinor: 1, name: "x", usualAmountMinor: 1 }],
      }),
    ];
    for (const t of tries) expect((await send("POST", "/api/salary-day", t, other.cookie)).status).toBe(409);
    expect(
      (await send("PATCH", `/api/recurring-commitments/${r}`, { active: false }, other.cookie)).status,
    ).toBe(404);
    expect(await currentOf(owner.cookie)).toEqual(before);
  });
});
