import { env } from "cloudflare:workers";
import { beforeAll, describe, expect, it } from "vitest";
import { app, PUBLIC_ROUTES } from "../../src/worker";
import { userCheck } from "../../src/worker/user-check";
import { call, ownedTables, seedEveryTable, signIn } from "./helpers";

/**
 * The one shared "second user is refused" test (spec 13, 16).
 *
 * It lists every route of the app. Each private route must have a probe below
 * (the test fails otherwise, so a new route cannot be missed). Each probe is
 * called twice:
 *   1. signed out: must answer 401;
 *   2. signed in as a second user, aimed at the first user's records: must not
 *      show any of the first user's ids or email, and must not change any of
 *      the first user's rows.
 */

interface Owner {
  id: string;
  email: string;
  /** Every row the first user owns, by table (filled from every table with a `user_id` column). */
  rows: Record<string, { id: string }[]>;
}

type Probe = (owner: Owner) => { path: string; init?: RequestInit };

/** The first user's device with alerts on (item 26). */
const OWNER_ENDPOINT = "https://fcm.googleapis.com/fcm/send/owner-device";

const firstRow = (o: Owner, table: string) => o.rows[table]?.[0]?.id ?? "missing";

const probes: Record<string, Probe> = {
  "GET /api/me": () => ({ path: "/api/me" }),
  "GET /api/current": () => ({ path: "/api/current" }),
  // Aimed at the first user's ids: must not take over or touch their rows.
  "POST /api/first-use": (o) => ({
    path: "/api/first-use",
    init: {
      body: JSON.stringify({
        settingsId: firstRow(o, "settings"),
        cycleId: firstRow(o, "cycle"),
        incomeId: firstRow(o, "income"),
        salaryCurrency: "LKR",
        spendingCurrency: "LKR",
        homeTimeZone: "Asia/Colombo",
        usualPayDay: 25,
        heldMinor: 1,
        expectedSalaryOn: "2999-01-01",
        commitments: [
          {
            id: firstRow(o, "commitment"),
            name: "Rent",
            plannedMinor: 1,
            dueOn: "2998-01-01",
            recurringId: firstRow(o, "recurring_commitment"),
          },
        ],
        pots: [
          {
            id: firstRow(o, "pot"),
            allocationId: firstRow(o, "pot_allocation"),
            name: "Fuel",
            amountMinor: 1,
          },
        ],
      }),
    },
  }),
  // Aimed at the first user's spend: must not take over, change or delete it.
  "POST /api/spends": (o) => ({
    path: "/api/spends",
    init: { body: JSON.stringify({ id: firstRow(o, "spend"), spentOn: "2026-11-12", amountMinor: 1 }) },
  }),
  "PATCH /api/spends/:id": (o) => ({
    path: `/api/spends/${firstRow(o, "spend")}`,
    init: { body: JSON.stringify({ amountMinor: 1, cardId: firstRow(o, "card") }) },
  }),
  "DELETE /api/spends/:id": (o) => ({ path: `/api/spends/${firstRow(o, "spend")}` }),
  // Aimed at the first user's commitment: must not take over, change or delete it.
  "POST /api/commitments": (o) => ({
    path: "/api/commitments",
    init: {
      body: JSON.stringify({
        id: firstRow(o, "commitment"),
        name: "x",
        plannedMinor: 1,
        dueOn: "2026-11-20",
      }),
    },
  }),
  "PATCH /api/commitments/:id": (o) => ({
    path: `/api/commitments/${firstRow(o, "commitment")}`,
    init: { body: JSON.stringify({ plannedMinor: 1, state: "finished" }) },
  }),
  "DELETE /api/commitments/:id": (o) => ({ path: `/api/commitments/${firstRow(o, "commitment")}` }),
  // Aimed at the first user's commitment and payment: must not pay, finish, change or delete.
  "POST /api/commitments/:id/payments": (o) => ({
    path: `/api/commitments/${firstRow(o, "commitment")}/payments`,
    init: {
      body: JSON.stringify({
        id: firstRow(o, "commitment_payment"),
        amountMinor: 1,
        paidOn: "2026-11-12",
        finish: true,
      }),
    },
  }),
  "PATCH /api/payments/:id": (o) => ({
    path: `/api/payments/${firstRow(o, "commitment_payment")}`,
    init: { body: JSON.stringify({ amountMinor: 1 }) },
  }),
  "DELETE /api/payments/:id": (o) => ({ path: `/api/payments/${firstRow(o, "commitment_payment")}` }),
  // Aimed at the first user's pot and its allocation: must not take over, change, stop or delete.
  "POST /api/pots": (o) => ({
    path: "/api/pots",
    init: {
      body: JSON.stringify({
        id: firstRow(o, "pot"),
        allocationId: firstRow(o, "pot_allocation"),
        name: "x",
        usualAmountMinor: 1,
        amountMinor: 1,
      }),
    },
  }),
  "PATCH /api/pots/:id": (o) => ({
    path: `/api/pots/${firstRow(o, "pot")}`,
    init: {
      body: JSON.stringify({
        name: "x",
        amountMinor: 1,
        allocationId: firstRow(o, "pot_allocation"),
        archived: true,
      }),
    },
  }),
  "DELETE /api/pots/:id": (o) => ({ path: `/api/pots/${firstRow(o, "pot")}` }),
  // Aimed at the first user's answer: must not take it over or answer for them.
  "POST /api/day-choices": (o) => ({
    path: "/api/day-choices",
    init: { body: JSON.stringify({ id: firstRow(o, "day_choice"), dayOn: "2026-11-13", choice: "today" }) },
  }),
  // Aimed at the first user's savings movement and income: must not take over or delete them.
  "POST /api/savings-movements": (o) => ({
    path: "/api/savings-movements",
    init: { body: JSON.stringify({ id: firstRow(o, "savings_movement"), kind: "put_in", amountMinor: 1 }) },
  }),
  "DELETE /api/savings-movements/:id": (o) => ({
    path: `/api/savings-movements/${firstRow(o, "savings_movement")}`,
  }),
  "POST /api/incomes": (o) => ({
    path: "/api/incomes",
    init: {
      body: JSON.stringify({ id: firstRow(o, "income"), kind: "extra", amountMinor: 2, toSavingsMinor: 1 }),
    },
  }),
  "DELETE /api/incomes/:id": (o) => ({ path: `/api/incomes/${firstRow(o, "income")}` }),
  // Aimed at the first user's conversion id: must not take it over or delete it (or its counting rate).
  "POST /api/conversions": (o) => ({
    path: "/api/conversions",
    init: {
      body: JSON.stringify({
        id: firstRow(o, "conversion"),
        givenMinor: 100,
        receivedMinor: 30_000,
        doneOn: "2026-11-12",
      }),
    },
  }),
  "DELETE /api/conversions/:id": (o) => ({ path: `/api/conversions/${firstRow(o, "conversion")}` }),
  // Aimed at the first user's card: must not take it over, rename, stop or delete it.
  "POST /api/cards": (o) => ({
    path: "/api/cards",
    init: { body: JSON.stringify({ id: firstRow(o, "card"), name: "x" }) },
  }),
  "PATCH /api/cards/:id": (o) => ({
    path: `/api/cards/${firstRow(o, "card")}`,
    init: { body: JSON.stringify({ name: "x", archived: true }) },
  }),
  "DELETE /api/cards/:id": (o) => ({ path: `/api/cards/${firstRow(o, "card")}` }),
  // Aimed at the first user's place and its balance: must not take over, change, reorder, set or delete.
  "POST /api/places": (o) => ({
    path: "/api/places",
    init: {
      body: JSON.stringify({
        id: firstRow(o, "place"),
        name: "x",
        balance: { id: firstRow(o, "place_check"), amountMinor: 1 },
      }),
    },
  }),
  "PUT /api/places/order": (o) => ({
    path: "/api/places/order",
    init: { body: JSON.stringify({ ids: [firstRow(o, "place")] }) },
  }),
  "PATCH /api/places/:id": (o) => ({
    path: `/api/places/${firstRow(o, "place")}`,
    init: { body: JSON.stringify({ name: "x", kind: "kept", archived: true }) },
  }),
  "DELETE /api/places/:id": (o) => ({ path: `/api/places/${firstRow(o, "place")}?balances=delete` }),
  "POST /api/places/:id/checks": (o) => ({
    path: `/api/places/${firstRow(o, "place")}/checks`,
    init: { body: JSON.stringify({ id: firstRow(o, "place_check"), amountMinor: 1 }) },
  }),
  "DELETE /api/places/:id/checks/:checkId": (o) => ({
    path: `/api/places/${firstRow(o, "place")}/checks/${firstRow(o, "place_check")}`,
  }),
  // Aimed at the first user's prepayment, savings movement and commitment: must not take any over or delete them.
  "POST /api/prepayments": (o) => ({
    path: "/api/prepayments",
    init: {
      body: JSON.stringify({
        id: firstRow(o, "prepayment"),
        movementId: firstRow(o, "savings_movement"),
        commitmentId: firstRow(o, "commitment"),
        name: "x",
        totalMinor: 1,
        paybackMinor: 1,
      }),
    },
  }),
  "DELETE /api/prepayments/:id": (o) => ({ path: `/api/prepayments/${firstRow(o, "prepayment")}` }),
  // Aimed at the first user's plan, commitment and extra payment: must not take any over, pay or delete them.
  "POST /api/plans": (o) => ({
    path: "/api/plans",
    init: {
      body: JSON.stringify({
        id: firstRow(o, "instalment_plan"),
        commitmentId: firstRow(o, "commitment"),
        name: "x",
        priceMinor: 1,
        paymentCount: 1,
        paymentMinor: 1,
        firstPaymentOn: "2999-01-01",
        cardId: firstRow(o, "card"),
      }),
    },
  }),
  "DELETE /api/plans/:id": (o) => ({ path: `/api/plans/${firstRow(o, "instalment_plan")}` }),
  "POST /api/plans/:id/extra": (o) => ({
    path: `/api/plans/${firstRow(o, "instalment_plan")}/extra`,
    init: {
      body: JSON.stringify({
        id: firstRow(o, "plan_extra_payment"),
        amountMinor: 1,
        from: "free",
        paysOff: true,
      }),
    },
  }),
  "DELETE /api/plans/extra/:id": (o) => ({ path: `/api/plans/extra/${firstRow(o, "plan_extra_payment")}` }),
  // Aimed at the first user's person entry, income and commitment: must not take any over, settle or delete them.
  "POST /api/people": (o) => ({
    path: "/api/people",
    init: {
      body: JSON.stringify({
        id: firstRow(o, "person_debt"),
        direction: "borrowed",
        personName: "x",
        amountMinor: 1,
        incomeId: firstRow(o, "income"),
        payback: { id: firstRow(o, "commitment"), plannedMinor: 1, dueOn: "2999-01-01" },
      }),
    },
  }),
  "DELETE /api/people/:id": (o) => ({ path: `/api/people/${firstRow(o, "person_debt")}` }),
  "PATCH /api/people/:id": (o) => ({
    path: `/api/people/${firstRow(o, "person_debt")}`,
    init: { body: JSON.stringify({ settled: true }) },
  }),
  "POST /api/people/:id/back": (o) => ({
    path: `/api/people/${firstRow(o, "person_debt")}/back`,
    init: { body: JSON.stringify({ id: firstRow(o, "income"), amountMinor: 1, toSavingsMinor: 0 }) },
  }),
  "POST /api/people/:id/payback": (o) => ({
    path: `/api/people/${firstRow(o, "person_debt")}/payback`,
    init: { body: JSON.stringify({ id: firstRow(o, "commitment"), plannedMinor: 1, dueOn: "2999-01-01" }) },
  }),
  // Aimed at the first user's cycle, income, commitment, template and pot: must not take any over.
  // Past (item 21): must not list or open the first user's cycles.
  "GET /api/past": () => ({ path: "/api/past" }),
  "GET /api/past/:id": (o) => ({ path: `/api/past/${firstRow(o, "cycle")}` }),
  // Phone alerts (item 26): aimed at the first user's device, which must stay theirs.
  "GET /api/push/key": () => ({ path: "/api/push/key" }),
  "POST /api/push-subscriptions": () => ({
    path: "/api/push-subscriptions",
    init: {
      body: JSON.stringify({ endpoint: OWNER_ENDPOINT, p256dh: "B".repeat(87), auth: "A".repeat(22) }),
    },
  }),
  "POST /api/push-subscriptions/remove": () => ({
    path: "/api/push-subscriptions/remove",
    init: { body: JSON.stringify({ endpoint: OWNER_ENDPOINT }) },
  }),
  "POST /api/push-subscriptions/remove-all": () => ({ path: "/api/push-subscriptions/remove-all" }),
  // Download my data (item 27): only the second user's own records.
  "GET /api/export": () => ({ path: "/api/export" }),
  "GET /api/export/spends.csv": () => ({ path: "/api/export/spends.csv" }),
  "POST /api/salary-day": (o) => ({
    path: "/api/salary-day",
    init: {
      body: JSON.stringify({
        cycleId: firstRow(o, "cycle"),
        incomeId: firstRow(o, "income"),
        salaryMinor: 1,
        receivedOn: "2026-11-12",
        expectedSalaryOn: "2999-01-01",
        commitments: [
          {
            id: firstRow(o, "commitment"),
            name: "x",
            plannedMinor: 1,
            dueOn: "2026-11-20",
            recurringId: firstRow(o, "recurring_commitment"),
            everyCycle: true,
            carriedFromId: firstRow(o, "commitment"),
          },
        ],
        pots: [
          {
            id: firstRow(o, "pot"),
            allocationId: firstRow(o, "pot_allocation"),
            amountMinor: 1,
            name: "x",
            usualAmountMinor: 1,
          },
        ],
        // And at the first user's close, income, commitments and payment: must not pay, carry or drop any.
        close: {
          closeId: firstRow(o, "cycle_close"),
          leftoverIncomeId: firstRow(o, "income"),
          unpaid: [
            { id: firstRow(o, "commitment"), choice: "carry", newId: firstRow(o, "commitment") },
            { id: firstRow(o, "commitment"), choice: "paid", newId: firstRow(o, "commitment_payment") },
          ],
          inHandMinor: null,
          toSavingsMinor: 0,
          overspend: null,
        },
      }),
    },
  }),
  // Aimed at the first user's template: must not pause it.
  "PATCH /api/recurring-commitments/:id": (o) => ({
    path: `/api/recurring-commitments/${firstRow(o, "recurring_commitment")}`,
    init: { body: JSON.stringify({ active: false }) },
  }),
  // Aimed at the first user's cycle: must not undo their salary day.
  "POST /api/salary-day/undo": (o) => ({
    path: "/api/salary-day/undo",
    init: { body: JSON.stringify({ cycleId: firstRow(o, "cycle") }) },
  }),
  // Only ever the signed-in user's own current cycle.
  "PATCH /api/salary": () => ({
    path: "/api/salary",
    init: { body: JSON.stringify({ salaryMinor: 1 }) },
  }),
  "PATCH /api/cycle": () => ({
    path: "/api/cycle",
    init: { body: JSON.stringify({ expectedSalaryOn: "2999-01-01" }) },
  }),
  // Only ever a rate of the signed-in user's own.
  "POST /api/counting-rates": () => ({
    path: "/api/counting-rates",
    init: { body: JSON.stringify({ id: crypto.randomUUID(), rate: "1" }) },
  }),
  "PATCH /api/settings": () => ({
    path: "/api/settings",
    init: { body: JSON.stringify({ usualPayDay: 2 }) },
  }),
  // Must stay last: it really deletes the second user's own account (aimed at the
  // first user's id, which the route ignores), and the first user's rows must stay.
  "POST /api/account/delete": (o) => ({
    path: "/api/account/delete",
    init: { body: JSON.stringify({ confirm: "DELETE", userId: o.id }) },
  }),
};

async function snapshot(ownerId: string): Promise<Record<string, unknown[]>> {
  const snap: Record<string, unknown[]> = {};
  for (const t of await ownedTables()) {
    // Session rows are left out: signing in and out legitimately changes them.
    if (t === "session") continue;
    snap[t] = (
      await env.DB.prepare(`select * from "${t}" where user_id = ? order by id`).bind(ownerId).all()
    ).results;
  }
  return snap;
}

function isPublic(path: string) {
  return PUBLIC_ROUTES.some((p) => (p.endsWith("*") ? path.startsWith(p.slice(0, -1)) : path === p));
}

/** Every handler route of the app ("METHOD /path"), without middleware. */
function appRoutes(): string[] {
  const keys = app.routes.filter((r) => r.handler !== userCheck).map((r) => `${r.method} ${r.path}`);
  return [...new Set(keys)];
}

describe("second user is refused", () => {
  const routes = appRoutes().filter((r) => !isPublic(r.split(" ")[1] ?? ""));
  let owner: Owner;
  let second: { cookie: string; id: string };

  beforeAll(async () => {
    const first = await signIn("demo");
    await seedEveryTable(first.id, OWNER_ENDPOINT);
    const rows: Owner["rows"] = {};
    for (const t of await ownedTables()) {
      rows[t] = (
        await env.DB.prepare(`select id from "${t}" where user_id = ?`).bind(first.id).all<{ id: string }>()
      ).results;
    }
    owner = { id: first.id, email: first.email, rows };
    second = await signIn("second");
  });

  it("finds the private routes", () => {
    expect(routes.length).toBeGreaterThan(0);
  });

  it("every private route has a probe", () => {
    expect(routes.filter((r) => !probes[r])).toEqual([]);
  });

  it.each(Object.keys(probes))("%s needs a signed-in user", async (key) => {
    const { path, init } = probes[key]!(owner);
    const res = await call(path, { method: key.split(" ")[0], ...init });
    expect(res.status).toBe(401);
  });

  it.each(Object.keys(probes))("%s shows and changes nothing of the first user", async (key) => {
    const before = await snapshot(owner.id);
    const { path, init } = probes[key]!(owner);
    const res = await call(path, { method: key.split(" ")[0], ...init }, second.cookie);
    const body = await res.text();
    const secrets = [owner.id, owner.email, ...Object.values(owner.rows).flatMap((r) => r.map((x) => x.id))];
    for (const s of secrets) expect(body).not.toContain(s);
    expect(await snapshot(owner.id)).toEqual(before);
  });
});
