import { and, eq } from "drizzle-orm";
import { Hono } from "hono";
import * as z from "zod";
import { checkSavingsGoal, goalLeftMinor, goalSavedMinor, savingsTotal } from "../money";
import { commitment, savingsGoal } from "./db/schema";
import { json } from "./json";
import { SAVINGS_READS, type SavingsReadRows, savingsLinesFrom } from "./savings";
import type { Bit } from "./today-read";
import type { SignedIn } from "./user-check";
import { readForWrite } from "./write-read";

/*
 * What a goal write checks against is read with "now" and today's savings in one D1
 * batch (SAB-72): live, making a goal with Drizzle reads one after another took
 * 13-18 ms CPU (ticket SAB-70), over the free plan's 10 ms.
 */
const GOAL_COUNT = `select count(*) as n from savings_goal where user_id = ?1`;
const GOAL = `select id, name, currency, target_minor as targetMinor, by_on as byOn, start_minor as startMinor, stopped
  from savings_goal where user_id = ?1 and id = ?2`;

/** One goal share, any cycle, as Today's read brings it (`today-read.ts`). */
export interface GoalShareLine {
  id: string;
  goalId: string;
  cycleId: string;
  /** Its cycle's first day. */
  startedOn: string;
  plannedMinor: number;
  state: "open" | "finished" | "carried" | "dropped";
  /** What its payments cover. */
  coveredMinor: number;
}

/** The rows Today's one read gives for goals. */
export interface GoalRows {
  goals: {
    id: string;
    name: string;
    currency: string;
    targetMinor: number;
    byOn: string;
    startMinor: number;
    stopped: boolean;
  }[];
  shares: GoalShareLine[];
}

/** One goal as D1 gives it (`stopped` 0 or 1). */
type GoalRow = Omit<GoalRows["goals"][number], "stopped"> & { stopped: Bit };

/** A goal with what is moved toward it and its shares, newest cycle first, for the phone. */
export type GoalLine = GoalRows["goals"][number] & {
  movedMinor: number;
  shareCount: number;
  shares: GoalShareLine[];
};

/** Goal lines from Today's rows: moved = what its shares' payments cover, all cycles. */
export function goalLinesOf(goals: GoalRows["goals"], shares: GoalShareLine[]): GoalLine[] {
  return goals.map((g) => {
    const mine = shares
      .filter((s) => s.goalId === g.id)
      .map((s) => ({ ...s, coveredMinor: Number(s.coveredMinor) }));
    return {
      ...g,
      movedMinor: mine.reduce((n, s) => n + s.coveredMinor, 0),
      shareCount: mine.length,
      shares: mine,
    };
  });
}

/** The most goals one account keeps. */
export const GOALS_MAX = 20;

const name = z.string().transform((n) => n.trim());

const newGoal = z.object({
  id: z.uuid(),
  name,
  /** Either of the user's currencies (spec 8); none: the spending currency. Fixed once made. */
  currency: z.string().optional(),
  targetMinor: z.number().int(),
  byOn: z.string(),
  /** "Already saved for it" (part of today's savings in that currency); none: 0. */
  startMinor: z.number().int().default(0),
  /** The first share, set aside at once and due today; none or 0: it starts on the next salary day. */
  share: z.object({ id: z.uuid(), plannedMinor: z.number().int() }).optional(),
});

const changeGoal = z
  .object({
    name,
    targetMinor: z.number().int(),
    byOn: z.string(),
    startMinor: z.number().int(),
    /** Stop this goal, or start it again. */
    stopped: z.boolean(),
  })
  .partial();

/**
 * One of the user's goals with what is saved toward it (SAB-69), as one statement for
 * `readForWrite` (SAB-73: Drizzle reads one after another took goal delete to 16 ms
 * live): already saved, what its shares' payments cover (spec 5: saved toward it, less
 * already saved) and what take-outs from it took, all cycles. `?2` is the goal id.
 */
export const GOAL_SAVED = `select g.currency, g.start_minor as startMinor,
    (select coalesce(sum(case when p.currency = k.currency then p.amount_minor
        else coalesce(p.covers_minor, 0) end), 0)
      from commitment_payment p join commitment k on k.id = p.commitment_id
      where p.user_id = ?1 and k.user_id = ?1 and k.goal_id = g.id) as movedMinor,
    (select coalesce(sum(-m.amount_minor), 0) from savings_movement m
      where m.user_id = ?1 and m.goal_id = g.id and m.kind = 'take_out') as takenOutMinor,
    (select coalesce(sum(-m.amount_minor), 0) from savings_movement m
      where m.user_id = ?1 and m.goal_id = g.id and m.kind = 'goal_spend') as spentMinor
  from savings_goal g where g.user_id = ?1 and g.id = ?2`;

/** A `GOAL_SAVED` row; `spentMinor` is what goal spends from it spent (SAB-75). */
export interface GoalSavedRow {
  currency: string;
  startMinor: number;
  movedMinor: number;
  takenOutMinor: number;
  spentMinor: number;
}

/** The goal `GOAL_SAVED` read, sums as numbers; undefined when it is not the user's. */
export function goalSavedOf(rows: GoalSavedRow[]): GoalSavedRow | undefined {
  const g = rows[0];
  return (
    g && {
      ...g,
      movedMinor: Number(g.movedMinor),
      takenOutMinor: Number(g.takenOutMinor),
      spentMinor: Number(g.spentMinor),
    }
  );
}

/**
 * Savings goals (ticket SAB-68, spec 5): add (with its first share set aside at
 * once, due today, unless 0), change, stop or start again, and delete while
 * nothing was moved toward it. A goal belongs to no cycle, so these never take
 * Undo salary day away (it is not in `UNDO_TABLES`); its shares are commitments
 * of kind savings with `goal_id`, made here (the first) and by salary day (the rest).
 * Saved toward it, the fair share and its status are worked out on the phone.
 */
export const savingsGoals = new Hono<SignedIn>()
  .post("/savings-goals", json(newGoal), async (c) => {
    const { db, userId } = c.var;
    const { share, ...b } = c.req.valid("json");
    const { now, count, ...r } = await readForWrite<SavingsReadRows & { count: { n: number }[] }>(c, {
      ...SAVINGS_READS,
      count: [GOAL_COUNT],
    });
    if (!now) return c.json({ error: "not_set_up" as const }, 404);
    const row = { ...b, currency: b.currency ?? now.settings.spendingCurrency };
    const savingsMinor = savingsTotal(savingsLinesFrom(r, now.settings.spendingCurrency), row.currency);
    const problems: string[] = checkSavingsGoal(row, { ...now.currencies, today: now.today, savingsMinor });
    const firstShare = share && share.plannedMinor !== 0 ? share : null;
    if (
      firstShare &&
      (!Number.isSafeInteger(firstShare.plannedMinor) ||
        firstShare.plannedMinor < 0 ||
        firstShare.plannedMinor > goalLeftMinor({ ...row, movedMinor: 0 }))
    ) {
      problems.push("share");
    }
    if (problems.length) return c.json({ error: "invalid" as const, problems }, 400);
    if (Number(count[0]?.n ?? 0) >= GOALS_MAX) return c.json({ error: "too_many" as const }, 409);
    const add = db.insert(savingsGoal).values({ ...row, userId });
    try {
      if (firstShare) {
        await db.batch([
          add,
          db.insert(commitment).values({
            id: firstShare.id,
            userId,
            cycleId: now.cycle.id,
            name: row.name,
            kind: "savings",
            currency: row.currency,
            plannedMinor: firstShare.plannedMinor,
            dueOn: now.today,
            goalId: b.id,
          }),
        ]);
      } else await add;
    } catch {
      // An id is already in use.
      return c.json({ error: "conflict" as const }, 409);
    }
    return c.json({ ok: true as const }, 201);
  })
  .patch("/savings-goals/:id", json(changeGoal), async (c) => {
    const { db, mine } = c.var;
    const b = c.req.valid("json");
    const id = c.req.param("id");
    const { now, found, saved, ...r } = await readForWrite<
      SavingsReadRows & { found: GoalRow[]; saved: GoalSavedRow[] }
    >(c, {
      ...SAVINGS_READS,
      found: [GOAL, id],
      saved: [GOAL_SAVED, id],
    });
    const where = and(mine(savingsGoal), eq(savingsGoal.id, id));
    const row = found[0];
    if (!now || !row) return c.json({ error: "not_found" as const }, 404);
    const old = { ...row, stopped: Number(row.stopped) === 1 };
    const next = { ...old, ...b };
    const savingsMinor = savingsTotal(savingsLinesFrom(r, now.settings.spendingCurrency), old.currency);
    const problems = checkSavingsGoal(next, {
      ...now.currencies,
      today: now.today,
      // Already saved was part of the savings then; it may stay as it was.
      savingsMinor: Math.max(savingsMinor, old.startMinor),
      keepByOn: old.byOn,
    });
    // Already saved can't go below what take-outs from it took and spends from it spent, less its
    // moves (SAB-69, SAB-75): left in it never goes below zero.
    const goal = goalSavedOf(saved);
    if (b.startMinor !== undefined && !problems.includes("start") && goal) {
      if (goalSavedMinor({ ...goal, startMinor: next.startMinor }) - goal.spentMinor < 0)
        problems.push("start");
    }
    if (problems.length) return c.json({ error: "invalid" as const, problems }, 400);
    await db
      .update(savingsGoal)
      .set({
        name: next.name,
        targetMinor: next.targetMinor,
        byOn: next.byOn,
        startMinor: next.startMinor,
        stopped: next.stopped,
      })
      .where(where);
    return c.json({ ok: true as const });
  })
  .delete("/savings-goals/:id", async (c) => {
    const { db, mine } = c.var;
    const id = c.req.param("id");
    // One D1 batch for every read, then the delete batch (SAB-73).
    const { now, saved } = await readForWrite<{ saved: GoalSavedRow[] }>(c, { saved: [GOAL_SAVED, id] });
    const where = and(mine(savingsGoal), eq(savingsGoal.id, id));
    const goal = goalSavedOf(saved);
    if (!now || !goal) return c.json({ error: "not_found" as const }, 404);
    // Nothing moved toward it, and no take-out or goal spend from it (SAB-69, SAB-75: it would lose its goal).
    if (goal.movedMinor > 0 || goal.takenOutMinor > 0 || goal.spentMinor > 0) {
      return c.json({ error: "moved" as const }, 409);
    }
    await db.batch([
      // This cycle's shares go with it; an ended cycle's rows stay as they are (locked).
      db
        .delete(commitment)
        .where(and(mine(commitment), eq(commitment.goalId, id), eq(commitment.cycleId, now.cycle.id))),
      db.delete(savingsGoal).where(where),
    ]);
    return c.json({ ok: true as const });
  });
