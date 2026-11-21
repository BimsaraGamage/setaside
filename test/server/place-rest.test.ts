import { env } from "cloudflare:workers";
import { describe, expect, it } from "vitest";
import { addDays, suggestSalaryDay, todayIn } from "../../src/money";
import { call, signIn } from "./helpers";

// Place balances follow the rest (ticket SAB-52, spec 6 "Where my money is"): incomes, savings Put in and
// prepayments, money lent and borrowed, plan extras, Change dollars and salary day each move the place
// they name. Today's read gives each place what moved since its balance was typed.

const TZ = "Asia/Colombo";
const today = () => todayIn(TZ, Date.now());
const id = () => crypto.randomUUID();
/** A later instant than everything saved so far (rows are compared by the millisecond they were saved). */
const later = () => new Promise((r) => setTimeout(r, 5));

interface Place {
  id: string;
  name: string;
  balanceMinor: number | null;
  movedMinor: number;
}

const send = (method: string, path: string, body: unknown, cookie: string) =>
  call(path, { method, body: body === undefined ? undefined : JSON.stringify(body) }, cookie);

const problemsOf = async (res: Response) => (await res.json<{ problems?: string[] }>()).problems;

/** A fresh user with first use done 20 days ago: Rs 90,000 held (or with $1,000 and Rs 300 a dollar). */
async function setUp(two = false, who: "second" | "demo" = "second") {
  const u = await signIn(who);
  for (const t of ["place", "recurring_commitment", "pot", "cycle", "card", "counting_rate", "settings"]) {
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
      salaryCurrency: two ? "USD" : "LKR",
      spendingCurrency: "LKR",
      homeTimeZone: TZ,
      usualPayDay: 25,
      heldMinor: 9_000_000,
      ...(two
        ? { salaryIncomeId: id(), countingRateId: id(), heldSalaryMinor: 100_000, countingRate: "300" }
        : {}),
      expectedSalaryOn: suggestSalaryDay(today(), 25),
      commitments: [],
      pots: [],
    },
    u.cookie,
  );
  expect(res.status).toBe(201);
  await env.DB.prepare("update cycle set started_on = ? where id = ?")
    .bind(addDays(today(), -20), cycleId)
    .run();
  const post = (path: string, body: unknown) => send("POST", path, body, u.cookie);
  const del = (path: string) => send("DELETE", path, undefined, u.cookie);
  /** A place with this balance typed (none: no balance yet). */
  const addPlace = async (name: string, balanceMinor: number | null, more: Record<string, unknown> = {}) => {
    const placeId = id();
    const balance = balanceMinor === null ? {} : { balance: { id: id(), amountMinor: balanceMinor } };
    expect((await post("/api/places", { id: placeId, name, ...balance, ...more })).status).toBe(201);
    await later();
    return placeId;
  };
  const places = async () =>
    (await (await call("/api/current", {}, u.cookie)).json<{ places: Place[] }>()).places;
  /** What each place holds now, by name: the balance typed plus what moved since. */
  const balances = async () =>
    Object.fromEntries(
      (await places()).map((p) => [p.name, p.balanceMinor === null ? null : p.balanceMinor + p.movedMinor]),
    );
  const income = (more: Record<string, unknown>) =>
    post("/api/incomes", { id: id(), kind: "extra", amountMinor: 500_000, toSavingsMinor: 0, ...more });
  return { ...u, cycleId, post, del, addPlace, places, balances, income };
}

/** Steps 2 and 3 with the leftover kept as worked out. */
const close = (unpaid: unknown[] = []) => ({
  closeId: id(),
  leftoverIncomeId: id(),
  unpaid,
  inHandMinor: null,
  toSavingsMinor: 0,
  overspend: null,
});

/** A salary day today with nothing in it but the salary. */
const salaryDay = (more: Record<string, unknown> = {}) => ({
  cycleId: id(),
  incomeId: id(),
  salaryMinor: 25_000_000,
  receivedOn: today(),
  expectedSalaryOn: addDays(today(), 30),
  commitments: [],
  pots: [],
  close: close(),
  ...more,
});

describe("income lands in a place (ticket SAB-52)", () => {
  it("the whole amount goes in, the part sent to savings too; deleted, it is out again", async () => {
    const { post, del, addPlace, balances } = await setUp();
    const bank = await addPlace("Bank", 4_800_000);
    await addPlace("In hand", 1_200_000);
    const incomeId = id();
    const body = {
      id: incomeId,
      kind: "extra",
      amountMinor: 500_000,
      toSavingsMinor: 200_000,
      placeId: bank,
    };
    expect((await post("/api/incomes", body)).status).toBe(201);
    expect(await balances()).toEqual({ Bank: 5_300_000, "In hand": 1_200_000 });
    expect((await del(`/api/incomes/${incomeId}`)).status).toBe(200);
    expect(await balances()).toEqual({ Bank: 4_800_000, "In hand": 1_200_000 });
  });

  it("no place moves none; loan money lands like extra income", async () => {
    const { income, addPlace, balances } = await setUp();
    const bank = await addPlace("Bank", 4_800_000);
    expect((await income({})).status).toBe(201);
    expect((await income({ placeId: null })).status).toBe(201);
    expect(await balances()).toEqual({ Bank: 4_800_000 });
    expect((await income({ kind: "loan", placeId: bank })).status).toBe(201);
    expect(await balances()).toEqual({ Bank: 5_300_000 });
  });

  it("refuses a place of another currency, a stopped place, an unknown one and another user's", async () => {
    const other = await setUp(false, "demo");
    const theirs = await other.addPlace("Theirs", 100_000);
    const { cookie, income, addPlace, balances } = await setUp(true);
    const dollars = await addPlace("Dollar account", 50_000, { currency: "USD" });
    const old = await addPlace("Old", 100_000);
    expect((await send("PATCH", `/api/places/${old}`, { archived: true }, cookie)).status).toBe(200);
    for (const placeId of [dollars, old, id(), theirs]) {
      const res = await income({ placeId });
      expect(res.status).toBe(400);
      expect(await problemsOf(res)).toEqual(["place"]);
    }
    // Dollars into the dollar place are fine.
    expect((await income({ currency: "USD", amountMinor: 10_000, placeId: dollars })).status).toBe(201);
    expect(await balances()).toEqual({ "Dollar account": 60_000, Old: 100_000 });
    expect(await other.balances()).toEqual({ Theirs: 100_000 });
  });

  it("an income saved before the balance was typed is already in it", async () => {
    const { cookie, income, addPlace, balances } = await setUp();
    const bank = await addPlace("Bank", 4_800_000);
    expect((await income({ placeId: bank })).status).toBe(201);
    await later();
    const check = { id: id(), amountMinor: 6_000_000 };
    expect((await send("POST", `/api/places/${bank}/checks`, check, cookie)).status).toBe(201);
    expect(await balances()).toEqual({ Bank: 6_000_000 });
  });
});

describe("savings and places (ticket SAB-52)", () => {
  it("Put in goes into its place; taken out into free money, the money stays where it is", async () => {
    const { post, del, addPlace, balances } = await setUp();
    const bank = await addPlace("Bank", 4_800_000);
    const putIn = id();
    const move = { id: putIn, kind: "put_in", amountMinor: 1_000_000, placeId: bank };
    expect((await post("/api/savings-movements", move)).status).toBe(201);
    expect(await balances()).toEqual({ Bank: 5_800_000 });
    // A take-out names no place, whatever is sent.
    const takeOut = { id: id(), kind: "take_out", amountMinor: 400_000, placeId: bank };
    expect((await post("/api/savings-movements", takeOut)).status).toBe(201);
    expect(await balances()).toEqual({ Bank: 5_800_000 });
    const kept = await env.DB.prepare("select place_id as placeId from savings_movement where id = ?")
      .bind(takeOut.id)
      .first<{ placeId: string | null }>();
    expect(kept?.placeId).toBeNull();
    expect((await del(`/api/savings-movements/${putIn}`)).status).toBe(200);
    expect(await balances()).toEqual({ Bank: 4_800_000 });
  });

  it("a prepayment is paid out of its place; undone, the money is back", async () => {
    const { post, del, addPlace, balances } = await setUp();
    const bank = await addPlace("Bank", 4_800_000);
    const put = { id: id(), kind: "put_in", amountMinor: 1_000_000 };
    expect((await post("/api/savings-movements", put)).status).toBe(201);
    const gym = {
      id: id(),
      movementId: id(),
      commitmentId: id(),
      name: "Gym",
      totalMinor: 600_000,
      paybackMinor: 50_000,
      placeId: bank,
    };
    expect((await post("/api/prepayments", gym)).status).toBe(201);
    expect(await balances()).toEqual({ Bank: 4_200_000 });
    expect((await del(`/api/prepayments/${gym.id}`)).status).toBe(200);
    expect(await balances()).toEqual({ Bank: 4_800_000 });
    const bad = await post("/api/prepayments", { ...gym, id: id(), movementId: id(), placeId: id() });
    expect(await problemsOf(bad)).toEqual(["place"]);
  });
});

describe("people and places (ticket SAB-52)", () => {
  it("money lent comes out of its place; got back, it lands in one; each Undo puts it back", async () => {
    const { post, del, addPlace, balances } = await setUp();
    const hand = await addPlace("In hand", 1_200_000);
    const bank = await addPlace("Bank", 4_800_000);
    const debt = id();
    const lent = { id: debt, direction: "lent", personName: "Nimal", amountMinor: 300_000, placeId: hand };
    expect((await post("/api/people", lent)).status).toBe(201);
    expect(await balances()).toEqual({ "In hand": 900_000, Bank: 4_800_000 });
    const back = { id: id(), amountMinor: 100_000, toSavingsMinor: 0, placeId: bank };
    expect((await post(`/api/people/${debt}/back`, back)).status).toBe(201);
    expect(await balances()).toEqual({ "In hand": 900_000, Bank: 4_900_000 });
    expect((await del(`/api/incomes/${back.id}`)).status).toBe(200);
    expect((await del(`/api/people/${debt}`)).status).toBe(200);
    expect(await balances()).toEqual({ "In hand": 1_200_000, Bank: 4_800_000 });
  });

  it("money borrowed lands in its place once, with its income", async () => {
    const { post, del, addPlace, balances } = await setUp();
    const bank = await addPlace("Bank", 4_800_000);
    const debt = id();
    const borrowed = {
      id: debt,
      direction: "borrowed",
      personName: "Kamala",
      amountMinor: 700_000,
      incomeId: id(),
      placeId: bank,
    };
    expect((await post("/api/people", borrowed)).status).toBe(201);
    expect(await balances()).toEqual({ Bank: 5_500_000 });
    expect((await del(`/api/people/${debt}`)).status).toBe(200);
    expect(await balances()).toEqual({ Bank: 4_800_000 });
    const bad = await post("/api/people", { ...borrowed, id: id(), incomeId: id(), placeId: id() });
    expect(await problemsOf(bad)).toEqual(["place"]);
  });
});

describe("plan extras and places (ticket SAB-52)", () => {
  it("Pay extra comes out of its place once, from free money or from savings; Undo puts it back", async () => {
    const { post, del, addPlace, balances } = await setUp();
    const bank = await addPlace("Bank", 4_800_000);
    const plan = {
      id: id(),
      commitmentId: id(),
      name: "Phone",
      priceMinor: 6_000_000,
      paymentCount: 6,
      paymentMinor: 1_000_000,
      firstPaymentOn: today(),
    };
    expect((await post("/api/plans", plan)).status).toBe(201);
    const free = { id: id(), amountMinor: 500_000, from: "free", placeId: bank };
    expect((await post(`/api/plans/${plan.id}/extra`, free)).status).toBe(201);
    expect(await balances()).toEqual({ Bank: 4_300_000 });
    // From savings: the savings movement names no place, so it is not counted twice.
    const put = { id: id(), kind: "put_in", amountMinor: 1_000_000 };
    expect((await post("/api/savings-movements", put)).status).toBe(201);
    const saved = { id: id(), amountMinor: 400_000, from: "savings", placeId: bank };
    expect((await post(`/api/plans/${plan.id}/extra`, saved)).status).toBe(201);
    expect(await balances()).toEqual({ Bank: 3_900_000 });
    expect((await del(`/api/plans/extra/${saved.id}`)).status).toBe(200);
    expect((await del(`/api/plans/extra/${free.id}`)).status).toBe(200);
    expect(await balances()).toEqual({ Bank: 4_800_000 });
    const bad = await post(`/api/plans/${plan.id}/extra`, { ...free, id: id(), placeId: id() });
    expect(await problemsOf(bad)).toEqual(["place"]);
  });
});

describe("Change dollars and places (ticket SAB-52)", () => {
  it("dollars come out of one place, rupees go into another; Undo puts both back", async () => {
    const { post, del, addPlace, balances } = await setUp(true);
    const dollars = await addPlace("Dollar account", 100_000, { currency: "USD" });
    const bank = await addPlace("Bank", 4_800_000);
    const cv = { id: id(), givenMinor: 20_000, receivedMinor: 6_200_000, doneOn: today() };
    const moved = { ...cv, fromPlaceId: dollars, toPlaceId: bank };
    expect((await post("/api/conversions", moved)).status).toBe(201);
    expect(await balances()).toEqual({ "Dollar account": 80_000, Bank: 11_000_000 });
    expect((await del(`/api/conversions/${cv.id}`)).status).toBe(200);
    expect(await balances()).toEqual({ "Dollar account": 100_000, Bank: 4_800_000 });
    // Each side in its own currency only.
    const crossed = await post("/api/conversions", {
      ...cv,
      id: id(),
      fromPlaceId: bank,
      toPlaceId: dollars,
    });
    expect(crossed.status).toBe(400);
    expect(await problemsOf(crossed)).toEqual(["place"]);
    // One side named: only that place moves.
    expect((await post("/api/conversions", { ...cv, id: id(), toPlaceId: bank })).status).toBe(201);
    expect(await balances()).toEqual({ "Dollar account": 100_000, Bank: 11_000_000 });
  });
});

describe("salary day and places (ticket SAB-52)", () => {
  const undoOffered = async (cookie: string) =>
    (await (await call("/api/current", {}, cookie)).json<{ undoSalaryDay: boolean }>()).undoSalaryDay;

  /** Rent Rs 30,000 and a Rs 5,000 savings set-aside, both unpaid at the end of the cycle. */
  async function withUnpaid() {
    const u = await setUp();
    const rent = id();
    const saving = id();
    const add = (body: Record<string, unknown>) => u.post("/api/commitments", { dueOn: today(), ...body });
    expect((await add({ id: rent, name: "Rent", plannedMinor: 3_000_000 })).status).toBe(201);
    const set = { id: saving, name: "Rainy day", kind: "savings", plannedMinor: 500_000 };
    expect((await add(set)).status).toBe(201);
    const bank = await u.addPlace("Bank", 9_000_000);
    const hand = await u.addPlace("In hand", 200_000);
    return { ...u, rent, saving, bank, hand };
  }

  it("the salary lands in its place; a Paid it comes out of its place, a set-aside moved to savings stays", async () => {
    const { post, balances, rent, saving, bank, hand } = await withUnpaid();
    const payment = id();
    const b = salaryDay({
      placeId: bank,
      close: close([
        { id: rent, choice: "paid", newId: payment, placeId: bank },
        // Moved to savings: the money stays where it is, whatever is sent.
        { id: saving, choice: "paid", newId: id(), placeId: hand },
      ]),
    });
    expect((await post("/api/salary-day", b)).status).toBe(201);
    expect(await balances()).toEqual({ Bank: 9_000_000 + 25_000_000 - 3_000_000, "In hand": 200_000 });
    const paid = await env.DB.prepare("select place_id as placeId from commitment_payment where id = ?")
      .bind(payment)
      .first<{ placeId: string | null }>();
    expect(paid?.placeId).toBe(bank);
  });

  it("the salary amount changed later moves its place with it", async () => {
    const { cookie, post, balances, rent, saving, bank } = await withUnpaid();
    const dropped = [
      { id: rent, choice: "drop" },
      { id: saving, choice: "drop" },
    ];
    expect((await post("/api/salary-day", salaryDay({ placeId: bank, close: close(dropped) }))).status).toBe(
      201,
    );
    expect((await send("PATCH", "/api/salary", { salaryMinor: 26_000_000 }, cookie)).status).toBe(200);
    expect(await balances()).toEqual({ Bank: 35_000_000, "In hand": 200_000 });
  });

  it("refuses a salary place of another currency and a Paid it place that is not the user's", async () => {
    const { post, balances, rent, saving, bank } = await withUnpaid();
    const dropped = [
      { id: rent, choice: "drop" },
      { id: saving, choice: "drop" },
    ];
    const unknown = await post("/api/salary-day", salaryDay({ placeId: id(), close: close(dropped) }));
    expect(unknown.status).toBe(400);
    expect(await problemsOf(unknown)).toEqual(["place"]);
    const paid = [
      { id: rent, choice: "paid", newId: id(), placeId: id() },
      { id: saving, choice: "drop" },
    ];
    const bad = await post("/api/salary-day", salaryDay({ placeId: bank, close: close(paid) }));
    expect(await problemsOf(bad)).toEqual(["place"]);
    expect(await balances()).toEqual({ Bank: 9_000_000, "In hand": 200_000 });
  });

  it("Undo salary day puts the balances back; Move money, Set balance and deleting a place keep the Undo", async () => {
    const { cookie, post, del, addPlace, balances, rent, saving, bank, hand } = await withUnpaid();
    const spare = await addPlace("Spare", 0);
    const b = salaryDay({
      placeId: bank,
      close: close([
        { id: rent, choice: "paid", newId: id(), placeId: hand },
        { id: saving, choice: "drop" },
      ]),
    });
    expect((await post("/api/salary-day", b)).status).toBe(201);
    expect(await balances()).toEqual({ Bank: 34_000_000, "In hand": -2_800_000, Spare: 0 });
    expect(await undoOffered(cookie)).toBe(true);

    await later();
    const move = { id: id(), fromPlaceId: bank, toPlaceId: spare, amountMinor: 1_000_000 };
    expect((await post("/api/places/moves", move)).status).toBe(201);
    const check = { id: id(), amountMinor: 50_000 };
    expect((await post(`/api/places/${spare}/checks`, check)).status).toBe(201);
    expect(await undoOffered(cookie)).toBe(true);
    // The place the Paid it came out of is deleted: the payment stays, unchanged, with no place.
    expect((await del(`/api/places/${hand}?balances=delete`)).status).toBe(200);
    expect(await undoOffered(cookie)).toBe(true);

    expect((await post("/api/salary-day/undo", { cycleId: b.cycleId })).status).toBe(200);
    // The salary is out of the bank again; the Move money stays (it belongs to no cycle).
    expect(await balances()).toEqual({ Bank: 8_000_000, Spare: 50_000 });
  });
});

describe("deleting a place (ticket SAB-52)", () => {
  it("clears it from every entry that named it; the entries stay", async () => {
    const { post, del, addPlace, balances } = await setUp(true);
    const bank = await addPlace("Bank", 4_800_000);
    const dollars = await addPlace("Dollar account", 100_000, { currency: "USD" });
    const income = { id: id(), kind: "extra", amountMinor: 500_000, toSavingsMinor: 0, placeId: bank };
    expect((await post("/api/incomes", income)).status).toBe(201);
    const put = { id: id(), kind: "put_in", amountMinor: 100_000, placeId: bank };
    expect((await post("/api/savings-movements", put)).status).toBe(201);
    const lent = { id: id(), direction: "lent", personName: "Nimal", amountMinor: 300_000, placeId: bank };
    expect((await post("/api/people", lent)).status).toBe(201);
    const cv = { id: id(), givenMinor: 20_000, receivedMinor: 6_200_000, doneOn: today() };
    expect((await post("/api/conversions", { ...cv, fromPlaceId: dollars, toPlaceId: bank })).status).toBe(
      201,
    );
    expect(await balances()).toEqual({ Bank: 11_300_000, "Dollar account": 80_000 });

    expect((await del(`/api/places/${bank}?balances=delete`)).status).toBe(200);
    expect(await balances()).toEqual({ "Dollar account": 80_000 });
    const n = async (table: string, column = "place_id") =>
      (
        await env.DB.prepare(`select count(*) as n, count(${column}) as named from "${table}" where id = ?`)
          .bind(
            { income: income.id, savings_movement: put.id, person_debt: lent.id, conversion: cv.id }[table],
          )
          .first<{ n: number; named: number }>()
      )?.named;
    expect(await n("income")).toBe(0);
    expect(await n("savings_movement")).toBe(0);
    expect(await n("person_debt")).toBe(0);
    expect(await n("conversion", "to_place_id")).toBe(0);
    // The other side of the conversion keeps its place.
    expect(await n("conversion", "from_place_id")).toBe(1);
  });
});
