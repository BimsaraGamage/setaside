import { desc } from "drizzle-orm";
import { type Currencies, todayIn } from "../money";
import { countingRate, cycle, settings } from "./db/schema";
import type { SignedIn } from "./user-check";

/** The user's currencies as the money-rule checks take them (spec 8). */
export function currenciesOf(s: { salaryCurrency: string; spendingCurrency: string }): Currencies {
  return s.salaryCurrency === s.spendingCurrency
    ? { spendingCurrency: s.spendingCurrency }
    : { spendingCurrency: s.spendingCurrency, salaryCurrency: s.salaryCurrency };
}

/** The newest counting rate the user set (spec 8); null with none. */
export async function countingRateOf(c: { var: SignedIn["Variables"] }): Promise<string | null> {
  const { db, mine } = c.var;
  const row = await db.query.countingRate.findFirst({
    where: mine(countingRate),
    orderBy: [desc(countingRate.setAt), desc(countingRate.id)],
    columns: { rate: true },
  });
  return row?.rate ?? null;
}

/** Settings, the current cycle and today in the home time zone; null before first use. */
export async function current(c: { var: SignedIn["Variables"] }) {
  const { db, mine } = c.var;
  const s = await db.query.settings.findFirst({ where: mine(settings) });
  const cur = await db.query.cycle.findFirst({
    where: mine(cycle),
    orderBy: [desc(cycle.startedOn), desc(cycle.createdAt)],
  });
  if (!s || !cur) return null;
  return {
    settings: s,
    currencies: currenciesOf(s),
    cycle: cur,
    today: todayIn(s.homeTimeZone, Date.now()),
  };
}
