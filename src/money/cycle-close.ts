import type { Minor } from "./amount";
import { type CommitmentEntry, inThisCycle, stillToPayMinor } from "./commitment";
import { type CycleEntries, freeMoney } from "./cycle";
import { addDays, type Day } from "./days";
import { potView } from "./pot";

/** Step 3's answer for one unpaid commitment (spec 3): Paid it · Carry to the new cycle · Drop. */
export type UnpaidChoice = "paid" | "carry" | "drop";

/** Step 2's answer when there is an overspend (spec 6). */
export type OverspendChoice = "take" | "ignore";

/**
 * Step 3's list (spec 3, 6): open commitments of the cycle that ends, due by
 * its expected salary day (late ones too). Ones due after it moved with step 4.
 */
export function unpaidAtEnd<C extends CommitmentEntry>(list: C[], expectedSalaryOn: Day): C[] {
  return list.filter((c) => c.state === "open" && inThisCycle(c.dueOn, expectedSalaryOn));
}

/** The ending cycle's entries; its commitments have ids (the step 3 choices name them). */
export type ClosingEntries = CycleEntries & { commitments?: (CommitmentEntry & { id: string })[] };

/** The leftover of the cycle that ends, in the spending currency (spec 6). */
export interface Leftover {
  /** Free money left (below zero when spent past it). */
  freeMinor: Minor;
  /** What is left in the pots in use. */
  potsMinor: Minor;
  /** Still to pay on the commitments dropped. */
  droppedMinor: Minor;
  /** Still to pay on the commitments carried: their set-aside money goes with them, it is not leftover. */
  carriedMinor: Minor;
  /**
   * Step 2's amount: free money left + unused pot money; below zero is an
   * overspend. Step 2 (correct, split) comes before step 3, so dropped money is
   * not in it: it goes to the new cycle's free money.
   */
  stepTwoMinor: Minor;
  /** Free money left + unused pot money + dropped. */
  leftoverMinor: Minor;
}

/**
 * Leftover (spec 6) = unspent free money + unused pot money + money of dropped
 * commitments. Paid it changes nothing: the money set aside for it was spent on it.
 */
export function leftoverOf(
  entries: ClosingEntries,
  choices: { id: string; choice: UnpaidChoice }[],
): Leftover {
  const cur = entries.spendingCurrency;
  const freeMinor = freeMoney(entries);
  let potsMinor = 0;
  for (const p of entries.pots ?? []) {
    if (p.currency === cur && !p.archived) potsMinor += potView(p, entries.spends).leftMinor;
  }
  const byId = new Map(choices.map((c) => [c.id, c.choice]));
  let droppedMinor = 0;
  let carriedMinor = 0;
  for (const c of entries.commitments ?? []) {
    if (c.currency !== cur || c.state !== "open" || !inThisCycle(c.dueOn, entries.expectedSalaryOn)) continue;
    const choice = byId.get(c.id);
    if (choice === "drop") droppedMinor += stillToPayMinor(c);
    if (choice === "carry") carriedMinor += stillToPayMinor(c);
  }
  return {
    freeMinor,
    potsMinor,
    droppedMinor,
    carriedMinor,
    stepTwoMinor: freeMinor + potsMinor,
    leftoverMinor: freeMinor + potsMinor + droppedMinor,
  };
}

/**
 * The day a Paid it payment is dated: the commitment's due day, kept inside the
 * cycle that ends (its first day up to the day before the salary).
 */
export function paidItOn(dueOn: Day, cycleStartedOn: Day, receivedOn: Day): Day {
  const lastDay = receivedOn > cycleStartedOn ? addDays(receivedOn, -1) : cycleStartedOn;
  if (dueOn < cycleStartedOn) return cycleStartedOn;
  return dueOn > lastDay ? lastDay : dueOn;
}

/** Salary day's steps 2 and 3 (spec 6). */
export interface CloseInput {
  /** One choice for each unpaid commitment. */
  unpaid: { id: string; choice: UnpaidChoice }[];
  /** "Actually have in hand", when it differs from step 2's amount; null keeps that amount. */
  inHandMinor: number | null;
  /** Part of step 2's amount (or what is in hand) sent to savings; the rest goes to the new cycle. */
  toSavingsMinor: number;
  /** Only when there is an overspend. */
  overspend: OverspendChoice | null;
}

/** "unpaid", "in_hand", "to_savings", "overspend". */
export type CloseProblem = "unpaid" | "in_hand" | "to_savings" | "overspend";

const minor = (n: number) => Number.isSafeInteger(n) && n >= 0;

/** Checks steps 2 and 3 (spec 6). The phone shows the problems; the server refuses them. */
export function checkCycleClose(
  input: CloseInput,
  ctx: { unpaidIds: string[]; leftover: Leftover },
): CloseProblem[] {
  const out: CloseProblem[] = [];
  const ids = input.unpaid.map((u) => u.id);
  const want = new Set(ctx.unpaidIds);
  if (new Set(ids).size !== ids.length || ids.length !== want.size || ids.some((id) => !want.has(id))) {
    out.push("unpaid");
  }
  if (ctx.leftover.stepTwoMinor >= 0) {
    const inHand = input.inHandMinor ?? ctx.leftover.stepTwoMinor;
    const inHandOk = input.inHandMinor === null || minor(input.inHandMinor);
    if (!inHandOk) out.push("in_hand");
    if (!minor(input.toSavingsMinor) || (inHandOk && input.toSavingsMinor > inHand)) out.push("to_savings");
    if (input.overspend !== null) out.push("overspend");
  } else {
    if (input.inHandMinor !== null) out.push("in_hand");
    if (input.toSavingsMinor !== 0) out.push("to_savings");
    if (input.overspend === null) out.push("overspend");
  }
  return out;
}

/**
 * What the cycle that ends brings into the new one (spec 6), stored as the new
 * cycle's `leftover` income: step 2's amount (or what is actually in hand),
 * split into savings and free money, plus dropped ones' money and carried ones'
 * set-aside money. An overspend taken lowers the new free money; ignored, it is gone.
 */
export function broughtIn(
  input: CloseInput,
  leftover: Leftover,
): { amountMinor: Minor; toSavingsMinor: Minor; correctionMinor: Minor } {
  const base = leftover.stepTwoMinor;
  const after = leftover.droppedMinor + leftover.carriedMinor;
  if (base < 0) {
    const taken = input.overspend === "take" ? base : 0;
    return { amountMinor: taken + after, toSavingsMinor: 0, correctionMinor: 0 };
  }
  const kept = input.inHandMinor ?? base;
  return { amountMinor: kept + after, toSavingsMinor: input.toSavingsMinor, correctionMinor: kept - base };
}
