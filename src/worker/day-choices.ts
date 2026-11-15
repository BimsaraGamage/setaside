import { Hono } from "hono";
import * as z from "zod";
import { current } from "./current";
import { dayChoice } from "./db/schema";
import { json } from "./json";
import type { SignedIn } from "./user-check";

const newDayChoice = z.object({
  id: z.uuid(),
  dayOn: z.string(),
  choice: z.enum(["spread", "today"]),
});

/**
 * The morning underspend answer (backlog item 9, spec 7): Spread over the days
 * left or Add to today, once a day, for today only. The phone works out whether
 * there is a question and what each answer makes the allowance.
 */
export const dayChoices = new Hono<SignedIn>().post("/day-choices", json(newDayChoice), async (c) => {
  const { db, userId } = c.var;
  const b = c.req.valid("json");
  const now = await current(c);
  if (!now) return c.json({ error: "not_set_up" as const }, 404);
  // Only today's question can be answered; an earlier day is already counted.
  if (b.dayOn !== now.today) return c.json({ error: "invalid" as const, problems: ["day_on"] }, 400);
  try {
    await db.insert(dayChoice).values({ ...b, userId, cycleId: now.cycle.id });
  } catch {
    // Today is already answered (another phone), or the id is in use.
    return c.json({ error: "conflict" as const }, 409);
  }
  return c.json({ ok: true as const }, 201);
});
