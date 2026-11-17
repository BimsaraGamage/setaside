import type { CardTotal } from "./cards";
import type { commitment, cycle, dayChoice, income, recurringCommitment, settings } from "./db/schema";
import type { PersonDebtRows } from "./people";
import type { PlanRows } from "./plans";
import type { PrepaymentRow } from "./prepayments";
import type { SavingsRows } from "./savings";
import type { SignedIn } from "./user-check";

/**
 * Everything Today needs (GET /api/current) read in ONE D1 batch of fixed SQL
 * (ticket SAB-41). Building ~25 Drizzle queries one after another cost ~30 ms CPU
 * a load against the free plan's 10 ms; fixed strings sent in one batch skip the
 * query building, and the rows are mapped by hand in `currentData`.
 *
 * Rules for every statement here:
 * - `?1` is the signed-in user (`c.var.userId`) and every table read is scoped to
 *   it (`user_id = ?1`), the same as `mine()` does for Drizzle queries.
 * - the current cycle is `cur` (newest by start day, then made last) and the one
 *   before it `last`, as subqueries: no lookup first, so one round trip.
 * - D1 caps bound values at 100 a statement: read by subquery, never `in (...ids)`.
 * - Every later read added to Today goes into this same batch (and its row type
 *   into `TodayRows`), not a query of its own. A batch counts each statement
 *   against the 50 queries a request on the free plan; this is 29 (was ~40).
 */
const CUR = `with cur as (select id, created_at from cycle where user_id = ?1 order by started_on desc, created_at desc limit 1)`;
const LAST = `with last as (select id from cycle where user_id = ?1 order by started_on desc, created_at desc limit 1 offset 1)`;
const CUR_ID = `(select id from cur)`;
/** What a payment covers of its commitment: its amount in the same currency, else what it covers. */
const COVERED = `sum(case when cp.currency = k.currency then cp.amount_minor else coalesce(cp.covers_minor, 0) end)`;
const PAYMENTS_OF = (kind: string) =>
  `from commitment_payment cp join commitment k on k.id = cp.commitment_id where cp.user_id = ?1 and k.user_id = ?1 and k.kind = '${kind}'`;

/**
 * Undo salary day (item 13): offered while the current cycle has an undo record and
 * nothing was entered or changed after it was made (the salary amount excepted).
 * Same tables as `undoRecord` in salary-day.ts; a new table there joins here too.
 */
const UNDO_TABLES: [table: string, more?: string][] = [
  ["spend"],
  ["commitment"],
  ["commitment_payment"],
  ["pot"],
  ["pot_allocation"],
  ["day_choice"],
  ["savings_movement"],
  ["prepayment"],
  ["recurring_commitment"],
  ["conversion"],
  ["card"],
  ["instalment_plan"],
  ["plan_extra_payment"],
  ["person_debt"],
  // The salary amount stays editable during the current cycle (spec 2).
  ["income", `(cycle_id <> ${CUR_ID} or kind <> 'salary')`],
];

const SQL = {
  settings: `select salary_currency as salaryCurrency, spending_currency as spendingCurrency,
      home_time_zone as homeTimeZone, usual_pay_day as usualPayDay, asked_time_zone as askedTimeZone,
      remind_due_soon as remindDueSoon, remind_due_today as remindDueToday,
      remind_running_out as remindRunningOut, remind_salary_late as remindSalaryLate,
      remind_questions as remindQuestions, remind_spend_nudge as remindSpendNudge,
      morning_at as morningAt, nudge_at as nudgeAt, due_soon_days as dueSoonDays,
      banner_dismissed as bannerDismissed
    from settings where user_id = ?1 limit 1`,
  countingRate: `select rate from counting_rate where user_id = ?1 order by set_at desc, id desc limit 1`,
  /** The current cycle and the one before it (its speed is used in the first 3 days, item 8). */
  cycles: `select id, started_on as startedOn, expected_salary_on as expectedSalaryOn, reserve_rate as reserveRate
    from cycle where user_id = ?1 order by started_on desc, created_at desc limit 2`,
  incomes: `${CUR} select id, kind, currency, amount_minor as amountMinor, to_savings_minor as toSavingsMinor,
      received_on as receivedOn
    from income where user_id = ?1 and cycle_id = ${CUR_ID}`,
  spends: `${CUR} select id, spent_on as spentOn, currency, amount_minor as amountMinor, note, pot_id as potId,
      card_id as cardId, one_off as oneOff
    from spend where user_id = ?1 and cycle_id = ${CUR_ID} order by spent_on desc, id desc`,
  commitments: `${CUR} select id, name, kind, currency, planned_minor as plannedMinor, due_on as dueOn, state,
      recurring_id as recurringId, carried_from_id as carriedFromId, prepayment_id as prepaymentId,
      card_id as cardId, plan_id as planId, person_debt_id as personDebtId
    from commitment where user_id = ?1 and cycle_id = ${CUR_ID} order by due_on, name`,
  payments: `${CUR} select id, commitment_id as commitmentId, amount_minor as amountMinor, currency,
      covers_minor as coversMinor, paid_on as paidOn
    from commitment_payment where user_id = ?1
      and commitment_id in (select id from commitment where user_id = ?1 and cycle_id = ${CUR_ID})
    order by paid_on, id`,
  /** Every pot (they last across cycles) with this cycle's amount, if it has one. */
  pots: `${CUR} select p.id, p.name, p.currency, p.usual_amount_minor as usualAmountMinor, p.archived,
      a.amount_minor as amountMinor
    from pot p left join pot_allocation a on a.pot_id = p.id and a.cycle_id = coalesce(${CUR_ID}, '')
    where p.user_id = ?1 order by p.created_at, p.id`,
  dayChoices: `${CUR} select day_on as dayOn, choice from day_choice
    where user_id = ?1 and cycle_id = ${CUR_ID} order by day_on`,
  // Savings (spec 5): the rows of `savingsLines`.
  savingsMoves: `select m.id, m.kind, m.cycle_id as cycleId, m.currency, m.amount_minor as amountMinor,
      m.moved_on as movedOn, pp.name as name, ip.name as planName
    from savings_movement m
      left join prepayment pp on pp.id = m.prepayment_id and pp.user_id = ?1
      left join plan_extra_payment x on x.id = m.id and x.user_id = ?1
      left join instalment_plan ip on ip.id = x.plan_id and ip.user_id = ?1
    where m.user_id = ?1`,
  savingsIncomes: `select id, kind, cycle_id as cycleId, currency, to_savings_minor as toSavingsMinor,
      received_on as receivedOn
    from income where user_id = ?1 and to_savings_minor > 0`,
  savingsSetAsides: `select cp.id, k.cycle_id as cycleId, cp.currency, cp.amount_minor as amountMinor,
      cp.paid_on as "on", k.name, k.kind
    from commitment_payment cp join commitment k on k.id = cp.commitment_id
    where cp.user_id = ?1 and k.user_id = ?1 and k.kind in ('savings', 'savings_payback')
    order by cp.paid_on desc`,
  savingsGains: `select id, cycle_id as cycleId, gain_minor as gainMinor, done_on as doneOn
    from conversion where user_id = ?1 and gain_minor > 0`,
  // Prepayments from savings with their payback so far (item 14).
  prepayments: `select pp.id, pp.name, pp.currency, pp.total_minor as totalMinor, pp.payback_minor as paybackMinor,
      pp.normal_monthly_minor as normalMonthlyMinor, pp.months, m.moved_on as startedOn
    from prepayment pp join savings_movement m on m.prepayment_id = pp.id
    where pp.user_id = ?1 and m.user_id = ?1 order by m.moved_on, pp.id`,
  prepaymentsPaid: `select k.prepayment_id as id, sum(cp.amount_minor) as paidMinor
    ${PAYMENTS_OF("savings_payback")} group by k.prepayment_id`,
  /** The "Every cycle" templates, paused ones too (item 11). */
  recurring: `select id, name, kind, currency, usual_amount_minor as usualAmountMinor, usual_day as usualDay,
      active, card_id as cardId
    from recurring_commitment where user_id = ?1 order by usual_day, name`,
  undo: `${CUR} select exists (select 1 from cycle_close where user_id = ?1 and next_cycle_id = ${CUR_ID}
        and undo is not null and undo <> 'null')
      and not (${UNDO_TABLES.map(
        ([t, more]) =>
          `exists (select 1 from "${t}" where user_id = ?1 and updated_at > (select created_at from cur)${more ? ` and ${more}` : ""})`,
      ).join(" or ")}) as offered`,
  // Last cycle's spends and pot amounts, for its speeds (item 8).
  lastSpends: `${LAST} select spent_on as spentOn, currency, amount_minor as amountMinor, pot_id as potId,
      one_off as oneOff
    from spend where user_id = ?1 and cycle_id = (select id from last)`,
  lastPots: `${LAST} select p.id, p.currency, a.amount_minor as amountMinor
    from pot_allocation a join pot p on p.id = a.pot_id
    where p.user_id = ?1 and a.cycle_id = (select id from last)`,
  /** This cycle's conversions (item 16). */
  conversions: `${CUR} select id, given_minor as givenMinor, received_minor as receivedMinor, rate,
      covered_minor as coveredMinor, gain_minor as gainMinor, done_on as doneOn
    from conversion where user_id = ?1 and cycle_id = ${CUR_ID} order by done_on desc, created_at desc`,
  // Cards with what they owed before this cycle (item 18): the rows of `cardLines`.
  cards: `select id, name, currency, archived from card where user_id = ?1 order by created_at, id`,
  cardsSpent: `${CUR} select card_id as cardId, sum(amount_minor) as total from spend
    where user_id = ?1 and cycle_id <> ${CUR_ID} and card_id is not null group by card_id`,
  cardsPaid: `${CUR} select k.card_id as cardId, ${COVERED} as total ${PAYMENTS_OF("card_bill")}
      and k.cycle_id <> ${CUR_ID} and k.card_id is not null
    group by k.card_id`,
  // Instalment plans (item 19): the rows of `planLines`.
  plans: `select id, name, currency, price_minor as priceMinor, payment_count as paymentCount,
      payment_minor as paymentMinor, first_payment_on as firstPaymentOn, card_id as cardId,
      normal_monthly_minor as normalMonthlyMinor, paid_off_on as paidOffOn
    from instalment_plan where user_id = ?1 order by created_at, id`,
  plansPaid: `select k.plan_id as planId, k.state, ${COVERED} as covered ${PAYMENTS_OF("plan_payment")}
    group by k.id`,
  planExtras: `select id, plan_id as planId, cycle_id as cycleId, amount_minor as amountMinor,
      paid_from as paidFrom, pays_off as paysOff, paid_on as paidOn
    from plan_extra_payment where user_id = ?1 order by paid_on, created_at`,
  // People (item 20): the rows of `personDebtLines`.
  debts: `select id, cycle_id as cycleId, person_name as personName, direction, currency,
      amount_minor as amountMinor, made_on as madeOn, settled_on as settledOn
    from person_debt where user_id = ?1 order by made_on, created_at, id`,
  debtIncomes: `select id, kind, cycle_id as cycleId, amount_minor as amountMinor,
      to_savings_minor as toSavingsMinor, received_on as receivedOn, person_debt_id as personDebtId
    from income where user_id = ?1 and person_debt_id is not null order by received_on, created_at`,
  debtsPaid: `select k.person_debt_id as personDebtId, ${COVERED} as covered ${PAYMENTS_OF("person_payback")}
    group by k.person_debt_id`,
} as const satisfies Record<keyof TodayRows, string>;

/** D1 gives booleans as 0 and 1. */
type Bit = 0 | 1;
type Row<T, Bits extends keyof T = never> = Omit<T, Bits> & { [K in Bits]: Bit };
type Settings = typeof settings.$inferSelect;
type Kind<T extends { kind: unknown }> = T["kind"];

/** The rows of each statement, as D1 gives them. */
export interface TodayRows {
  settings: Row<
    Omit<Settings, "id" | "userId" | "salaryCurrency" | "createdAt" | "updatedAt"> & {
      salaryCurrency: string;
    },
    | "remindDueSoon"
    | "remindDueToday"
    | "remindRunningOut"
    | "remindSalaryLate"
    | "remindQuestions"
    | "remindSpendNudge"
    | "bannerDismissed"
  >;
  countingRate: { rate: string };
  cycles: Pick<typeof cycle.$inferSelect, "id" | "startedOn" | "expectedSalaryOn" | "reserveRate">;
  incomes: {
    id: string;
    kind: Kind<typeof income.$inferSelect>;
    currency: string;
    amountMinor: number;
    toSavingsMinor: number;
    receivedOn: string;
  };
  spends: {
    id: string;
    spentOn: string;
    currency: string;
    amountMinor: number;
    note: string | null;
    potId: string | null;
    cardId: string | null;
    oneOff: Bit;
  };
  commitments: Omit<typeof commitment.$inferSelect, "userId" | "cycleId" | "createdAt" | "updatedAt">;
  payments: {
    id: string;
    commitmentId: string;
    amountMinor: number;
    currency: string;
    coversMinor: number | null;
    paidOn: string;
  };
  pots: {
    id: string;
    name: string;
    currency: string;
    usualAmountMinor: number;
    archived: Bit;
    amountMinor: number | null;
  };
  dayChoices: Pick<typeof dayChoice.$inferSelect, "dayOn" | "choice">;
  savingsMoves: SavingsRows["moves"][number];
  savingsIncomes: SavingsRows["incomes"][number];
  savingsSetAsides: SavingsRows["setAsides"][number];
  savingsGains: SavingsRows["gains"][number];
  prepayments: PrepaymentRow;
  prepaymentsPaid: { id: string | null; paidMinor: number };
  recurring: Row<
    Omit<typeof recurringCommitment.$inferSelect, "userId" | "createdAt" | "updatedAt">,
    "active"
  >;
  undo: { offered: Bit };
  lastSpends: {
    spentOn: string;
    currency: string;
    amountMinor: number;
    potId: string | null;
    oneOff: Bit;
  };
  lastPots: { id: string; currency: string; amountMinor: number };
  conversions: {
    id: string;
    givenMinor: number;
    receivedMinor: number;
    rate: string;
    coveredMinor: number;
    gainMinor: number;
    doneOn: string;
  };
  cards: { id: string; name: string; currency: string; archived: Bit };
  cardsSpent: CardTotal;
  cardsPaid: CardTotal;
  plans: PlanRows["plans"][number];
  plansPaid: PlanRows["paid"][number];
  planExtras: Row<PlanRows["extras"][number], "paysOff">;
  debts: PersonDebtRows["debts"][number];
  debtIncomes: PersonDebtRows["incomes"][number];
  debtsPaid: PersonDebtRows["paid"][number];
}

const NAMES = Object.keys(SQL) as (keyof typeof SQL)[];

/** Reads every statement above in one batch: each name's rows. */
export async function readToday(c: {
  var: Pick<SignedIn["Variables"], "db" | "userId">;
}): Promise<{ [K in keyof TodayRows]: TodayRows[K][] }> {
  const d1 = c.var.db.$client;
  const results = await d1.batch(NAMES.map((n) => d1.prepare(SQL[n]).bind(c.var.userId)));
  return Object.fromEntries(NAMES.map((n, i) => [n, results[i]?.results ?? []])) as {
    [K in keyof TodayRows]: TodayRows[K][];
  };
}

/** A 0/1 column as a boolean, as Drizzle maps it. */
export const bool = (b: Bit | number) => Number(b) === 1;
