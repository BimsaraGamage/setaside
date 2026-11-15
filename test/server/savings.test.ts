import { env } from "cloudflare:workers";
import { describe, expect, it } from "vitest";
import { suggestSalaryDay, todayIn } from "../../src/money";
import { call, signIn } from "./helpers";

// Item 10 · Savings and extra income (spec 5).

const TZ = "Asia/Colombo";
const today = () => todayIn(TZ, Date.now());

const TABLES = ["savings_movement", "commitment", "spend", "income", "cycle", "settings"];

/** A fresh user with first use done today: Rs 90,000 held. */
async function setUp() {
  const u = await signIn("second");
  for (const t of TABLES) await env.DB.prepare(`delete from "${t}" where user_id = ?`).bind(u.id).run();
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

interface Line {
  id: string;
  kind: string;
  amountMinor: number;
  on: string;
  name: string | null;
}

async function currentOf(cookie: string) {
  return (await call("/api/current", {}, cookie)).json<{
    savings: Line[];
    incomes: { id: string; kind: string; amountMinor: number; toSavingsMinor: number; receivedOn: string }[];
    commitments: { id: string; kind: string }[];
  }>();
}

const move = (kind: string, amountMinor: number) => ({ id: crypto.randomUUID(), kind, amountMinor });

describe("savings (item 10, spec 5)", () => {
  it("Put in and Take out are dated today and listed newest first, take-outs below zero", async () => {
    const { cookie, cycleId } = await setUp();
    const a = move("put_in", 5_000_000);
    const b = move("take_out", 1_200_000);
    expect((await send("POST", "/api/savings-movements", a, cookie)).status).toBe(201);
    expect((await send("POST", "/api/savings-movements", b, cookie)).status).toBe(201);
    const { savings } = await currentOf(cookie);
    expect(savings).toEqual(
      expect.arrayContaining([
        {
          id: a.id,
          kind: "put_in",
          cycleId,
          currency: "LKR",
          amountMinor: 5_000_000,
          on: today(),
          name: null,
        },
        {
          id: b.id,
          kind: "take_out",
          cycleId,
          currency: "LKR",
          amountMinor: -1_200_000,
          on: today(),
          name: null,
        },
      ]),
    );
    expect(savings).toHaveLength(2);
  });

  it("Take out can't go past what is saved", async () => {
    const { cookie } = await setUp();
    await send("POST", "/api/savings-movements", move("put_in", 500_000), cookie);
    const res = await send("POST", "/api/savings-movements", move("take_out", 500_001), cookie);
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "invalid", problems: ["too_much"] });
    expect((await send("POST", "/api/savings-movements", move("take_out", 500_000), cookie)).status).toBe(
      201,
    );
  });

  it("refuses zero, below zero, and other kinds", async () => {
    const { cookie } = await setUp();
    for (const body of [move("put_in", 0), move("put_in", -5), move("opening", 5), move("prepayment", 5)]) {
      expect((await send("POST", "/api/savings-movements", body, cookie)).status).toBe(400);
    }
    expect((await currentOf(cookie)).savings).toEqual([]);
  });

  it("delete (Undo) removes a movement of the current cycle; an ended cycle's is locked", async () => {
    const { cookie, id: userId } = await setUp();
    const a = move("put_in", 5_000_000);
    await send("POST", "/api/savings-movements", a, cookie);
    expect((await send("DELETE", `/api/savings-movements/${a.id}`, undefined, cookie)).status).toBe(200);
    expect((await currentOf(cookie)).savings).toEqual([]);

    const b = move("put_in", 5_000_000);
    await send("POST", "/api/savings-movements", b, cookie);
    // A newer cycle starts: the old one is locked.
    const now = Date.now();
    await env.DB.prepare(
      "insert into cycle (id, user_id, started_on, expected_salary_on, created_at, updated_at) values (?, ?, '2999-01-01', '2999-02-01', ?, ?)",
    )
      .bind(crypto.randomUUID(), userId, now, now)
      .run();
    expect((await send("DELETE", `/api/savings-movements/${b.id}`, undefined, cookie)).status).toBe(409);
    // Savings last across cycles.
    expect((await currentOf(cookie)).savings.map((l) => l.id)).toEqual([b.id]);
  });
});

describe("add income (item 10, spec 5)", () => {
  it("extra income is stored in the current cycle, dated today, with its split", async () => {
    const { cookie } = await setUp();
    const id = crypto.randomUUID();
    const res = await send(
      "POST",
      "/api/incomes",
      { id, kind: "extra", amountMinor: 5_000_000, toSavingsMinor: 2_000_000 },
      cookie,
    );
    expect(res.status).toBe(201);
    const cur = await currentOf(cookie);
    expect(cur.incomes.find((i) => i.id === id)).toEqual(
      expect.objectContaining({
        kind: "extra",
        amountMinor: 5_000_000,
        toSavingsMinor: 2_000_000,
        receivedOn: today(),
      }),
    );
    // The savings part is a savings movement.
    expect(cur.savings).toEqual([expect.objectContaining({ id, kind: "income", amountMinor: 2_000_000 })]);
  });

  it("refuses a split past the amount, and kinds that come with later items", async () => {
    const { cookie } = await setUp();
    for (const body of [
      { kind: "extra", amountMinor: 100, toSavingsMinor: 101 },
      { kind: "extra", amountMinor: 0, toSavingsMinor: 0 },
      { kind: "salary", amountMinor: 100, toSavingsMinor: 0 },
      { kind: "loan", amountMinor: 100, toSavingsMinor: 0 },
    ]) {
      expect((await send("POST", "/api/incomes", { id: crypto.randomUUID(), ...body }, cookie)).status).toBe(
        400,
      );
    }
    expect((await currentOf(cookie)).incomes).toHaveLength(1);
  });

  it("delete (Undo) removes extra income only, never the opening money", async () => {
    const { cookie } = await setUp();
    const id = crypto.randomUUID();
    await send("POST", "/api/incomes", { id, kind: "extra", amountMinor: 100, toSavingsMinor: 0 }, cookie);
    expect((await send("DELETE", `/api/incomes/${id}`, undefined, cookie)).status).toBe(200);
    const [opening] = (await currentOf(cookie)).incomes;
    expect(opening?.kind).toBe("opening");
    expect((await send("DELETE", `/api/incomes/${opening?.id}`, undefined, cookie)).status).toBe(404);
  });
});

describe("savings set-aside (item 10, spec 3, 5)", () => {
  it("is a commitment kind; what is moved on it counts as savings, all cycles", async () => {
    const { cookie } = await setUp();
    const k = {
      id: crypto.randomUUID(),
      kind: "savings",
      name: "Savings",
      plannedMinor: 2_000_000,
      dueOn: today(),
    };
    expect((await send("POST", "/api/commitments", k, cookie)).status).toBe(201);
    const p = { id: crypto.randomUUID(), amountMinor: 2_000_000, paidOn: today(), finish: true };
    expect((await send("POST", `/api/commitments/${k.id}/payments`, p, cookie)).status).toBe(201);
    const cur = await currentOf(cookie);
    expect(cur.commitments).toEqual([expect.objectContaining({ id: k.id, kind: "savings" })]);
    expect(cur.savings).toEqual([
      expect.objectContaining({ id: p.id, kind: "set_aside", amountMinor: 2_000_000, name: "Savings" }),
    ]);
  });

  it("a bill can be switched to savings and back; other kinds are refused", async () => {
    const { cookie } = await setUp();
    const id = crypto.randomUUID();
    await send("POST", "/api/commitments", { id, name: "Rent", plannedMinor: 100, dueOn: today() }, cookie);
    expect((await currentOf(cookie)).commitments[0]?.kind).toBe("bill");
    expect((await send("PATCH", `/api/commitments/${id}`, { kind: "savings" }, cookie)).status).toBe(200);
    expect((await currentOf(cookie)).commitments[0]?.kind).toBe("savings");
    expect((await send("PATCH", `/api/commitments/${id}`, { kind: "card_bill" }, cookie)).status).toBe(400);
    const other = { id: crypto.randomUUID(), kind: "card_bill", name: "x", plannedMinor: 1, dueOn: today() };
    expect((await send("POST", "/api/commitments", other, cookie)).status).toBe(400);
  });
});
