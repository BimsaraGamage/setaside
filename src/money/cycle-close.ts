import type { Minor } from "./amount";
import { type CommitmentEntry, inThisCycle, stillToPayMinor } from "./commitment";
import { type CycleEntries, freeIn, freeMoney, otherCurrency } from "./cycle";
import { addDays, type Day } from "./days";
import { potView } from "./pot";
import { atRate, minorAtLeast } from "./rate";

/** Step 2's answer for one unpaid commitment (spec 3): Paid it · Carry to the new cycle · Drop. */
export type UnpaidChoice = "paid" | "carry" | "drop";

/** Step 3's answer when there is an overspend (spec 6). */
export type OverspendChoice = "take" | "ignore";

/**
 * Step 2's list (spec 3, 6): open commitments of the cycle that ends, due by
 * its expected salary day (late ones too). Ones due after it moved with step 4.
 */
export function unpaidAtEnd<C extends CommitmentEntry>(list: C[], expectedSalaryOn: Day): C[] {
  return list.filter((c) => c.state === "open" && inThisCycle(c.dueOn, expectedSalaryOn));
}

/** The ending cycle's entries; its commitments have ids (the step 2 choices name them). */
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
   * Two currencies (spec 8): rupees short covered from the leftover dollars at
   * the reserve rate (bills first); 0 otherwise.
   */
  fromSalaryMinor: Minor;
  /**
   * Free money left + unused pot money + dropped (+ rupees short covered from
   * the dollars); below zero is an overspend.
   * Unpaid commitments (step 2) are answered first, so dropped money is in it
   * when the leftover is corrected and split (step 3).
   */
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
  const other = otherCurrency(entries);
  // The spending currency's own money: free dollars are the salary currency's leftover.
  const freeMinor = other ? freeIn(entries, cur) : freeMoney(entries);
  const own = heldIn(entries, choices, cur);
  const base = freeMinor + own.potsMinor + own.droppedMinor;
  const fromSalaryMinor = other ? coverFromSalary(entries, choices, base).rupees : 0;
  return {
    freeMinor,
    potsMinor: own.potsMinor,
    droppedMinor: own.droppedMinor,
    carriedMinor: own.carriedMinor,
    fromSalaryMinor,
    leftoverMinor: base + fromSalaryMinor,
  };
}

/** One currency's unused pot money, and still to pay on its dropped and carried commitments. */
function heldIn(entries: ClosingEntries, choices: { id: string; choice: UnpaidChoice }[], cur: string) {
  let potsMinor = 0;
  for (const p of entries.pots ?? []) {
    if (p.currency === cur && !p.archived) potsMinor += potView(p, entries.spends).leftMinor;
  }
  const byId = new Map(choices.map((c) => [c.id, c.choice]));
  let droppedMinor = 0;
  let carriedMinor = 0;
  for (const c of entries.commitments ?? []) {
    if (c.currency !== cur || c.state !== "open" || !inThisCycle(c.dueOn, entries.expectedSalaryOn)) continue;
    // A card bill's money is held for the card, not set aside: it is neither leftover nor carried (spec 6, 9).
    if (c.kind === "card_bill") continue;
    const choice = byId.get(c.id);
    if (choice === "drop") droppedMinor += stillToPayMinor(c);
    if (choice === "carry") carriedMinor += stillToPayMinor(c);
  }
  return { potsMinor, droppedMinor, carriedMinor };
}

/** The salary currency's own leftover: free dollars + unused dollar pots + dropped dollar commitments. */
function rawSalaryLeftover(
  entries: ClosingEntries,
  choices: { id: string; choice: UnpaidChoice }[],
  cur: string,
): Minor {
  const held = heldIn(entries, choices, cur);
  // Dropped money joins the leftover; carried money goes with the commitment.
  return freeIn(entries, cur) + held.potsMinor + held.droppedMinor;
}

/**
 * Two currencies: still to pay on the salary currency's carried commitments.
 * Their set-aside money goes to the new cycle with them; it is not leftover.
 */
export function salaryCarriedOf(
  entries: ClosingEntries,
  choices: { id: string; choice: UnpaidChoice }[],
): Minor {
  const other = otherCurrency(entries);
  return other ? heldIn(entries, choices, other).carriedMinor : 0;
}

/**
 * Bills first at cycle end (spec 6, 8): rupees short (`rupeeLeftover` below
 * zero) are covered from the leftover dollars at the reserve rate, as far as
 * they go. The rupees covered and the dollars they take.
 */
function coverFromSalary(
  entries: ClosingEntries,
  choices: { id: string; choice: UnpaidChoice }[],
  rupeeLeftover: Minor,
): { rupees: Minor; dollars: Minor } {
  const other = otherCurrency(entries);
  const rate = entries.reserveRate ?? entries.countingRate;
  if (!other || !rate || rupeeLeftover >= 0) return { rupees: 0, dollars: 0 };
  const dollars = rawSalaryLeftover(entries, choices, other);
  if (dollars <= 0) return { rupees: 0, dollars: 0 };
  const cur = entries.spendingCurrency;
  const need = minorAtLeast(-rupeeLeftover, rate, other, cur);
  if (dollars >= need) return { rupees: -rupeeLeftover, dollars: need };
  return { rupees: atRate(dollars, rate, other, cur), dollars };
}

/**
 * Two currencies (spec 6, 8): the leftover held in the salary currency (free
 * dollars + unused dollar pots + dropped dollar commitments), less the dollars
 * that cover rupees short; null with one
 * currency. Split into dollar savings and the new cycle on salary day (item 16).
 * Below zero (dollar set-asides past the dollars) it is carried whole, so
 * nothing is lost or counted twice.
 */
export function salaryLeftoverOf(
  entries: ClosingEntries,
  choices: { id: string; choice: UnpaidChoice }[],
): Minor | null {
  const other = otherCurrency(entries);
  if (!other) return null;
  const cur = entries.spendingCurrency;
  const own = heldIn(entries, choices, cur);
  const rupees = freeIn(entries, cur) + own.potsMinor + own.droppedMinor;
  return rawSalaryLeftover(entries, choices, other) - coverFromSalary(entries, choices, rupees).dollars;
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
  /** "Actually have in hand", when it differs from the leftover; null keeps the leftover. */
  inHandMinor: number | null;
  /** Part of the leftover (or what is in hand) sent to savings; the rest goes to the new cycle. */
  toSavingsMinor: number;
  /** Only when there is an overspend. */
  overspend: OverspendChoice | null;
  /** Two currencies (item 16): dollars actually in hand, when they differ; null keeps the dollar leftover. */
  salaryInHandMinor?: number | null;
  /** Two currencies: dollars sent to dollar savings; the rest carries over unconverted. */
  salaryToSavingsMinor?: number;
}

/** "unpaid", "in_hand", "to_savings", "overspend", "salary_in_hand", "salary_to_savings". */
export type CloseProblem =
  | "unpaid"
  | "in_hand"
  | "to_savings"
  | "overspend"
  | "salary_in_hand"
  | "salary_to_savings";

const minor = (n: number) => Number.isSafeInteger(n) && n >= 0;

/** Checks steps 2 and 3 (spec 6). The phone shows the problems; the server refuses them. */
export function checkCycleClose(
  input: CloseInput,
  ctx: { unpaidIds: string[]; leftover: Leftover; salaryLeftoverMinor?: Minor | null },
): CloseProblem[] {
  const out: CloseProblem[] = [];
  const ids = input.unpaid.map((u) => u.id);
  const want = new Set(ctx.unpaidIds);
  if (new Set(ids).size !== ids.length || ids.length !== want.size || ids.some((id) => !want.has(id))) {
    out.push("unpaid");
  }
  if (ctx.leftover.leftoverMinor >= 0) {
    const inHand = input.inHandMinor ?? ctx.leftover.leftoverMinor;
    const inHandOk = input.inHandMinor === null || minor(input.inHandMinor);
    if (!inHandOk) out.push("in_hand");
    if (!minor(input.toSavingsMinor) || (inHandOk && input.toSavingsMinor > inHand)) out.push("to_savings");
    if (input.overspend !== null) out.push("overspend");
  } else {
    if (input.inHandMinor !== null) out.push("in_hand");
    if (input.toSavingsMinor !== 0) out.push("to_savings");
    if (input.overspend === null) out.push("overspend");
  }
  const dollarInHand = input.salaryInHandMinor ?? null;
  const dollarSaved = input.salaryToSavingsMinor ?? 0;
  const dollars = ctx.salaryLeftoverMinor ?? null;
  if (dollars === null || dollars < 0) {
    // One currency, or dollars below zero: carried whole, nothing to correct or save.
    if (dollarInHand !== null) out.push("salary_in_hand");
    if (dollarSaved !== 0) out.push("salary_to_savings");
  } else {
    const inHandOk = dollarInHand === null || minor(dollarInHand);
    if (!inHandOk) out.push("salary_in_hand");
    if (!minor(dollarSaved) || (inHandOk && dollarSaved > (dollarInHand ?? dollars))) {
      out.push("salary_to_savings");
    }
  }
  return out;
}

/**
 * What the cycle that ends brings into the new one in the salary currency
 * (spec 6, 8), stored as the new cycle's second `leftover` income: the dollar
 * leftover (or what is in hand), split into dollar savings and unconverted
 * dollars, plus the carried dollar commitments' money. Below zero it is
 * carried whole.
 */
export function broughtInSalary(
  input: CloseInput,
  salaryLeftover: Minor,
  carriedMinor = 0,
): { amountMinor: Minor; toSavingsMinor: Minor; correctionMinor: Minor } {
  if (salaryLeftover < 0) {
    return { amountMinor: salaryLeftover + carriedMinor, toSavingsMinor: 0, correctionMinor: 0 };
  }
  const kept = input.salaryInHandMinor ?? salaryLeftover;
  return {
    amountMinor: kept + carriedMinor,
    toSavingsMinor: input.salaryToSavingsMinor ?? 0,
    correctionMinor: kept - salaryLeftover,
  };
}

/**
 * What the cycle that ends brings into the new one (spec 6), stored as the new
 * cycle's `leftover` income: the leftover (or what is actually in hand), split
 * into savings and free money, plus the carried ones' set-aside money. An
 * overspend taken lowers the new free money; ignored, it is gone.
 */
export function broughtIn(
  input: CloseInput,
  leftover: Leftover,
): { amountMinor: Minor; toSavingsMinor: Minor; correctionMinor: Minor } {
  const l = leftover.leftoverMinor;
  if (l < 0) {
    const taken = input.overspend === "take" ? l : 0;
    return { amountMinor: taken + leftover.carriedMinor, toSavingsMinor: 0, correctionMinor: 0 };
  }
  const kept = input.inHandMinor ?? l;
  return {
    amountMinor: kept + leftover.carriedMinor,
    toSavingsMinor: input.toSavingsMinor,
    correctionMinor: kept - l,
  };
}
