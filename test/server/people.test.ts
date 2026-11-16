import { env } from "cloudflare:workers";
import { describe, expect, it } from "vitest";
import { addDays, suggestSalaryDay, todayIn } from "../../src/money";
import { call, signIn } from "./helpers";

// Item 20 · People (spec 9).

const TZ = "Asia/Colombo";
const today = () => todayIn(TZ, Date.now());
const id = () => crypto.randomUUID();

const TABLES = ["person_debt", "recurring_commitment", "pot", "cycle", "settings"];

/** A fresh user with first use done 20 days ago (Rs 90,000 held). */
async function setUp() {
  const u = await signIn("second");
  for (const t of TABLES) await env.DB.prepare(`delete from "${t}" where user_id = ?`).bind(u.id).run();
  const cycleId = id();
  const expectedSalaryOn = suggestSalaryDay(today(), 25);
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
      expectedSalaryOn,
    },
    u.cookie,
  );
  expect(res.status).toBe(201);
  await env.DB.prepare("update cycle set started_on = ? where id = ?")
    .bind(addDays(today(), -20), cycleId)
    .run();
  return { ...u, cycleId, expectedSalaryOn };
}

const send = (method: string, path: string, body: unknown, cookie: string) =>
  call(path, { method, body: body === undefined ? undefined : JSON.stringify(body) }, cookie);

interface Current {
  cycle: { id: string };
  savings: { id: string; kind: string; amountMinor: number }[];
  incomes: { id: string; kind: string; amountMinor: number; toSavingsMinor: number }[];
  people: {
    id: string;
    cycleId: string;
    personName: string;
    direction: string;
    currency: string;
    amountMinor: number;
    settledOn: string | null;
    backMinor: number;
    gotBack: { id: string; amountMinor: number; toSavingsMinor: number }[];
    incomeId: string | null;
  }[];
  commitments: {
    id: string;
    name: string;
    kind: string;
    plannedMinor: number;
    dueOn: string;
    state: string;
    personDebtId: string | null;
    carriedFromId: string | null;
  }[];
  undoSalaryDay: boolean;
}

const currentOf = async (cookie: string) => (await call("/api/current", {}, cookie)).json<Current>();

const lend = (more: Record<string, unknown> = {}) => ({
  id: id(),
  direction: "lent",
  personName: " Nimal ",
  amountMinor: 500_000,
  ...more,
});

const borrow = (more: Record<string, unknown> = {}) => ({
  id: id(),
  direction: "borrowed",
  personName: "Kamal",
  amountMinor: 2_000_000,
  incomeId: id(),
  toSavingsMinor: 500_000,
  ...more,
});

const pay = (commitmentId: string, amountMinor: number, cookie: string, finish = true) =>
  send(
    "POST",
    `/api/commitments/${commitmentId}/payments`,
    { id: id(), amountMinor, paidOn: today(), finish },
    cookie,
  );

/** A salary day today with nothing in it but the salary and `commitments`. */
const salaryDay = (commitments: unknown[]) => ({
  cycleId: id(),
  incomeId: id(),
  salaryMinor: 25_000_000,
  receivedOn: today(),
  expectedSalaryOn: addDays(today(), 30),
  commitments,
  pots: [],
  close: {
    closeId: id(),
    leftoverIncomeId: id(),
    unpaid: [],
    inHandMinor: null,
    toSavingsMinor: 0,
    overspend: null,
  },
});

describe("I lent money (spec 9)", () => {
  it("makes the entry in this cycle; nothing comes in", async () => {
    const { cookie, cycleId } = await setUp();
    const b = lend();
    expect((await send("POST", "/api/people", b, cookie)).status).toBe(201);
    const cur = await currentOf(cookie);
    expect(cur.people).toEqual([
      expect.objectContaining({
        id: b.id,
        cycleId,
        personName: "Nimal",
        direction: "lent",
        currency: "LKR",
        amountMinor: 500_000,
        settledOn: null,
        backMinor: 0,
        gotBack: [],
        incomeId: null,
      }),
    ]);
    expect(cur.incomes).toHaveLength(1);
  });

  it("refuses no name, no amount, a split or a payback, another currency", async () => {
    const { cookie } = await setUp();
    for (const more of [
      { personName: " " },
      { amountMinor: 0 },
      { toSavingsMinor: 1 },
      { payback: { id: id(), plannedMinor: 1, dueOn: today() } },
      { currency: "USD" },
    ]) {
      expect((await send("POST", "/api/people", lend(more), cookie)).status).toBe(400);
    }
    expect((await currentOf(cookie)).people).toEqual([]);
  });

  it("an id already in use is a conflict", async () => {
    const { cookie } = await setUp();
    const b = lend();
    await send("POST", "/api/people", b, cookie);
    expect((await send("POST", "/api/people", b, cookie)).status).toBe(409);
  });
});

describe("Got it back (spec 9)", () => {
  it("is a paid_back income split like extra income, at most what is owed; Undo deletes it", async () => {
    const { cookie } = await setUp();
    const b = lend();
    await send("POST", "/api/people", b, cookie);
    const back = { id: id(), amountMinor: 300_000, toSavingsMinor: 100_000 };
    expect((await send("POST", `/api/people/${b.id}/back`, back, cookie)).status).toBe(201);
    let cur = await currentOf(cookie);
    expect(cur.incomes).toContainEqual(
      expect.objectContaining({
        id: back.id,
        kind: "paid_back",
        amountMinor: 300_000,
        toSavingsMinor: 100_000,
      }),
    );
    expect(cur.savings).toContainEqual(expect.objectContaining({ id: back.id, amountMinor: 100_000 }));
    expect(cur.people[0]).toMatchObject({
      backMinor: 300_000,
      gotBack: [expect.objectContaining({ id: back.id })],
    });
    const tooMuch = { id: id(), amountMinor: 200_001, toSavingsMinor: 0 };
    const res = await send("POST", `/api/people/${b.id}/back`, tooMuch, cookie);
    expect(await res.json()).toMatchObject({ problems: ["too_much"] });
    expect((await send("DELETE", `/api/incomes/${back.id}`, undefined, cookie)).status).toBe(200);
    cur = await currentOf(cookie);
    expect(cur.people[0]?.backMinor).toBe(0);
  });

  it("only on money lent", async () => {
    const { cookie } = await setUp();
    const b = borrow();
    await send("POST", "/api/people", b, cookie);
    const res = await send(
      "POST",
      `/api/people/${b.id}/back`,
      { id: id(), amountMinor: 1, toSavingsMinor: 0 },
      cookie,
    );
    expect(await res.json()).toMatchObject({ problems: ["entry"] });
  });

  it("an entry with something back can't be deleted", async () => {
    const { cookie } = await setUp();
    const b = lend();
    await send("POST", "/api/people", b, cookie);
    await send("POST", `/api/people/${b.id}/back`, { id: id(), amountMinor: 1, toSavingsMinor: 0 }, cookie);
    expect((await send("DELETE", `/api/people/${b.id}`, undefined, cookie)).status).toBe(409);
  });
});

describe("I borrowed (spec 9)", () => {
  it("comes in as a borrowed income split like extra income, with its payback set aside", async () => {
    const { cookie } = await setUp();
    const paybackId = id();
    const b = borrow({ payback: { id: paybackId, plannedMinor: 2_000_000, dueOn: today() } });
    expect((await send("POST", "/api/people", b, cookie)).status).toBe(201);
    const cur = await currentOf(cookie);
    expect(cur.incomes).toContainEqual(
      expect.objectContaining({
        id: b.incomeId,
        kind: "borrowed",
        amountMinor: 2_000_000,
        toSavingsMinor: 500_000,
      }),
    );
    expect(cur.people[0]).toMatchObject({ direction: "borrowed", incomeId: b.incomeId });
    expect(cur.commitments).toContainEqual(
      expect.objectContaining({
        id: paybackId,
        name: "Pay back Kamal",
        kind: "person_payback",
        plannedMinor: 2_000_000,
        dueOn: today(),
        personDebtId: b.id,
      }),
    );
  });

  it("borrowed and paid back can't be added on /api/incomes (they need their person)", async () => {
    const { cookie } = await setUp();
    for (const kind of ["borrowed", "paid_back"]) {
      const res = await send(
        "POST",
        "/api/incomes",
        { id: id(), kind, amountMinor: 1, toSavingsMinor: 0 },
        cookie,
      );
      expect(res.status).toBe(400);
    }
  });

  it("payments on its paybacks pay it back; nothing owed closes it", async () => {
    const { cookie } = await setUp();
    const paybackId = id();
    const b = borrow({ payback: { id: paybackId, plannedMinor: 1_500_000, dueOn: today() } });
    await send("POST", "/api/people", b, cookie);
    expect((await pay(paybackId, 1_500_000, cookie)).status).toBe(201);
    expect((await currentOf(cookie)).people[0]?.backMinor).toBe(1_500_000);
    // A second payback for the rest, filled from what is owed; never more.
    const over = { id: id(), plannedMinor: 500_001, dueOn: today() };
    expect(await (await send("POST", `/api/people/${b.id}/payback`, over, cookie)).json()).toMatchObject({
      problems: ["too_much"],
    });
    const rest = { id: id(), plannedMinor: 500_000, dueOn: today() };
    expect((await send("POST", `/api/people/${b.id}/payback`, rest, cookie)).status).toBe(201);
    // While it is open, nothing more fits.
    const more = { id: id(), plannedMinor: 1, dueOn: today() };
    expect((await send("POST", `/api/people/${b.id}/payback`, more, cookie)).status).toBe(400);
    await pay(rest.id, 500_000, cookie);
    const cur = await currentOf(cookie);
    expect(cur.people[0]?.backMinor).toBe(2_000_000);
    // Something paid back: it can't be deleted.
    expect((await send("DELETE", `/api/people/${b.id}`, undefined, cookie)).status).toBe(409);
  });

  it("delete (the toast's Undo) removes the entry, its income and its paybacks", async () => {
    const { cookie } = await setUp();
    const paybackId = id();
    const b = borrow({ payback: { id: paybackId, plannedMinor: 2_000_000, dueOn: today() } });
    await send("POST", "/api/people", b, cookie);
    expect((await send("DELETE", `/api/people/${b.id}`, undefined, cookie)).status).toBe(200);
    const cur = await currentOf(cookie);
    expect(cur.people).toEqual([]);
    expect(cur.incomes.some((i) => i.kind === "borrowed")).toBe(false);
    expect(cur.commitments.some((k) => k.id === paybackId)).toBe(false);
  });

  it("a payback is never Every cycle, can be deleted while unpaid", async () => {
    const { cookie } = await setUp();
    const paybackId = id();
    await send(
      "POST",
      "/api/people",
      borrow({ payback: { id: paybackId, plannedMinor: 1, dueOn: today() } }),
      cookie,
    );
    const repeat = await send(
      "PATCH",
      `/api/commitments/${paybackId}`,
      { everyCycle: true, recurringId: id() },
      cookie,
    );
    expect(repeat.status).toBe(400);
    expect((await send("DELETE", `/api/commitments/${paybackId}`, undefined, cookie)).status).toBe(200);
  });
});

describe("Settled (spec 9)", () => {
  it("closes an entry and finishes this cycle's open paybacks; Undo reopens both", async () => {
    const { cookie } = await setUp();
    const paybackId = id();
    const b = borrow({ payback: { id: paybackId, plannedMinor: 2_000_000, dueOn: today() } });
    await send("POST", "/api/people", b, cookie);
    expect((await send("PATCH", `/api/people/${b.id}`, { settled: true }, cookie)).status).toBe(200);
    let cur = await currentOf(cookie);
    expect(cur.people[0]?.settledOn).toBe(today());
    expect(cur.commitments.find((k) => k.id === paybackId)?.state).toBe("finished");
    // Closed: no payback can be added.
    const more = { id: id(), plannedMinor: 1, dueOn: today() };
    expect(await (await send("POST", `/api/people/${b.id}/payback`, more, cookie)).json()).toMatchObject({
      problems: ["entry"],
    });
    expect((await send("PATCH", `/api/people/${b.id}`, { settled: false }, cookie)).status).toBe(200);
    cur = await currentOf(cookie);
    expect(cur.people[0]?.settledOn).toBeNull();
    expect(cur.commitments.find((k) => k.id === paybackId)?.state).toBe("open");
  });
});

describe("salary day with people (spec 6, 9)", () => {
  it("a coming-up payback moves on with its entry; a new one can't be made there", async () => {
    const { cookie, expectedSalaryOn } = await setUp();
    const paybackId = id();
    const b = borrow({
      payback: { id: paybackId, plannedMinor: 2_000_000, dueOn: addDays(expectedSalaryOn, 5) },
    });
    await send("POST", "/api/people", b, cookie);
    const row = {
      id: id(),
      kind: "person_payback",
      name: "Pay back Kamal",
      plannedMinor: 2_000_000,
      dueOn: addDays(expectedSalaryOn, 5),
    };
    const fresh = await send("POST", "/api/salary-day", salaryDay([row]), cookie);
    expect(await fresh.json()).toMatchObject({ problems: ["commitment.0.person"] });
    const moved = { ...row, carriedFromId: paybackId };
    expect((await send("POST", "/api/salary-day", salaryDay([moved]), cookie)).status).toBe(201);
    const cur = await currentOf(cookie);
    expect(cur.commitments).toContainEqual(
      expect.objectContaining({
        id: row.id,
        kind: "person_payback",
        personDebtId: b.id,
        carriedFromId: paybackId,
      }),
    );
  });

  it("money lent comes out of the leftover of the cycle it was lent in", async () => {
    const { cookie } = await setUp();
    // Rs 90,000 held, Rs 5,000 lent: Rs 85,000 left over.
    await send("POST", "/api/people", lend(), cookie);
    expect((await send("POST", "/api/salary-day", salaryDay([]), cookie)).status).toBe(201);
    const cur = await currentOf(cookie);
    expect(cur.incomes).toContainEqual(expect.objectContaining({ kind: "leftover", amountMinor: 8_500_000 }));
    // The entry stays across cycles; made in an ended cycle, it can't be deleted, only settled.
    expect(cur.people).toHaveLength(1);
    const lentId = cur.people[0]?.id as string;
    expect((await send("DELETE", `/api/people/${lentId}`, undefined, cookie)).status).toBe(409);
    expect((await send("PATCH", `/api/people/${lentId}`, { settled: true }, cookie)).status).toBe(200);
  });

  it("an entry made after salary day blocks Undo salary day", async () => {
    const { cookie } = await setUp();
    expect((await send("POST", "/api/salary-day", salaryDay([]), cookie)).status).toBe(201);
    expect((await currentOf(cookie)).undoSalaryDay).toBe(true);
    await new Promise((r) => setTimeout(r, 5));
    await send("POST", "/api/people", lend(), cookie);
    expect((await currentOf(cookie)).undoSalaryDay).toBe(false);
  });
});
