import { and, eq, sql } from "drizzle-orm";
import { Hono } from "hono";
import * as z from "zod";
import { checkSavingsGoal, goalLeftMinor, goalSavedMinor, savingsTotal } from "../money";
import { current } from "./current";
import { commitment, commitmentPayment, savingsGoal, savingsMovement } from "./db/schema";
import { json } from "./json";
import { savingsLines } from "./savings";
import type { SignedIn } from "./user-check";

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

/** What payments on a goal's shares cover, all cycles (spec 5: saved toward it, less already saved). */
async function movedToward(c: { var: SignedIn["Variables"] }, goalId: string): Promise<number> {
  const { db, mine } = c.var;
  const [row] = await db
    .select({
      moved: sql<number>`coalesce(sum(case when ${commitmentPayment.currency} = ${commitment.currency}
        then ${commitmentPayment.amountMinor} else coalesce(${commitmentPayment.coversMinor}, 0) end), 0)`,
    })
    .from(commitmentPayment)
    .innerJoin(commitment, eq(commitment.id, commitmentPayment.commitmentId))
    .where(and(mine(commitmentPayment), mine(commitment), eq(commitment.goalId, goalId)));
  return Number(row?.moved ?? 0);
}

/**
 * One of the user's goals with what is saved toward it, for a take-out from it (SAB-69):
 * already saved, what its shares' payments cover and what take-outs from it took, all cycles.
 */
export async function goalSaved(c: { var: SignedIn["Variables"] }, goalId: string) {
  const { db, mine } = c.var;
  const goal = await db.query.savingsGoal.findFirst({
    where: and(mine(savingsGoal), eq(savingsGoal.id, goalId)),
    columns: { currency: true, startMinor: true },
  });
  if (!goal) return undefined;
  const [out] = await db
    .select({ sum: sql<number>`coalesce(sum(-${savingsMovement.amountMinor}), 0)` })
    .from(savingsMovement)
    .where(and(mine(savingsMovement), eq(savingsMovement.goalId, goalId)));
  return {
    ...goal,
    movedMinor: await movedToward(c, goalId),
    takenOutMinor: Number(out?.sum ?? 0),
  };
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
    const { db, mine, userId } = c.var;
    const { share, ...b } = c.req.valid("json");
    const now = await current(c);
    if (!now) return c.json({ error: "not_set_up" as const }, 404);
    const row = { ...b, currency: b.currency ?? now.settings.spendingCurrency };
    const savingsMinor = savingsTotal(await savingsLines(c), row.currency);
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
    const others = await db.query.savingsGoal.findMany({ where: mine(savingsGoal), columns: { id: true } });
    if (others.length >= GOALS_MAX) return c.json({ error: "too_many" as const }, 409);
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
    const now = await current(c);
    const where = and(mine(savingsGoal), eq(savingsGoal.id, id));
    const old = await db.query.savingsGoal.findFirst({ where });
    if (!now || !old) return c.json({ error: "not_found" as const }, 404);
    const next = { ...old, ...b };
    const savingsMinor = savingsTotal(await savingsLines(c), old.currency);
    const problems = checkSavingsGoal(next, {
      ...now.currencies,
      today: now.today,
      // Already saved was part of the savings then; it may stay as it was.
      savingsMinor: Math.max(savingsMinor, old.startMinor),
      keepByOn: old.byOn,
    });
    // Already saved can't go below what take-outs from it took less its moves (SAB-69).
    if (b.startMinor !== undefined && !problems.includes("start")) {
      const saved = await goalSaved(c, id);
      if (saved && goalSavedMinor({ ...saved, startMinor: next.startMinor }) < 0) problems.push("start");
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
    const now = await current(c);
    const where = and(mine(savingsGoal), eq(savingsGoal.id, id));
    const found = await db.query.savingsGoal.findFirst({ where, columns: { id: true } });
    if (!now || !found) return c.json({ error: "not_found" as const }, 404);
    // Nothing moved toward it, and no take-out from it (SAB-69: it would lose its goal).
    const saved = await goalSaved(c, id);
    if (!saved || saved.movedMinor > 0 || saved.takenOutMinor > 0) {
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
