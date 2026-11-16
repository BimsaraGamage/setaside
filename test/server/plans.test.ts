import { env } from "cloudflare:workers";
import { describe, expect, it } from "vitest";
import { addDays, suggestSalaryDay, todayIn } from "../../src/money";
import { call, signIn } from "./helpers";

// Item 19 · Instalment plans (spec 9).

const TZ = "Asia/Colombo";
const today = () => todayIn(TZ, Date.now());
const id = () => crypto.randomUUID();

const TABLES = ["instalment_plan", "prepayment", "recurring_commitment", "pot", "cycle", "card", "settings"];

/** A fresh user with first use done 20 days ago (Rs 90,000 held) and Rs 100,000 put in savings. */
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
  const put = { id: id(), kind: "put_in", amountMinor: 10_000_000 };
  expect((await send("POST", "/api/savings-movements", put, u.cookie)).status).toBe(201);
  return { ...u, cycleId, expectedSalaryOn };
}

const send = (method: string, path: string, body: unknown, cookie: string) =>
  call(path, { method, body: body === undefined ? undefined : JSON.stringify(body) }, cookie);

interface Current {
  cycle: { id: string };
  savings: { id: string; kind: string; amountMinor: number; name: string | null }[];
  incomes: { id: string; kind: string; amountMinor: number }[];
  plans: {
    id: string;
    name: string;
    paidMinor: number;
    paymentsMade: number;
    extraMinor: number;
    paidOffOn: string | null;
    cardId: string | null;
    extras: { id: string; amountMinor: number; paidFrom: string; paysOff: boolean }[];
  }[];
  commitments: {
    id: string;
    name: string;
    kind: string;
    plannedMinor: number;
    dueOn: string;
    state: string;
    planId: string | null;
    recurringId: string | null;
  }[];
  undoSalaryDay: boolean;
}

const currentOf = async (cookie: string) => (await call("/api/current", {}, cookie)).json<Current>();

/** A phone: 12 payments of Rs 10,000 for a Rs 108,000 price, the first one today. */
const phone = (more: Record<string, unknown> = {}) => ({
  id: id(),
  commitmentId: id(),
  name: " Phone ",
  priceMinor: 10_800_000,
  paymentCount: 12,
  paymentMinor: 1_000_000,
  firstPaymentOn: today(),
  ...more,
});

const savingsOf = (cur: Current) => cur.savings.reduce((t, l) => t + l.amountMinor, 0);

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

describe("new loan or instalments (item 19, spec 9)", () => {
  it("makes the plan and sets this cycle's payment aside at once when it falls in this cycle", async () => {
    const { cookie } = await setUp();
    const b = phone();
    expect((await send("POST", "/api/plans", b, cookie)).status).toBe(201);
    const cur = await currentOf(cookie);
    expect(cur.plans).toEqual([
      expect.objectContaining({
        id: b.id,
        name: "Phone",
        paidMinor: 0,
        paymentsMade: 0,
        extraMinor: 0,
        extras: [],
      }),
    ]);
    expect(cur.commitments).toContainEqual(
      expect.objectContaining({
        id: b.commitmentId,
        name: "Phone",
        kind: "plan_payment",
        plannedMinor: 1_000_000,
        dueOn: today(),
        state: "open",
        planId: b.id,
        recurringId: null,
      }),
    );
  });

  it("a first payment after the expected salary day waits for salary day", async () => {
    const { cookie, expectedSalaryOn } = await setUp();
    const b = phone({ firstPaymentOn: addDays(expectedSalaryOn, 5) });
    expect((await send("POST", "/api/plans", b, cookie)).status).toBe(201);
    const cur = await currentOf(cookie);
    expect(cur.plans).toHaveLength(1);
    expect(cur.commitments.filter((k) => k.kind === "plan_payment")).toEqual([]);
  });

  it("refuses payments adding up to less than the price, a first payment before this cycle, a card of another currency", async () => {
    const { cookie } = await setUp();
    const card = id();
    expect((await send("POST", "/api/cards", { id: card, name: "Visa" }, cookie)).status).toBe(201);
    const short = await send("POST", "/api/plans", phone({ paymentMinor: 800_000 }), cookie);
    expect(short.status).toBe(400);
    expect(await short.json()).toMatchObject({ problems: ["total"] });
    const early = await send("POST", "/api/plans", phone({ firstPaymentOn: addDays(today(), -30) }), cookie);
    expect(await early.json()).toMatchObject({ problems: ["first_on"] });
    const other = await send("POST", "/api/plans", phone({ cardId: id() }), cookie);
    expect(await other.json()).toMatchObject({ problems: ["card"] });
    const onCard = phone({ cardId: card });
    expect((await send("POST", "/api/plans", onCard, cookie)).status).toBe(201);
    expect((await currentOf(cookie)).plans[0]?.cardId).toBe(card);
  });

  it("an id already in use is a conflict", async () => {
    const { cookie } = await setUp();
    const b = phone();
    expect((await send("POST", "/api/plans", b, cookie)).status).toBe(201);
    expect((await send("POST", "/api/plans", { ...b, commitmentId: id() }, cookie)).status).toBe(409);
  });
});

describe("paying a plan (spec 9)", () => {
  it("payments on its plan payments count as paid; a finished one is one payment made", async () => {
    const { cookie } = await setUp();
    const b = phone();
    await send("POST", "/api/plans", b, cookie);
    expect((await pay(b.commitmentId, 600_000, cookie, false)).status).toBe(201);
    let plan = (await currentOf(cookie)).plans[0];
    expect(plan).toMatchObject({ paidMinor: 600_000, paymentsMade: 0 });
    expect((await pay(b.commitmentId, 400_000, cookie)).status).toBe(201);
    plan = (await currentOf(cookie)).plans[0];
    expect(plan).toMatchObject({ paidMinor: 1_000_000, paymentsMade: 1 });
  });

  it("its payment can't be deleted, only changed or marked finished; the plan can't be deleted once paid", async () => {
    const { cookie } = await setUp();
    const b = phone();
    await send("POST", "/api/plans", b, cookie);
    expect((await send("DELETE", `/api/commitments/${b.commitmentId}`, undefined, cookie)).status).toBe(409);
    await pay(b.commitmentId, 1_000_000, cookie);
    expect((await send("DELETE", `/api/plans/${b.id}`, undefined, cookie)).status).toBe(409);
  });

  it("deleting an unpaid plan (the toast's Undo) deletes its payment too", async () => {
    const { cookie } = await setUp();
    const b = phone();
    await send("POST", "/api/plans", b, cookie);
    expect((await send("DELETE", `/api/plans/${b.id}`, undefined, cookie)).status).toBe(200);
    const cur = await currentOf(cookie);
    expect(cur.plans).toEqual([]);
    expect(cur.commitments.filter((k) => k.planId === b.id)).toEqual([]);
  });
});

describe("Pay extra and Pay it all off (spec 9)", () => {
  it("pay extra from free money: at most what is left past this cycle's payment", async () => {
    const { cookie } = await setUp();
    const b = phone();
    await send("POST", "/api/plans", b, cookie);
    const tooMuch = { id: id(), amountMinor: 11_000_001, from: "free" };
    expect((await send("POST", `/api/plans/${b.id}/extra`, tooMuch, cookie)).status).toBe(400);
    const x = { id: id(), amountMinor: 3_000_000, from: "free" };
    expect((await send("POST", `/api/plans/${b.id}/extra`, x, cookie)).status).toBe(201);
    const cur = await currentOf(cookie);
    expect(cur.plans[0]).toMatchObject({ extraMinor: 3_000_000, paidOffOn: null });
    expect(cur.plans[0]?.extras).toEqual([
      expect.objectContaining({ id: x.id, paidFrom: "free", paysOff: false }),
    ]);
    // Not from savings: savings stay.
    expect(savingsOf(cur)).toBe(10_000_000);
  });

  it("from savings: savings drop, listed with the plan's name; never more than is saved", async () => {
    const { cookie } = await setUp();
    const b = phone();
    await send("POST", "/api/plans", b, cookie);
    const over = { id: id(), amountMinor: 10_000_001, from: "savings", paysOff: true };
    const res = await send("POST", `/api/plans/${b.id}/extra`, over, cookie);
    expect(await res.json()).toMatchObject({ problems: ["savings"] });
    const x = { id: id(), amountMinor: 2_000_000, from: "savings" };
    expect((await send("POST", `/api/plans/${b.id}/extra`, x, cookie)).status).toBe(201);
    const cur = await currentOf(cookie);
    expect(savingsOf(cur)).toBe(8_000_000);
    expect(cur.savings).toContainEqual(
      expect.objectContaining({ id: x.id, kind: "plan_extra", amountMinor: -2_000_000, name: "Phone" }),
    );
    // Undo puts savings back.
    expect((await send("DELETE", `/api/plans/extra/${x.id}`, undefined, cookie)).status).toBe(200);
    expect(savingsOf(await currentOf(cookie))).toBe(10_000_000);
  });

  it("pay it all off ends the plan and finishes this cycle's payment; Undo reopens both", async () => {
    const { cookie } = await setUp();
    const b = phone();
    await send("POST", "/api/plans", b, cookie);
    const x = { id: id(), amountMinor: 11_500_000, from: "free", paysOff: true };
    expect((await send("POST", `/api/plans/${b.id}/extra`, x, cookie)).status).toBe(201);
    let cur = await currentOf(cookie);
    expect(cur.plans[0]?.paidOffOn).toBe(today());
    expect(cur.commitments.find((k) => k.id === b.commitmentId)?.state).toBe("finished");
    // Nothing more to pay on a paid-off plan.
    const again = { id: id(), amountMinor: 1, from: "free" };
    expect((await send("POST", `/api/plans/${b.id}/extra`, again, cookie)).status).toBe(409);
    expect((await send("DELETE", `/api/plans/extra/${x.id}`, undefined, cookie)).status).toBe(200);
    cur = await currentOf(cookie);
    expect(cur.plans[0]).toMatchObject({ paidOffOn: null, extraMinor: 0 });
    expect(cur.commitments.find((k) => k.id === b.commitmentId)?.state).toBe("open");
  });
});

describe("salary day with plans (spec 6, 9)", () => {
  it("takes a plan payment for one of the user's plans; never Every cycle, never without its plan", async () => {
    const { cookie, expectedSalaryOn } = await setUp();
    const b = phone({ firstPaymentOn: addDays(expectedSalaryOn, 5) });
    await send("POST", "/api/plans", b, cookie);
    const row = {
      id: id(),
      kind: "plan_payment",
      planId: b.id,
      name: "Phone",
      plannedMinor: 1_000_000,
      dueOn: addDays(today(), 5),
    };
    const noPlan = await send("POST", "/api/salary-day", salaryDay([{ ...row, planId: null }]), cookie);
    expect(await noPlan.json()).toMatchObject({ problems: ["commitment.0.plan"] });
    const repeats = await send("POST", "/api/salary-day", salaryDay([{ ...row, everyCycle: true }]), cookie);
    expect(await repeats.json()).toMatchObject({ problems: ["commitment.0.plan"] });
    const notMine = await send("POST", "/api/salary-day", salaryDay([{ ...row, planId: id() }]), cookie);
    expect(await notMine.json()).toMatchObject({ problems: ["commitment.0.plan"] });
    expect((await send("POST", "/api/salary-day", salaryDay([row]), cookie)).status).toBe(201);
    const cur = await currentOf(cookie);
    expect(cur.commitments).toContainEqual(
      expect.objectContaining({ id: row.id, kind: "plan_payment", planId: b.id, recurringId: null }),
    );
  });

  it("a paid-off plan gets no payment", async () => {
    const { cookie, expectedSalaryOn } = await setUp();
    const b = phone({ firstPaymentOn: addDays(expectedSalaryOn, 5) });
    await send("POST", "/api/plans", b, cookie);
    const off = { id: id(), amountMinor: 12_000_000, from: "free", paysOff: true };
    expect((await send("POST", `/api/plans/${b.id}/extra`, off, cookie)).status).toBe(201);
    const row = {
      id: id(),
      kind: "plan_payment",
      planId: b.id,
      name: "Phone",
      plannedMinor: 1,
      dueOn: today(),
    };
    const res = await send("POST", "/api/salary-day", salaryDay([row]), cookie);
    // (Paying it off took free money below zero, so the overspend choice is asked too.)
    expect((await res.json<{ problems: string[] }>()).problems).toContain("commitment.0.plan");
  });

  it("a plan made after salary day blocks Undo salary day", async () => {
    const { cookie } = await setUp();
    expect((await send("POST", "/api/salary-day", salaryDay([]), cookie)).status).toBe(201);
    expect((await currentOf(cookie)).undoSalaryDay).toBe(true);
    // A later moment than salary day's stamp.
    await new Promise((r) => setTimeout(r, 5));
    await send("POST", "/api/plans", phone(), cookie);
    expect((await currentOf(cookie)).undoSalaryDay).toBe(false);
  });
});

describe("loan money received as cash (spec 5, 9)", () => {
  it("is added on Add income, split like extra income, and undone like it", async () => {
    const { cookie } = await setUp();
    const b = { id: id(), kind: "loan", amountMinor: 5_000_000, toSavingsMinor: 1_000_000 };
    expect((await send("POST", "/api/incomes", b, cookie)).status).toBe(201);
    const cur = await currentOf(cookie);
    expect(cur.incomes).toContainEqual(
      expect.objectContaining({ id: b.id, kind: "loan", amountMinor: 5_000_000 }),
    );
    expect(savingsOf(cur)).toBe(11_000_000);
    expect((await send("DELETE", `/api/incomes/${b.id}`, undefined, cookie)).status).toBe(200);
  });
});
