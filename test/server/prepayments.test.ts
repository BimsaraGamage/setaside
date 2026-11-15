import { env } from "cloudflare:workers";
import { describe, expect, it } from "vitest";
import { addDays, suggestSalaryDay, todayIn } from "../../src/money";
import { call, signIn } from "./helpers";

// Item 14 · Prepayment from savings (spec 5).

const TZ = "Asia/Colombo";
const today = () => todayIn(TZ, Date.now());
const id = () => crypto.randomUUID();

const TABLES = ["prepayment", "recurring_commitment", "pot", "cycle", "settings"];

/** A fresh user with first use done 20 days ago (Rs 90,000 held) and Rs 100,000 put in savings. */
async function setUp() {
  const u = await signIn("second");
  for (const t of TABLES) await env.DB.prepare(`delete from "${t}" where user_id = ?`).bind(u.id).run();
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
  await env.DB.prepare("update cycle set started_on = ? where id = ?")
    .bind(addDays(today(), -20), cycleId)
    .run();
  const put = { id: id(), kind: "put_in", amountMinor: 10_000_000 };
  expect((await send("POST", "/api/savings-movements", put, u.cookie)).status).toBe(201);
  return { ...u, cycleId };
}

const send = (method: string, path: string, body: unknown, cookie: string) =>
  call(path, { method, body: body === undefined ? undefined : JSON.stringify(body) }, cookie);

interface Current {
  cycle: { id: string };
  savings: { id: string; kind: string; amountMinor: number; on: string; name: string | null }[];
  prepayments: {
    id: string;
    name: string;
    totalMinor: number;
    paybackMinor: number;
    paidBackMinor: number;
    startedOn: string;
  }[];
  commitments: {
    id: string;
    name: string;
    kind: string;
    plannedMinor: number;
    dueOn: string;
    state: string;
    prepaymentId: string | null;
    recurringId: string | null;
  }[];
}

const currentOf = async (cookie: string) => (await call("/api/current", {}, cookie)).json<Current>();

const gym = (more: Record<string, unknown> = {}) => ({
  id: id(),
  movementId: id(),
  commitmentId: id(),
  name: " Gym ",
  totalMinor: 6_000_000,
  paybackMinor: 500_000,
  ...more,
});

const savingsOf = (cur: Current) => cur.savings.reduce((t, l) => t + l.amountMinor, 0);

/** A salary day today with nothing in it but the salary and `commitments`. */
const salaryDay = (commitments: unknown[], unpaid: unknown[] = []) => ({
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
    unpaid,
    inHandMinor: null,
    toSavingsMinor: 0,
    overspend: null,
  },
});

describe("take out of savings for a prepayment (item 14, spec 5)", () => {
  it("savings drop by the whole amount; this cycle's payback is set aside at once, due today", async () => {
    const { cookie, cycleId } = await setUp();
    const b = gym();
    const res = await send("POST", "/api/prepayments", b, cookie);
    expect(res.status).toBe(201);
    const cur = await currentOf(cookie);
    expect(savingsOf(cur)).toBe(4_000_000);
    expect(cur.savings).toContainEqual(
      expect.objectContaining({ id: b.movementId, kind: "prepayment", amountMinor: -6_000_000, name: "Gym" }),
    );
    // Not a take-out: it paid for the gym, so free money does not rise.
    expect(cur.savings.filter((l) => l.kind === "take_out")).toEqual([]);
    expect(cur.commitments).toContainEqual(
      expect.objectContaining({
        id: b.commitmentId,
        name: "Gym",
        kind: "savings_payback",
        plannedMinor: 500_000,
        dueOn: today(),
        state: "open",
        prepaymentId: b.id,
        recurringId: null,
      }),
    );
    expect(cur.prepayments).toEqual([
      {
        id: b.id,
        name: "Gym",
        currency: "LKR",
        totalMinor: 6_000_000,
        paybackMinor: 500_000,
        paidBackMinor: 0,
        startedOn: today(),
      },
    ]);
    expect(cur.cycle.id).toBe(cycleId);
  });

  it("refuses more than is saved, a payback above the whole amount, and no name", async () => {
    const { cookie } = await setUp();
    const bad = async (more: Record<string, unknown>) => {
      const res = await send("POST", "/api/prepayments", gym(more), cookie);
      expect(res.status).toBe(400);
      return (await res.json<{ problems: string[] }>()).problems;
    };
    expect(await bad({ totalMinor: 10_000_001 })).toEqual(["too_much"]);
    expect(await bad({ paybackMinor: 6_000_001 })).toEqual(["payback"]);
    expect(await bad({ name: "  " })).toEqual(["name"]);
    expect((await currentOf(cookie)).prepayments).toEqual([]);
  });

  it("an id already in use changes nothing", async () => {
    const { cookie } = await setUp();
    const b = gym();
    await send("POST", "/api/prepayments", b, cookie);
    const again = { ...gym({ totalMinor: 1_000_000 }), commitmentId: b.commitmentId };
    expect((await send("POST", "/api/prepayments", again, cookie)).status).toBe(409);
    const cur = await currentOf(cookie);
    expect(cur.prepayments.map((p) => p.id)).toEqual([b.id]);
    expect(savingsOf(cur)).toBe(4_000_000);
  });

  it("moving the payback puts it back into savings and shows as paid back", async () => {
    const { cookie } = await setUp();
    const b = gym();
    await send("POST", "/api/prepayments", b, cookie);
    const pay = { id: id(), amountMinor: 500_000, paidOn: today(), finish: true };
    expect((await send("POST", `/api/commitments/${b.commitmentId}/payments`, pay, cookie)).status).toBe(201);
    const cur = await currentOf(cookie);
    expect(savingsOf(cur)).toBe(4_500_000);
    expect(cur.savings).toContainEqual(
      expect.objectContaining({ id: pay.id, kind: "payback", amountMinor: 500_000, name: "Gym" }),
    );
    expect(cur.prepayments[0]?.paidBackMinor).toBe(500_000);
  });

  it("Undo removes it all while nothing is paid back", async () => {
    const { cookie } = await setUp();
    const b = gym();
    await send("POST", "/api/prepayments", b, cookie);
    expect((await send("DELETE", `/api/prepayments/${b.id}`, undefined, cookie)).status).toBe(200);
    const cur = await currentOf(cookie);
    expect(cur.prepayments).toEqual([]);
    expect(cur.commitments).toEqual([]);
    expect(savingsOf(cur)).toBe(10_000_000);

    const c = gym();
    await send("POST", "/api/prepayments", c, cookie);
    const pay = { id: id(), amountMinor: 100_000, paidOn: today() };
    await send("POST", `/api/commitments/${c.commitmentId}/payments`, pay, cookie);
    expect((await send("DELETE", `/api/prepayments/${c.id}`, undefined, cookie)).status).toBe(409);
  });

  it("the payback can be changed and finished, not deleted or turned into a bill", async () => {
    const { cookie } = await setUp();
    const b = gym();
    await send("POST", "/api/prepayments", b, cookie);
    const path = `/api/commitments/${b.commitmentId}`;
    expect((await send("DELETE", path, undefined, cookie)).status).toBe(409);
    expect((await send("PATCH", path, { kind: "bill" }, cookie)).status).toBe(400);
    expect((await send("PATCH", path, { everyCycle: true, recurringId: id() }, cookie)).status).toBe(400);
    expect((await send("PATCH", path, { plannedMinor: 300_000, state: "finished" }, cookie)).status).toBe(
      200,
    );
    const k = (await currentOf(cookie)).commitments.find((x) => x.id === b.commitmentId);
    expect(k).toMatchObject({ kind: "savings_payback", plannedMinor: 300_000, state: "finished" });
  });
});

describe("salary day sets aside the next payback (item 14, spec 5, 6)", () => {
  it("takes a payback row for the user's prepayment; an unpaid one carried keeps its prepayment", async () => {
    const { cookie } = await setUp();
    const b = gym();
    await send("POST", "/api/prepayments", b, cookie);
    const row = {
      id: id(),
      kind: "savings_payback",
      prepaymentId: b.id,
      name: "Gym",
      plannedMinor: 500_000,
      dueOn: today(),
    };
    const carried = id();
    const res = await send(
      "POST",
      "/api/salary-day",
      salaryDay([row], [{ id: b.commitmentId, choice: "carry", newId: carried }]),
      cookie,
    );
    expect(res.status).toBe(201);
    const cur = await currentOf(cookie);
    expect(cur.commitments).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: row.id,
          kind: "savings_payback",
          prepaymentId: b.id,
          recurringId: null,
        }),
        expect.objectContaining({ id: carried, kind: "savings_payback", prepaymentId: b.id }),
      ]),
    );
    // The prepayment's money came out in the cycle before: Undo is no longer for it.
    expect((await send("DELETE", `/api/prepayments/${b.id}`, undefined, cookie)).status).toBe(409);
  });

  it("refuses a payback as Every cycle, without its prepayment, or for another user's prepayment", async () => {
    const { cookie } = await setUp();
    const b = gym();
    await send("POST", "/api/prepayments", b, cookie);
    const other = await signIn("demo");
    const theirs = id();
    const now = Date.now();
    await env.DB.prepare(
      "insert into prepayment (id, user_id, name, currency, total_minor, payback_minor, created_at, updated_at) values (?, ?, 'Theirs', 'LKR', 100, 100, ?, ?)",
    )
      .bind(theirs, other.id, now, now)
      .run();
    const row = (more: Record<string, unknown>) => ({
      id: id(),
      kind: "savings_payback",
      prepaymentId: b.id,
      name: "Gym",
      plannedMinor: 500_000,
      dueOn: today(),
      ...more,
    });
    const problems = async (r: unknown) => {
      const unpaid = [{ id: b.commitmentId, choice: "drop" }];
      const res = await send("POST", "/api/salary-day", salaryDay([r], unpaid), cookie);
      expect(res.status).toBe(400);
      return (await res.json<{ problems: string[] }>()).problems;
    };
    expect(await problems(row({ everyCycle: true, recurringId: id() }))).toContain("commitment.0.kind");
    expect(await problems(row({ prepaymentId: null }))).toContain("commitment.0.kind");
    expect(await problems(row({ kind: "bill" }))).toContain("commitment.0.kind");
    expect(await problems(row({ prepaymentId: theirs }))).toContain("commitment.0.prepayment");
    await env.DB.prepare("delete from prepayment where id = ?").bind(theirs).run();
  });
});
