import { env } from "cloudflare:workers";
import { describe, expect, it } from "vitest";
import { call } from "./helpers";

// GET /api/current (ticket SAB-41): everything Today needs in one read. A full month in
// two currencies with every kind of row; the snapshot pins the whole answer, field by field.

/** Signs in as a user of its own (no other test touches its rows). */
async function freshUser(name: string) {
  const res = await call("/api/auth/demo/sign-in", {
    method: "POST",
    body: JSON.stringify({ fresh: name }),
  });
  expect(res.status).toBe(200);
  const cookie = res.headers
    .getSetCookie()
    .map((c) => c.split(";")[0])
    .join("; ");
  const { user } = await res.json<{ user: { id: string } }>();
  return { cookie, id: user.id };
}

const T0 = 1_790_000_000_000;

/** Inserts rows for one user; ids get the prefix so users never share one. */
function seeder(userId: string, prefix: string) {
  const rows: D1PreparedStatement[] = [];
  const id = (n: string) => `${prefix}-${n}`;
  const add = (table: string, values: Record<string, string | number | null>) => {
    const all = { user_id: userId, created_at: T0, updated_at: T0 + 500, ...values };
    const cols = Object.keys(all);
    rows.push(
      env.DB.prepare(
        `insert into "${table}" (${cols.join(", ")}) values (${cols.map(() => "?").join(", ")})`,
      ).bind(...Object.values(all)),
    );
  };
  return { id, add, run: () => env.DB.batch(rows) };
}

/** Two currencies, three cycles (the newest two read), every table Today reads. */
async function seedFullMonth(userId: string, p: string) {
  const { id, add, run } = seeder(userId, p);
  const [O, L, C] = [id("cycle-old"), id("cycle-last"), id("cycle-cur")];
  add("settings", {
    id: id("settings"),
    salary_currency: "USD",
    spending_currency: "LKR",
    home_time_zone: "Asia/Colombo",
    usual_pay_day: 25,
    asked_time_zone: "Europe/London",
    remind_due_soon: 0,
    morning_at: "07:30",
    due_soon_days: 5,
    banner_dismissed: 1,
  });
  add("cycle", { id: O, started_on: "2026-09-25", expected_salary_on: "2026-10-25", created_at: T0 - 2000 });
  add("cycle", {
    id: L,
    started_on: "2026-10-25",
    expected_salary_on: "2026-11-25",
    reserve_rate: "290",
    created_at: T0 - 1000,
  });
  add("cycle", {
    id: C,
    started_on: "2026-11-25",
    expected_salary_on: "2026-12-25",
    reserve_rate: "300",
    created_at: T0 + 1000,
    updated_at: T0 + 1000,
  });
  // Counting rates: the newest wins, a tie on set_at goes to the larger id.
  add("counting_rate", { id: id("rate-a"), rate: "295", set_at: T0 });
  add("counting_rate", { id: id("rate-b"), rate: "299", set_at: T0 + 10 });
  add("counting_rate", { id: id("rate-z"), rate: "301.5", set_at: T0 + 10 });

  // Cards, pots, plans, people, a prepayment.
  add("card", { id: id("card-visa"), name: "Visa", currency: "LKR", archived: 0, created_at: T0 - 50 });
  add("card", { id: id("card-amex"), name: "Amex", currency: "USD", archived: 1, created_at: T0 - 40 });
  add("card", { id: id("card-none"), name: "Unused", currency: "LKR", archived: 0, created_at: T0 - 40 });
  add("pot", {
    id: id("pot-b"),
    name: "Groceries",
    currency: "LKR",
    usual_amount_minor: 1_500_000,
    archived: 0,
    created_at: T0 - 30,
  });
  add("pot", {
    id: id("pot-a"),
    name: "Travel",
    currency: "USD",
    usual_amount_minor: 10_000,
    archived: 0,
    created_at: T0 - 30,
  });
  add("pot", {
    id: id("pot-c"),
    name: "Fuel",
    currency: "LKR",
    usual_amount_minor: 800_000,
    archived: 1,
    created_at: T0 - 20,
  });
  add("pot_allocation", { id: id("alloc-1"), pot_id: id("pot-b"), cycle_id: L, amount_minor: 1_400_000 });
  add("pot_allocation", { id: id("alloc-2"), pot_id: id("pot-b"), cycle_id: C, amount_minor: 1_500_000 });
  add("pot_allocation", { id: id("alloc-3"), pot_id: id("pot-c"), cycle_id: L, amount_minor: 800_000 });
  add("pot_allocation", { id: id("alloc-4"), pot_id: id("pot-a"), cycle_id: C, amount_minor: 10_000 });
  add("prepayment", {
    id: id("prep"),
    name: "Gym",
    currency: "LKR",
    total_minor: 6_000_000,
    payback_minor: 500_000,
    normal_monthly_minor: 600_000,
    months: 12,
  });
  add("prepayment", {
    id: id("prep-2"),
    name: "Insurance",
    currency: "LKR",
    total_minor: 1_200_000,
    payback_minor: 100_000,
  });
  add("instalment_plan", {
    id: id("plan-phone"),
    name: "Phone",
    currency: "LKR",
    price_minor: 10_800_000,
    payment_count: 12,
    payment_minor: 1_000_000,
    first_payment_on: "2026-10-28",
    card_id: id("card-visa"),
    normal_monthly_minor: 950_000,
    created_at: T0 - 10,
  });
  add("instalment_plan", {
    id: id("plan-tv"),
    name: "TV",
    currency: "USD",
    price_minor: 60_000,
    payment_count: 6,
    payment_minor: 10_000,
    first_payment_on: "2026-09-30",
    paid_off_on: "2026-11-26",
    created_at: T0 - 5,
  });
  add("person_debt", {
    id: id("debt-lent"),
    cycle_id: L,
    person_name: "Nimal",
    direction: "lent",
    currency: "LKR",
    amount_minor: 500_000,
    made_on: "2026-10-30",
  });
  add("person_debt", {
    id: id("debt-borrowed"),
    cycle_id: C,
    person_name: "Kamal",
    direction: "borrowed",
    currency: "LKR",
    amount_minor: 400_000,
    made_on: "2026-11-26",
  });
  add("person_debt", {
    id: id("debt-settled"),
    cycle_id: L,
    person_name: "Sunil",
    direction: "lent",
    currency: "USD",
    amount_minor: 2_000,
    made_on: "2026-10-30",
    settled_on: "2026-11-20",
    created_at: T0 + 1,
  });

  // Incomes: this cycle's (all kinds), and older ones that count for savings and people.
  const income = (
    n: string,
    cycle: string,
    kind: string,
    currency: string,
    amount: number,
    on: string,
    more = {},
  ) =>
    add("income", {
      id: id(n),
      cycle_id: cycle,
      kind,
      currency,
      amount_minor: amount,
      received_on: on,
      ...more,
    });
  income("inc-o-salary", O, "salary", "USD", 190_000, "2026-09-25");
  income("inc-l-salary", L, "salary", "USD", 195_000, "2026-10-25");
  income("inc-l-extra", L, "extra", "LKR", 1_000_000, "2026-11-02", { to_savings_minor: 100_000 });
  income("inc-l-back", L, "paid_back", "LKR", 100_000, "2026-11-10", {
    person_debt_id: id("debt-lent"),
    to_savings_minor: 20_000,
  });
  income("inc-c-salary", C, "salary", "USD", 200_000, "2026-11-25");
  income("inc-c-leftover", C, "leftover", "LKR", 500_000, "2026-11-25", { to_savings_minor: 200_000 });
  income("inc-c-leftover-usd", C, "leftover", "USD", 3_000, "2026-11-25");
  income("inc-c-extra", C, "extra", "LKR", 1_000_000, "2026-11-27", { to_savings_minor: 300_000 });
  income("inc-c-borrowed", C, "borrowed", "LKR", 400_000, "2026-11-26", {
    person_debt_id: id("debt-borrowed"),
  });
  income("inc-c-back", C, "paid_back", "LKR", 150_000, "2026-11-28", {
    person_debt_id: id("debt-lent"),
    created_at: T0 + 2,
  });
  income("inc-c-loan", C, "loan", "LKR", 2_000_000, "2026-11-26");

  // Spends: last cycle (speeds, card balance) and this one.
  const spend = (n: string, cycle: string, on: string, amount: number, more = {}) =>
    add("spend", {
      id: id(n),
      cycle_id: cycle,
      spent_on: on,
      amount_minor: amount,
      currency: "LKR",
      ...more,
    });
  spend("sp-o-1", O, "2026-09-26", 99_000, { card_id: id("card-visa") });
  spend("sp-l-1", L, "2026-10-25", 120_000, { note: "lunch" });
  spend("sp-l-2", L, "2026-10-26", 300_000, { pot_id: id("pot-b"), card_id: id("card-visa") });
  spend("sp-l-3", L, "2026-11-01", 2_500_000, { one_off: 1, note: "fridge" });
  spend("sp-l-4", L, "2026-11-20", 900_000, { pot_id: id("pot-c") });
  spend("sp-l-5", L, "2026-11-21", 4_000, { pot_id: id("pot-a"), currency: "USD" });
  spend("sp-c-1", C, "2026-11-25", 185_000, { note: "dinner" });
  spend("sp-c-2", C, "2026-11-26", 50_000, { pot_id: id("pot-b"), card_id: id("card-visa"), note: null });
  spend("sp-c-3", C, "2026-11-26", 75_000, { one_off: 1, note: "gift" });
  spend("sp-c-4", C, "2026-11-27", 2_000, { currency: "USD", pot_id: id("pot-a") });
  spend("sp-c-5", C, "2026-11-27", 64_000, { card_id: id("card-amex"), note: "online" });

  // Commitments with payments, every kind.
  const commit = (
    n: string,
    cycle: string,
    name: string,
    kind: string,
    currency: string,
    planned: number,
    due: string,
    more = {},
  ) =>
    add("commitment", {
      id: id(n),
      cycle_id: cycle,
      name,
      kind,
      currency,
      planned_minor: planned,
      due_on: due,
      ...more,
    });
  const pay = (n: string, k: string, currency: string, amount: number, on: string, more = {}) =>
    add("commitment_payment", {
      id: id(n),
      commitment_id: id(k),
      currency,
      amount_minor: amount,
      paid_on: on,
      ...more,
    });
  commit("k-l-rent", L, "Rent", "bill", "LKR", 3_600_000, "2026-11-01", { state: "finished" });
  pay("p-l-rent", "k-l-rent", "LKR", 3_600_000, "2026-11-01");
  commit("k-l-visa", L, "Visa bill", "card_bill", "LKR", 300_000, "2026-11-15", {
    state: "finished",
    card_id: id("card-visa"),
  });
  pay("p-l-visa", "k-l-visa", "LKR", 250_000, "2026-11-15");
  pay("p-l-visa-usd", "k-l-visa", "USD", 100, "2026-11-16", { covers_minor: 30_000 });
  commit("k-l-phone", L, "Phone", "plan_payment", "LKR", 1_000_000, "2026-10-28", {
    state: "finished",
    plan_id: id("plan-phone"),
  });
  pay("p-l-phone", "k-l-phone", "LKR", 1_000_000, "2026-10-28");
  commit("k-l-tv", L, "TV", "plan_payment", "USD", 10_000, "2026-10-30", {
    state: "finished",
    plan_id: id("plan-tv"),
  });
  pay("p-l-tv", "k-l-tv", "LKR", 2_900_000, "2026-10-30", { covers_minor: 10_000 });
  commit("k-l-gym", L, "Gym", "savings_payback", "LKR", 500_000, "2026-11-20", {
    state: "finished",
    prepayment_id: id("prep"),
  });
  pay("p-l-gym", "k-l-gym", "LKR", 500_000, "2026-11-20");
  commit("k-l-save", L, "Holiday", "savings", "LKR", 200_000, "2026-11-20", { state: "finished" });
  pay("p-l-save", "k-l-save", "LKR", 200_000, "2026-11-19");
  commit("k-l-water", L, "Water", "bill", "LKR", 40_000, "2026-11-22", { state: "carried" });

  commit("k-c-rent", C, "Rent", "bill", "LKR", 3_600_000, "2026-12-01", { recurring_id: id("rec-rent") });
  pay("p-c-rent-1", "k-c-rent", "LKR", 1_000_000, "2026-11-26");
  pay("p-c-rent-2", "k-c-rent", "USD", 2_000, "2026-11-26", { covers_minor: 600_000 });
  commit("k-c-water", C, "Water", "bill", "LKR", 40_000, "2026-12-01", { carried_from_id: id("k-l-water") });
  commit("k-c-aircon", C, "Aircon", "bill", "USD", 5_000, "2026-12-01", { state: "dropped" });
  commit("k-c-visa", C, "Visa bill", "card_bill", "LKR", 50_000, "2026-12-15", {
    card_id: id("card-visa"),
    recurring_id: id("rec-visa"),
  });
  pay("p-c-visa", "k-c-visa", "LKR", 50_000, "2026-11-28");
  commit("k-c-phone", C, "Phone", "plan_payment", "LKR", 1_000_000, "2026-11-28", {
    state: "finished",
    plan_id: id("plan-phone"),
  });
  pay("p-c-phone", "k-c-phone", "LKR", 1_000_000, "2026-11-28");
  commit("k-c-gym", C, "Gym", "savings_payback", "LKR", 500_000, "2026-12-20", { prepayment_id: id("prep") });
  pay("p-c-gym", "k-c-gym", "LKR", 200_000, "2026-11-27");
  commit("k-c-save", C, "Holiday", "savings", "LKR", 200_000, "2026-12-20");
  pay("p-c-save", "k-c-save", "LKR", 50_000, "2026-11-26");
  commit("k-c-kamal", C, "Kamal", "person_payback", "LKR", 200_000, "2026-12-10", {
    person_debt_id: id("debt-borrowed"),
  });
  pay("p-c-kamal", "k-c-kamal", "LKR", 100_000, "2026-11-29");
  pay("p-c-kamal-usd", "k-c-kamal", "USD", 100, "2026-11-29", { covers_minor: 30_100 });

  // Day choices, savings movements, plan extras, conversions, Every cycle templates.
  add("day_choice", { id: id("dc-l"), cycle_id: L, day_on: "2026-11-01", choice: "spread" });
  add("day_choice", { id: id("dc-2"), cycle_id: C, day_on: "2026-11-28", choice: "today" });
  add("day_choice", { id: id("dc-1"), cycle_id: C, day_on: "2026-11-27", choice: "spread" });
  const move = (
    n: string,
    cycle: string,
    kind: string,
    currency: string,
    amount: number,
    on: string,
    more = {},
  ) =>
    add("savings_movement", {
      id: id(n),
      cycle_id: cycle,
      kind,
      currency,
      amount_minor: amount,
      moved_on: on,
      ...more,
    });
  move("sm-o-open", O, "opening", "LKR", 5_000_000, "2026-09-25");
  move("sm-l-prep", L, "prepayment", "LKR", -6_000_000, "2026-10-28", { prepayment_id: id("prep") });
  move("sm-c-prep", C, "prepayment", "LKR", -1_200_000, "2026-11-26", { prepayment_id: id("prep-2") });
  move("sm-c-in", C, "put_in", "LKR", 300_000, "2026-11-26");
  move("sm-c-out", C, "take_out", "USD", -1_000, "2026-11-26");
  move("x-c-savings", C, "plan_extra", "LKR", -400_000, "2026-11-29");
  const extra = (
    n: string,
    plan: string,
    currency: string,
    amount: number,
    from: string,
    off: number,
    on: string,
    created: number,
  ) =>
    add("plan_extra_payment", {
      id: id(n),
      cycle_id: C,
      plan_id: id(plan),
      currency,
      amount_minor: amount,
      paid_from: from,
      pays_off: off,
      paid_on: on,
      created_at: created,
    });
  extra("x-c-free", "plan-phone", "LKR", 100_000, "free", 0, "2026-11-27", T0 + 1);
  extra("x-c-savings", "plan-phone", "LKR", 400_000, "savings", 0, "2026-11-29", T0);
  extra("x-c-tv", "plan-tv", "USD", 40_000, "free", 1, "2026-11-26", T0);
  const conv = (
    n: string,
    cycle: string,
    given: number,
    received: number,
    rate: string,
    covered: number,
    gain: number,
    on: string,
    created: number,
  ) =>
    add("conversion", {
      id: id(n),
      cycle_id: cycle,
      given_minor: given,
      received_minor: received,
      rate,
      covered_minor: covered,
      gain_minor: gain,
      done_on: on,
      created_at: created,
    });
  conv("cv-l", L, 10_000, 2_950_000, "295", 0, 50_000, "2026-11-05", T0);
  conv("cv-c-1", C, 20_000, 6_040_000, "302", 1_000_000, 40_000, "2026-11-26", T0 + 1);
  conv("cv-c-2", C, 5_000, 1_490_000, "298", 0, -10_000, "2026-11-26", T0 + 2);
  conv("cv-c-3", C, 1_000, 300_000, "300", 0, 0, "2026-11-27", T0);
  const rec = (
    n: string,
    name: string,
    kind: string,
    currency: string,
    amount: number,
    day: number,
    active: number,
    more = {},
  ) =>
    add("recurring_commitment", {
      id: id(n),
      name,
      kind,
      currency,
      usual_amount_minor: amount,
      usual_day: day,
      active,
      ...more,
    });
  rec("rec-rent", "Rent", "bill", "LKR", 3_600_000, 1, 1);
  rec("rec-netflix", "Netflix", "bill", "USD", 1_500, 1, 0);
  rec("rec-visa", "Visa bill", "card_bill", "LKR", 50_000, 15, 1, { card_id: id("card-visa") });
  rec("rec-save", "Holiday", "savings", "LKR", 200_000, 20, 1);

  // Savings goals (SAB-68): one with a share last cycle (part moved in dollars) and one this cycle; one stopped.
  add("savings_goal", {
    id: id("goal-japan"),
    name: "Trip to Japan",
    currency: "LKR",
    target_minor: 60_000_000,
    by_on: "2027-06-01",
    start_minor: 1_000_000,
  });
  add("savings_goal", {
    id: id("goal-car"),
    name: "Car",
    currency: "USD",
    target_minor: 500_000,
    by_on: "2028-01-01",
    stopped: 1,
    created_at: T0 + 1,
  });
  commit("k-l-japan", L, "Trip to Japan", "savings", "LKR", 8_000_000, "2026-10-25", {
    goal_id: id("goal-japan"),
    state: "finished",
  });
  pay("p-l-japan", "k-l-japan", "LKR", 7_000_000, "2026-10-26");
  pay("p-l-japan-usd", "k-l-japan", "USD", 3_000, "2026-10-27", { covers_minor: 900_000 });
  commit("k-c-japan", C, "Trip to Japan", "savings", "LKR", 8_200_000, "2026-11-25", {
    goal_id: id("goal-japan"),
  });

  // Places in list order (not the order made), each with its newest balance; one has none yet.
  const placeRow = (n: string, name: string, currency: string, kind: string, sort: number, archived = 0) =>
    add("place", { id: id(n), name, currency, kind, sort_order: sort, archived });
  placeRow("place-bank", "Pan Asia", "LKR", "kept", 1);
  placeRow("place-hand", "In hand", "LKR", "spending", 0);
  placeRow("place-usd", "Dollar account", "USD", "kept", 2);
  placeRow("place-old", "Old bank", "LKR", "spending", 3, 1);
  const balance = (n: string, placeN: string, amount: number, at: number) =>
    add("place_check", { id: id(n), place_id: id(placeN), amount_minor: amount, checked_at: at });
  balance("check-hand-1", "place-hand", 900_000, T0 + 100);
  balance("check-hand-2", "place-hand", 1_200_000, T0 + 300);
  balance("check-hand-0", "place-hand", 100_000, T0 + 200);
  balance("check-usd-a", "place-usd", 42_033, T0 + 100);
  // A tie on the time goes to the larger id.
  balance("check-usd-b", "place-usd", 41_000, T0 + 100);
  balance("check-old", "place-old", 5_000, T0);
  // Salary day L → C kept its undo record (the spending currency's row); the USD row has none.
  const undo = { templates: [], potsMade: [], reopened: [], payments: [] };
  add("cycle_close", {
    id: id("close-lkr"),
    cycle_id: L,
    next_cycle_id: C,
    currency: "LKR",
    leftover_minor: 500_000,
    undo: JSON.stringify(undo),
  });
  add("cycle_close", {
    id: id("close-usd"),
    cycle_id: L,
    next_cycle_id: C,
    currency: "USD",
    leftover_minor: 3_000,
  });
  await run();
}

const current = async (cookie: string) => {
  const res = await call("/api/current", {}, cookie);
  expect(res.status).toBe(200);
  return res.json<Record<string, unknown>>();
};

describe("GET /api/current", () => {
  it("returns a full month in two currencies, every field", async () => {
    const u = await freshUser("current-full");
    await seedFullMonth(u.id, "full");
    const data = await current(u.cookie);
    expect(data.undoSalaryDay).toBe(true);
    expect(data).toMatchSnapshot();
  });

  it("offers Undo salary day until something is entered after it (the salary amount excepted)", async () => {
    const u = await freshUser("current-undo");
    await seedFullMonth(u.id, "undo");
    const touch = (table: string, rowId: string) =>
      env.DB.prepare(`update "${table}" set updated_at = ? where id = ?`)
        .bind(T0 + 5000, rowId)
        .run();
    await touch("income", "undo-inc-c-salary");
    expect((await current(u.cookie)).undoSalaryDay).toBe(true);
    await touch("income", "undo-inc-c-extra");
    expect((await current(u.cookie)).undoSalaryDay).toBe(false);
    for (const [table, rowId] of [
      ["spend", "undo-sp-c-1"],
      ["commitment_payment", "undo-p-c-rent-1"],
      ["pot", "undo-pot-b"],
      ["recurring_commitment", "undo-rec-rent"],
      ["person_debt", "undo-debt-lent"],
    ] as const) {
      const fresh = await freshUser(`current-undo-${table.replaceAll("_", "-")}`);
      await seedFullMonth(fresh.id, `u-${table}`);
      expect((await current(fresh.cookie)).undoSalaryDay).toBe(true);
      await touch(table, rowId.replace("undo-", `u-${table}-`));
      expect((await current(fresh.cookie)).undoSalaryDay).toBe(false);
    }
  });

  it("returns one cycle with no last cycle, and nothing before first use", async () => {
    const u = await freshUser("current-one");
    expect(await current(u.cookie)).toMatchSnapshot("before first use");
    const { id, add, run } = seeder(u.id, "one");
    add("settings", {
      id: id("settings"),
      salary_currency: "LKR",
      spending_currency: "LKR",
      home_time_zone: "Asia/Colombo",
      usual_pay_day: 1,
    });
    add("cycle", { id: id("cycle"), started_on: "2026-11-01", expected_salary_on: "2026-12-01" });
    add("counting_rate", { id: id("rate"), rate: "300", set_at: T0 });
    add("income", {
      id: id("inc"),
      cycle_id: id("cycle"),
      kind: "opening",
      currency: "LKR",
      amount_minor: 9_000_000,
      received_on: "2026-11-01",
    });
    add("pot", { id: id("pot"), name: "Food", currency: "LKR", usual_amount_minor: 100_000, archived: 0 });
    await run();
    expect(await current(u.cookie)).toMatchSnapshot("one cycle");
  });

  it("is refused without a session", async () => {
    const res = await call("/api/current");
    expect(res.status).toBe(401);
  });
});
