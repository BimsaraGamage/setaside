import { env } from "cloudflare:workers";
import { describe, expect, it } from "vitest";
import { addDays, suggestSalaryDay, todayIn } from "../../src/money";
import { call, signIn } from "./helpers";

// Savings goals (ticket SAB-68, spec 5): add with a first share, change, stop, delete, salary day's shares.

const TZ = "Asia/Colombo";
const today = () => todayIn(TZ, Date.now());
const id = () => crypto.randomUUID();
const later = (days: number) => addDays(today(), days);

interface Goal {
  id: string;
  name: string;
  currency: string;
  targetMinor: number;
  byOn: string;
  startMinor: number;
  stopped: boolean;
  movedMinor: number;
  shareCount: number;
  shares: { id: string; cycleId: string; plannedMinor: number; state: string; coveredMinor: number }[];
}

interface Current {
  cycle: { id: string };
  goals: Goal[];
  commitments: {
    id: string;
    name: string;
    kind: string;
    goalId: string | null;
    plannedMinor: number;
    dueOn: string;
  }[];
}

const send = (method: string, path: string, body: unknown, cookie: string) =>
  call(path, { method, body: body === undefined ? undefined : JSON.stringify(body) }, cookie);
const currentOf = async (cookie: string) => (await call("/api/current", {}, cookie)).json<Current>();

/** A fresh user with first use done 20 days ago: Rs 90,000 held, Rs 50,000 in savings. */
async function setUp() {
  const u = await signIn("second");
  for (const t of ["savings_goal", "savings_movement", "recurring_commitment", "pot", "cycle", "settings"]) {
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
      commitments: [],
      pots: [],
    },
    u.cookie,
  );
  expect(res.status).toBe(201);
  await env.DB.prepare("update cycle set started_on = ? where id = ?").bind(later(-20), cycleId).run();
  const put = await send(
    "POST",
    "/api/savings-movements",
    { id: id(), kind: "put_in", amountMinor: 5_000_000 },
    u.cookie,
  );
  expect(put.status).toBe(201);
  return { ...u, cycleId };
}

const japan = (more: Record<string, unknown> = {}) => ({
  id: id(),
  name: "Trip to Japan",
  targetMinor: 60_000_000,
  byOn: later(200),
  ...more,
});

describe("adding a savings goal (spec 5)", () => {
  it("saves the goal and sets its first share aside at once, due today, as a savings set-aside", async () => {
    const { cookie } = await setUp();
    const goal = japan({ startMinor: 1_000_000 });
    const shareId = id();
    const res = await send(
      "POST",
      "/api/savings-goals",
      { ...goal, share: { id: shareId, plannedMinor: 800_000 } },
      cookie,
    );
    expect(res.status).toBe(201);
    const now = await currentOf(cookie);
    expect(now.goals).toMatchObject([
      {
        id: goal.id,
        name: "Trip to Japan",
        currency: "LKR",
        targetMinor: 60_000_000,
        startMinor: 1_000_000,
        stopped: false,
        movedMinor: 0,
        shareCount: 1,
      },
    ]);
    expect(now.commitments.find((k) => k.id === shareId)).toMatchObject({
      name: "Trip to Japan",
      kind: "savings",
      goalId: goal.id,
      plannedMinor: 800_000,
      dueOn: today(),
    });
  });

  it("a first share of 0 starts on the next salary day: no share now", async () => {
    const { cookie } = await setUp();
    const goal = japan();
    expect(
      (await send("POST", "/api/savings-goals", { ...goal, share: { id: id(), plannedMinor: 0 } }, cookie))
        .status,
    ).toBe(201);
    const now = await currentOf(cookie);
    expect(now.goals[0]?.shareCount).toBe(0);
    expect(now.commitments.filter((k) => k.goalId)).toEqual([]);
  });

  it("refuses a past by date, a target of 0, already saved past the savings total and a share past the target", async () => {
    const { cookie } = await setUp();
    const res = await send(
      "POST",
      "/api/savings-goals",
      { ...japan({ byOn: today(), targetMinor: 0 }), startMinor: 5_000_001 },
      cookie,
    );
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ problems: ["target", "by_on", "start"] });
    const share = await send(
      "POST",
      "/api/savings-goals",
      { ...japan({ targetMinor: 100_000 }), share: { id: id(), plannedMinor: 100_001 } },
      cookie,
    );
    expect(await share.json()).toMatchObject({ problems: ["share"] });
  });
});

describe("changing, stopping and deleting a goal (spec 5)", () => {
  it("changes the target and date and stops it; its currency stays", async () => {
    const { cookie } = await setUp();
    const goal = japan();
    await send("POST", "/api/savings-goals", goal, cookie);
    const res = await send(
      "PATCH",
      `/api/savings-goals/${goal.id}`,
      { targetMinor: 30_000_000, byOn: later(100), stopped: true, currency: "USD" },
      cookie,
    );
    expect(res.status).toBe(200);
    expect((await currentOf(cookie)).goals[0]).toMatchObject({
      targetMinor: 30_000_000,
      byOn: later(100),
      stopped: true,
      currency: "LKR",
    });
  });

  it("deletes a goal and this cycle's share while nothing was moved; not after a move", async () => {
    const { cookie } = await setUp();
    const goal = japan();
    const shareId = id();
    await send(
      "POST",
      "/api/savings-goals",
      { ...goal, share: { id: shareId, plannedMinor: 500_000 } },
      cookie,
    );
    const other = japan();
    const otherShare = id();
    await send(
      "POST",
      "/api/savings-goals",
      { ...other, share: { id: otherShare, plannedMinor: 500_000 } },
      cookie,
    );
    expect((await send("DELETE", `/api/savings-goals/${goal.id}`, undefined, cookie)).status).toBe(200);
    let now = await currentOf(cookie);
    expect(now.goals.map((g) => g.id)).toEqual([other.id]);
    expect(now.commitments.some((k) => k.id === shareId)).toBe(false);

    const moved = await send(
      "POST",
      `/api/commitments/${otherShare}/payments`,
      { id: id(), amountMinor: 200_000, paidOn: today(), currency: "LKR" },
      cookie,
    );
    expect(moved.status).toBe(201);
    now = await currentOf(cookie);
    expect(now.goals[0]).toMatchObject({ movedMinor: 200_000 });
    const res = await send("DELETE", `/api/savings-goals/${other.id}`, undefined, cookie);
    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({ error: "moved" });
  });

  it("a goal share stays Savings and never repeats Every cycle", async () => {
    const { cookie } = await setUp();
    const shareId = id();
    await send(
      "POST",
      "/api/savings-goals",
      { ...japan(), share: { id: shareId, plannedMinor: 500_000 } },
      cookie,
    );
    expect((await send("PATCH", `/api/commitments/${shareId}`, { kind: "bill" }, cookie)).status).toBe(400);
    expect(
      (await send("PATCH", `/api/commitments/${shareId}`, { everyCycle: true, recurringId: id() }, cookie))
        .status,
    ).toBe(400);
    expect(
      (await send("PATCH", `/api/commitments/${shareId}`, { plannedMinor: 400_000 }, cookie)).status,
    ).toBe(200);
  });
});

describe("salary day fills each goal's share (spec 6 step 4)", () => {
  const salaryDay = (commitments: unknown[]) => ({
    cycleId: id(),
    incomeId: id(),
    salaryMinor: 25_000_000,
    receivedOn: today(),
    expectedSalaryOn: later(30),
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

  it("saves a share linked to its goal, never Every cycle; refuses another user's or a stopped goal", async () => {
    const { cookie } = await setUp();
    const goal = japan();
    await send("POST", "/api/savings-goals", goal, cookie);
    const share = (more: Record<string, unknown> = {}) => ({
      id: id(),
      kind: "savings",
      goalId: goal.id,
      name: "Trip to Japan",
      plannedMinor: 8_571_500,
      dueOn: today(),
      ...more,
    });
    const bad = await send(
      "POST",
      "/api/salary-day",
      salaryDay([share({ everyCycle: true }), share({ goalId: id() }), share({ kind: "bill" })]),
      cookie,
    );
    expect(bad.status).toBe(400);
    expect(await bad.json()).toMatchObject({
      problems: expect.arrayContaining(["commitment.0.goal", "commitment.1.goal", "commitment.2.goal"]),
    });

    const good = share();
    const res = await send("POST", "/api/salary-day", salaryDay([good]), cookie);
    expect(res.status).toBe(201);
    const now = await currentOf(cookie);
    expect(now.commitments.find((k) => k.id === good.id)).toMatchObject({ goalId: goal.id, kind: "savings" });
    expect(now.goals[0]?.shareCount).toBe(1);
  });

  it("changing a goal does not take Undo salary day away", async () => {
    const { cookie } = await setUp();
    const goal = japan();
    await send("POST", "/api/savings-goals", goal, cookie);
    const body = salaryDay([]);
    expect((await send("POST", "/api/salary-day", body, cookie)).status).toBe(201);
    await send("PATCH", `/api/savings-goals/${goal.id}`, { name: "Japan" }, cookie);
    const undo = await send("POST", "/api/salary-day/undo", { cycleId: body.cycleId }, cookie);
    expect(undo.status).toBe(200);
  });
});
