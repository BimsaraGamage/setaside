import { desc } from "drizzle-orm";
import { todayIn } from "../money";
import { cycle, settings } from "./db/schema";
import type { SignedIn } from "./user-check";

/** Settings, the current cycle and today in the home time zone; null before first use. */
export async function current(c: { var: SignedIn["Variables"] }) {
  const { db, mine } = c.var;
  const s = await db.query.settings.findFirst({ where: mine(settings) });
  const cur = await db.query.cycle.findFirst({
    where: mine(cycle),
    orderBy: [desc(cycle.startedOn), desc(cycle.createdAt)],
  });
  if (!s || !cur) return null;
  return { settings: s, cycle: cur, today: todayIn(s.homeTimeZone, Date.now()) };
}
