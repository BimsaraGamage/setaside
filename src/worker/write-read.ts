import { type Currencies, todayIn } from "../money";
import { currenciesOf } from "./current";
import type { SignedIn } from "./user-check";

/**
 * What the common money writes (spends, payments, the day's underspend answer)
 * check against, read in ONE D1 batch of fixed SQL (ticket SAB-45), like Today's
 * read (`today-read.ts`, SAB-41). Each Drizzle query one after another cost CPU to
 * build and a D1 call of its own; live, a spend went over the free plan's 10 ms
 * on every try. A write now makes two D1 calls: this read, then the write.
 *
 * Rules: `?1` is the signed-in user (`c.var.userId`) and every table read is
 * scoped to it (`user_id = ?1`), like `mine()`; a statement's own values are
 * `?2`, `?3`… in order.
 */
const NOW = `select s.salary_currency as salaryCurrency, s.spending_currency as spendingCurrency,
    s.home_time_zone as homeTimeZone, cur.id as cycleId, cur.started_on as cycleStartedOn,
    cur.expected_salary_on as cycleExpectedSalaryOn, cur.reserve_rate as cycleReserveRate,
    (select rate from counting_rate where user_id = ?1 order by set_at desc, id desc limit 1) as countingRate
  from settings s
    join (select id, started_on, expected_salary_on, reserve_rate from cycle where user_id = ?1
      order by started_on desc, created_at desc limit 1) cur
  where s.user_id = ?1 limit 1`;

/** Settings, the current cycle and today in the home time zone, as `current()` gives them for a write. */
export interface WriteNow {
  settings: { salaryCurrency: string; spendingCurrency: string; homeTimeZone: string };
  currencies: Currencies;
  cycle: { id: string; startedOn: string; expectedSalaryOn: string; reserveRate: string | null };
  today: string;
  /** The newest counting rate the user set (spec 8); null with none. */
  countingRate: string | null;
}

interface NowRow {
  salaryCurrency: string;
  spendingCurrency: string;
  homeTimeZone: string;
  cycleId: string;
  cycleStartedOn: string;
  cycleExpectedSalaryOn: string;
  cycleReserveRate: string | null;
  countingRate: string | null;
}

/** One more statement for the batch: fixed SQL and its own values (`?2`…). */
export type Read = readonly [sql: string, ...values: (string | number | null)[]];

/**
 * Reads "now" plus the given statements in one batch. `now` is null before first
 * use; each named read gives its rows (typed by the caller, column names as aliased).
 */
export async function readForWrite<R extends Record<string, unknown[]>>(
  c: { var: Pick<SignedIn["Variables"], "db" | "userId"> },
  reads: { [K in keyof R]: Read },
): Promise<{ now: WriteNow | null } & R> {
  const d1 = c.var.db.$client;
  const names = Object.keys(reads) as (keyof R & string)[];
  const statements = [NOW, ...names.map((n) => reads[n][0])];
  const values = [[], ...names.map((n) => reads[n].slice(1))];
  const results = await d1.batch(
    statements.map((sql, i) => d1.prepare(sql).bind(c.var.userId, ...(values[i] ?? []))),
  );
  const row = results[0]?.results[0] as NowRow | undefined;
  const now: WriteNow | null = row
    ? {
        settings: {
          salaryCurrency: row.salaryCurrency,
          spendingCurrency: row.spendingCurrency,
          homeTimeZone: row.homeTimeZone,
        },
        currencies: currenciesOf(row),
        cycle: {
          id: row.cycleId,
          startedOn: row.cycleStartedOn,
          expectedSalaryOn: row.cycleExpectedSalaryOn,
          reserveRate: row.cycleReserveRate,
        },
        today: todayIn(row.homeTimeZone, Date.now()),
        countingRate: row.countingRate,
      }
    : null;
  return { now, ...Object.fromEntries(names.map((n, i) => [n, results[i + 1]?.results ?? []])) } as {
    now: WriteNow | null;
  } & R;
}
