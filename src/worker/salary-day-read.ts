import type { ClosingEntries, IncomeKind } from "../money";
import type { commitment, RecurringBefore } from "./db/schema";
import { type Bit, bool } from "./today-read";
import type { Read, WriteNow } from "./write-read";

/**
 * What salary day checks and closes against, as fixed SQL for ONE `readForWrite`
 * batch (ticket SAB-74, like SAB-45 and SAB-72): Drizzle reads one after another
 * (about 15 D1 calls: now, pots, the ids it names, the ending cycle's entries)
 * took it to ~20 ms CPU locally. Salary day now makes two D1 calls: this read,
 * then its write. Same rules as `write-read.ts`: `?1` is the user, every table
 * is scoped to it, and the ids a request names come as one JSON array (`?2`)
 * read with `json_each`: D1 caps bound values at 100 a statement.
 */
const CUR = `with cur as (select id from cycle where user_id = ?1 order by started_on desc, created_at desc limit 1)`;
const CUR_ID = `(select id from cur)`;
const IDS = `(select value from json_each(?2))`;

/** One commitment row as salary day reads it (all the columns it uses). */
const COMMITMENT_COLUMNS = `id, cycle_id as cycleId, name, kind, currency, planned_minor as plannedMinor,
  due_on as dueOn, state, recurring_id as recurringId, carried_from_id as carriedFromId,
  prepayment_id as prepaymentId, card_id as cardId, plan_id as planId, person_debt_id as personDebtId,
  goal_id as goalId`;

/** The current cycle's entries the money rules close it from (`ClosingEntries`, spec 6). */
export const ENTRIES_READS = {
  incomes: [
    `${CUR} select kind, currency, amount_minor as amountMinor, to_savings_minor as toSavingsMinor,
        received_on as receivedOn
      from income where user_id = ?1 and cycle_id = ${CUR_ID}`,
  ],
  spends: [
    `${CUR} select spent_on as spentOn, currency, amount_minor as amountMinor, pot_id as potId, one_off as oneOff
      from spend where user_id = ?1 and cycle_id = ${CUR_ID}`,
  ],
  commitments: [
    `${CUR} select ${COMMITMENT_COLUMNS} from commitment where user_id = ?1 and cycle_id = ${CUR_ID}`,
  ],
  payments: [
    `${CUR} select commitment_id as commitmentId, amount_minor as amountMinor, currency,
        covers_minor as coversMinor, paid_on as paidOn
      from commitment_payment where user_id = ?1
        and commitment_id in (select id from commitment where user_id = ?1 and cycle_id = ${CUR_ID})`,
  ],
  allocations: [
    `${CUR} select p.id, p.currency, p.archived, a.amount_minor as amountMinor
      from pot_allocation a join pot p on p.id = a.pot_id
      where p.user_id = ?1 and a.user_id = ?1 and a.cycle_id = ${CUR_ID}`,
  ],
  takeOuts: [
    `${CUR} select currency, amount_minor as amountMinor, moved_on as movedOn
      from savings_movement where user_id = ?1 and cycle_id = ${CUR_ID} and kind = 'take_out'`,
  ],
  conversions: [
    `${CUR} select given_minor as givenMinor, received_minor as receivedMinor, gain_minor as gainMinor
      from conversion where user_id = ?1 and cycle_id = ${CUR_ID}`,
  ],
  // Pay extra from free money (item 19) comes out of this cycle's free money.
  planExtras: [
    `${CUR} select currency, amount_minor as amountMinor from plan_extra_payment
      where user_id = ?1 and cycle_id = ${CUR_ID} and paid_from = 'free'`,
  ],
  // Money lent to people in this cycle (item 20) came out of its free money.
  lent: [
    `${CUR} select currency, amount_minor as amountMinor from person_debt
      where user_id = ?1 and cycle_id = ${CUR_ID} and direction = 'lent'`,
  ],
} as const satisfies Record<string, Read>;

type Commitment = typeof commitment.$inferSelect;
export type CommitmentRow = Pick<
  Commitment,
  | "id"
  | "cycleId"
  | "name"
  | "kind"
  | "currency"
  | "plannedMinor"
  | "dueOn"
  | "state"
  | "recurringId"
  | "carriedFromId"
  | "prepaymentId"
  | "cardId"
  | "planId"
  | "personDebtId"
  | "goalId"
>;

export type EntriesRows = {
  incomes: {
    kind: IncomeKind;
    currency: string;
    amountMinor: number;
    toSavingsMinor: number;
    receivedOn: string;
  }[];
  spends: { spentOn: string; currency: string; amountMinor: number; potId: string | null; oneOff: Bit }[];
  commitments: CommitmentRow[];
  payments: {
    commitmentId: string;
    amountMinor: number;
    currency: string;
    coversMinor: number | null;
    paidOn: string;
  }[];
  allocations: { id: string; currency: string; archived: Bit; amountMinor: number }[];
  takeOuts: { currency: string; amountMinor: number; movedOn: string }[];
  conversions: { givenMinor: number; receivedMinor: number; gainMinor: number }[];
  planExtras: { currency: string; amountMinor: number }[];
  lent: { currency: string; amountMinor: number }[];
};

/** The current cycle's entries, as the money rules need them: its leftover, a conversion's split. */
export function entriesFrom(r: EntriesRows, now: WriteNow) {
  return {
    spendingCurrency: now.settings.spendingCurrency,
    salaryCurrency: now.settings.salaryCurrency,
    countingRate: now.countingRate,
    reserveRate: now.cycle.reserveRate,
    conversions: r.conversions,
    startedOn: now.cycle.startedOn,
    expectedSalaryOn: now.cycle.expectedSalaryOn,
    incomes: r.incomes,
    spends: r.spends.map((s) => ({ ...s, oneOff: bool(s.oneOff) })),
    commitments: r.commitments.map((k) => ({
      ...k,
      payments: r.payments.filter((p) => p.commitmentId === k.id),
    })),
    pots: r.allocations.map((p) => ({ ...p, archived: bool(p.archived) })),
    takenOut: r.takeOuts.map((t) => ({ ...t, amountMinor: -t.amountMinor })),
    planExtras: r.planExtras,
    lent: r.lent,
  } satisfies ClosingEntries;
}

/** A row read by id from a table the request names (`?2` the ids). */
const byIds = (sql: string, ids: string[]): Read => [sql, JSON.stringify([...new Set(ids)])];

/** The ids a salary day names, by what they point at. */
export interface SalaryDayIds {
  carried: string[];
  prepayments: string[];
  cards: string[];
  plans: string[];
  goals: string[];
  places: string[];
  templates: string[];
}

/**
 * Everything salary day reads: every pot, the rows the request names by id (each
 * the user's, else not found) and the ending cycle's entries.
 */
export function salaryDayReads(ids: SalaryDayIds) {
  return {
    pots: [
      `select id, name, currency, usual_amount_minor as usualAmountMinor, archived from pot where user_id = ?1`,
    ],
    carried: byIds(
      `select ${COMMITMENT_COLUMNS} from commitment where user_id = ?1 and id in ${IDS}`,
      ids.carried,
    ),
    prepayments: byIds(`select id from prepayment where user_id = ?1 and id in ${IDS}`, ids.prepayments),
    cards: byIds(`select id, currency from card where user_id = ?1 and id in ${IDS}`, ids.cards),
    plans: byIds(
      `select id, currency, paid_off_on as paidOffOn from instalment_plan where user_id = ?1 and id in ${IDS}`,
      ids.plans,
    ),
    goals: byIds(
      `select id, currency, stopped from savings_goal where user_id = ?1 and id in ${IDS}`,
      ids.goals,
    ),
    places: byIds(`select id, currency, archived from place where user_id = ?1 and id in ${IDS}`, ids.places),
    templates: byIds(
      `select id, user_id as userId, name, kind, currency, usual_amount_minor as usualAmountMinor,
          usual_day as usualDay, card_id as cardId, active, created_at as createdAt, updated_at as updatedAt
        from recurring_commitment where user_id = ?1 and id in ${IDS}`,
      ids.templates,
    ),
    ...ENTRIES_READS,
  } satisfies Record<string, Read>;
}

export type SalaryDayRows = EntriesRows & {
  pots: { id: string; name: string; currency: string; usualAmountMinor: number; archived: Bit }[];
  carried: CommitmentRow[];
  prepayments: { id: string }[];
  cards: { id: string; currency: string }[];
  plans: { id: string; currency: string; paidOffOn: string | null }[];
  goals: { id: string; currency: string; stopped: Bit }[];
  places: { id: string; currency: string; archived: Bit }[];
  templates: (Omit<RecurringBefore, "active" | "createdAt" | "updatedAt"> & {
    active: Bit;
    createdAt: number;
    updatedAt: number;
  })[];
};

/** A template as it was, the way Drizzle reads it (Undo salary day puts it back from this). */
export const templateBefore = (t: SalaryDayRows["templates"][number]): RecurringBefore => ({
  ...t,
  active: bool(t.active),
  createdAt: new Date(t.createdAt),
  updatedAt: new Date(t.updatedAt),
});
