import { type Currencies, isUsersCurrency, type Minor, unitMinor } from "./amount";
import { NAME_MAX } from "./commitment";
import { type Day, isDay, suggestSalaryDay } from "./days";
import type { SalaryDayDraft } from "./salary-day";

/**
 * A savings goal (spec 5, SAB-67): something to save up for by a day ("Trip to
 * Japan, Rs 600,000 by 1 Jun 2027"). Each cycle it makes one **goal share**: a
 * Savings commitment linked to it, moved into savings like any set-aside. Goals
 * belong to no cycle (like places): changing one never touches Undo salary day.
 */
export interface SavingsGoalEntry {
  id: string;
  name: string;
  /** One of the user's two, fixed once made. */
  currency: string;
  targetMinor: Minor;
  byOn: Day;
  /** "Already saved for it": a part of the savings total when it was made; takes no money. */
  startMinor: Minor;
  /** Stop this goal: no more shares. */
  stopped: boolean;
  /** What payments on its shares cover, all cycles. */
  movedMinor: Minor;
  /** What take-outs from it took (SAB-69), all cycles; none: 0. */
  takenOutMinor?: Minor;
  /** What goal spends from it spent (SAB-75), all cycles; none: 0. Still counts as saved toward it. */
  spentMinor?: Minor;
  /** How many shares it has had, all cycles (none yet: it starts on the next salary day). */
  shareCount: number;
}

export interface SavingsGoalInput {
  name: string;
  currency: string;
  targetMinor: number;
  byOn: string;
  startMinor: number;
}

export type SavingsGoalProblem = "name" | "currency" | "target" | "by_on" | "start";

const whole = (n: number) => Number.isSafeInteger(n) && n > 0;

/**
 * Checks a new or changed goal (spec 5): a name, one of the user's currencies, a
 * target above zero, a by date after today (a changed goal may keep its own), and
 * already saved from zero up to the savings total in that currency and the target.
 */
export function checkSavingsGoal(
  input: SavingsGoalInput,
  ctx: Currencies & { today: Day; savingsMinor: Minor; keepByOn?: Day },
): SavingsGoalProblem[] {
  const out: SavingsGoalProblem[] = [];
  const name = input.name.trim();
  if (!name || name.length > NAME_MAX) out.push("name");
  if (!isUsersCurrency(input.currency, ctx)) out.push("currency");
  const targetOk = whole(input.targetMinor);
  if (!targetOk) out.push("target");
  if (!isDay(input.byOn) || (input.byOn <= ctx.today && input.byOn !== ctx.keepByOn)) out.push("by_on");
  const s = input.startMinor;
  if (!Number.isSafeInteger(s) || s < 0 || s > ctx.savingsMinor || (targetOk && s > input.targetMinor)) {
    out.push("start");
  }
  return out;
}

type Saved = Pick<SavingsGoalEntry, "startMinor" | "movedMinor" | "takenOutMinor">;
type Spent = Saved & Pick<SavingsGoalEntry, "spentMinor">;

/**
 * Saved toward a goal (spec 5): already saved + what its shares' moves cover −
 * what take-outs from it took (SAB-69). Goal spends (SAB-75) leave it as it is:
 * spending on the goal is the goal doing its job, so progress, Reached and the
 * fair share never ask to save it again.
 */
export function goalSavedMinor(g: Saved): Minor {
  return g.startMinor + g.movedMinor - (g.takenOutMinor ?? 0);
}

/** What is still to save for a goal; never below zero. */
export function goalLeftMinor(g: Saved & Pick<SavingsGoalEntry, "targetMinor">): Minor {
  return Math.max(0, g.targetMinor - goalSavedMinor(g));
}

/**
 * **Left** in a goal (spec 5, SAB-75): saved toward it − what goal spends from it
 * spent; what can still be spent from it or taken out of it. Never below zero.
 */
export function goalUnspentMinor(g: Spent): Minor {
  return Math.max(0, goalSavedMinor(g) - (g.spentMinor ?? 0));
}

export type GoalTakeOutProblem = "goal" | "goal_too_much";

/**
 * Checks Take out of savings "from a goal" (spec 5, SAB-67 pick 9): a goal in the
 * take-out's currency, and at most what is left in it (saved toward it less goal
 * spends, SAB-75). The savings total check (`checkSavingsMove`) still applies.
 */
export function checkGoalTakeOut(
  input: { currency: string; amountMinor: number },
  g: Spent & Pick<SavingsGoalEntry, "currency">,
): GoalTakeOutProblem[] {
  if (input.currency !== g.currency) return ["goal"];
  return input.amountMinor > goalUnspentMinor(g) ? ["goal_too_much"] : [];
}

/** The longest note on a goal spend ("Flights"). */
export const GOAL_SPEND_NOTE_MAX = 80;

export type GoalSpendProblem = "goal" | "amount" | "note" | "goal_too_much" | "too_much";

/**
 * Checks Spend from this goal (spec 5, SAB-75): the goal's currency, an amount
 * above zero, a note, at most what is left in the goal and at most the savings
 * total in that currency (`totalMinor`). Past that it is a normal spend.
 */
export function checkGoalSpend(
  input: { currency: string; amountMinor: number; note: string },
  g: Spent & Pick<SavingsGoalEntry, "currency">,
  totalMinor: Minor,
): GoalSpendProblem[] {
  const out: GoalSpendProblem[] = [];
  if (input.currency !== g.currency) out.push("goal");
  const amountOk = Number.isSafeInteger(input.amountMinor) && input.amountMinor > 0;
  if (!amountOk) out.push("amount");
  const note = input.note.trim();
  if (!note || note.length > GOAL_SPEND_NOTE_MAX) out.push("note");
  if (amountOk && input.amountMinor > goalUnspentMinor(g)) out.push("goal_too_much");
  if (amountOk && input.amountMinor > totalMinor) out.push("too_much");
  return out;
}

/**
 * The cycle a share is counted for: its first day, the usual pay day and, when
 * known, its expected next salary day (salary day's step 6, or the current
 * cycle's), which an early salary or a moved day puts off the usual pay day.
 */
export type GoalCycleAt = { startedOn: Day; usualPayDay: number; nextSalaryOn?: Day };

/**
 * Shares left (spec 5): the cycle starting on `startedOn` plus each usual pay day
 * after it and before the by date (money is set aside on salary days; one landing
 * on the by date is too late). At least 1, so a passed date asks for all that is left.
 */
export function goalSharesLeft(a: GoalCycleAt & { byOn: Day }): number {
  let n = 1;
  // The cycle's own next salary day when known (SAB-87): an early salary's
  // start is before the pay day it covered, which is no further share.
  let day = a.nextSalaryOn ?? suggestSalaryDay(a.startedOn, a.usualPayDay);
  // 50 years of pay days at most.
  for (let i = 0; i < 600 && day < a.byOn; i++) {
    n++;
    day = suggestSalaryDay(day, a.usualPayDay);
  }
  return n;
}

/**
 * The fair share a cycle starting on `startedOn` sets aside (spec 5): (target −
 * saved toward it − `plannedMinor`, still to pay on its shares already in that
 * cycle) ÷ shares left, rounded up to a whole unit of the currency; the last
 * share only what is left. 0 once nothing is left.
 */
export function fairShareMinor(
  g: Saved & Pick<SavingsGoalEntry, "currency" | "targetMinor" | "byOn">,
  a: GoalCycleAt & { plannedMinor?: Minor },
): Minor {
  const left = goalLeftMinor(g) - (a.plannedMinor ?? 0);
  if (left <= 0) return 0;
  const n = goalSharesLeft({ ...a, byOn: g.byOn });
  const unit = unitMinor(g.currency);
  return Math.min(left, Math.ceil(left / n / unit) * unit);
}

/** A live goal makes shares: not stopped and not reached. */
export const goalLive = (g: SavingsGoalEntry) => !g.stopped && goalLeftMinor(g) > 0;

/**
 * Salary day's goal shares (spec 6 step 4): one Savings row per live goal, due
 * on the new cycle's first day, at its fair share; never Every cycle. `paid` is
 * what step 2 paid on its shares (by goal id), `planned` what the new cycle
 * already has for it (a share carried on).
 */
export function goalDrafts(
  list: SavingsGoalEntry[],
  at: GoalCycleAt,
  more: { planned?: Record<string, Minor>; paid?: Record<string, Minor> } = {},
): (SalaryDayDraft & { goalId: string })[] {
  return list.flatMap((g) => {
    if (g.stopped) return [];
    const plannedMinor = fairShareMinor(
      { ...g, movedMinor: g.movedMinor + (more.paid?.[g.id] ?? 0) },
      { ...at, plannedMinor: more.planned?.[g.id] ?? 0 },
    );
    if (plannedMinor <= 0) return [];
    return [
      {
        goalId: g.id,
        recurringId: null,
        carriedFromId: null,
        name: g.name,
        kind: "savings" as const,
        currency: g.currency,
        plannedMinor,
        dueOn: at.startedOn,
        everyCycle: false,
      },
    ];
  });
}

/** One of a goal's shares in the current cycle, as its status needs it. */
export interface GoalShareNow {
  plannedMinor: Minor;
  /** What its payments cover. */
  coveredMinor: Minor;
  /** Open: what is still to pay counts toward this cycle's share. */
  open: boolean;
}

/** A goal's one status line (spec 10, SAB-67 pick 10). */
export type GoalStatus =
  | { kind: "on_plan"; shareMinor: Minor; cyclesLeft: number }
  | { kind: "behind"; shortMinor: Minor }
  | { kind: "starts"; shareMinor: Minor }
  | { kind: "passed"; leftMinor: Minor }
  | { kind: "reached" }
  | { kind: "stopped" };

/**
 * A goal's status (spec 10): Reached; Stopped; By date passed with what is left;
 * no share yet (made with 0 this cycle): it starts on the next salary day with
 * that share; else this cycle's share (planned, or moved if more, finished ones
 * at what was moved) against the fair share counted from the cycle's start: at
 * it, "Rs X a cycle · N cycles left", below it Behind by the gap. No separate
 * on-track maths: the fair share is the plan. A take-out this cycle
 * (`takenOutNowMinor`) is not in that start, so it never makes this cycle Behind:
 * the next salary day's share grows instead (SAB-69).
 */
export function goalStatus(
  g: SavingsGoalEntry,
  sharesNow: GoalShareNow[],
  cycle: GoalCycleAt & { today: Day; takenOutNowMinor?: Minor },
): GoalStatus {
  const left = goalLeftMinor(g);
  if (left <= 0) return { kind: "reached" };
  if (g.stopped) return { kind: "stopped" };
  if (cycle.today > g.byOn) return { kind: "passed", leftMinor: left };
  if (g.shareCount === 0) {
    const next = cycle.nextSalaryOn ?? suggestSalaryDay(cycle.today, cycle.usualPayDay);
    return {
      kind: "starts",
      shareMinor: fairShareMinor(g, { startedOn: next, usualPayDay: cycle.usualPayDay }),
    };
  }
  let movedNow = 0;
  let shareNow = 0;
  for (const s of sharesNow) {
    movedNow += s.coveredMinor;
    shareNow += s.open ? Math.max(s.plannedMinor, s.coveredMinor) : s.coveredMinor;
  }
  const at = { startedOn: cycle.startedOn, usualPayDay: cycle.usualPayDay, nextSalaryOn: cycle.nextSalaryOn };
  const fair = fairShareMinor(
    {
      ...g,
      movedMinor: g.movedMinor - movedNow,
      takenOutMinor: (g.takenOutMinor ?? 0) - (cycle.takenOutNowMinor ?? 0),
    },
    at,
  );
  if (shareNow < fair) return { kind: "behind", shortMinor: fair - shareNow };
  return { kind: "on_plan", shareMinor: fair, cyclesLeft: goalSharesLeft({ byOn: g.byOn, ...at }) };
}
