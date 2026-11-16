import { type Day, isDay } from "./days";

/**
 * The unsent queue (spec 11): spends and commitment payments made on the phone, sent when the connection is
 * back, oldest first. Ids are made on the phone, so a resent item is saved once.
 */

/**
 * A spend sent after its cycle ended (salary day entered on another device) moves into the current cycle, on
 * its first day; `movedFrom` is the day it had, for the note to the user. Anything else is left as it is for
 * the spend check.
 */
export function moveIntoCycle(
  spentOn: string,
  cycleStartedOn: Day,
): { spentOn: string; movedFrom: Day | null } {
  if (isDay(spentOn) && spentOn < cycleStartedOn) return { spentOn: cycleStartedOn, movedFrom: spentOn };
  return { spentOn, movedFrom: null };
}

/**
 * What the phone does with one unsent item after sending it: `saved` (also a resend saved before) leaves the
 * queue; `retry` keeps it for later (no answer, a server fault); `sign_in` keeps the whole queue until the
 * user signs in again; `look` moves it to the needs-a-look list (it no longer fits: its cycle ended, its
 * commitment was removed or finished, or the rules refuse it).
 */
export type UnsentOutcome = "saved" | "retry" | "sign_in" | "look";

/** `status` null: no answer at all. */
export function unsentOutcome(status: number | null): UnsentOutcome {
  if (status === null || status >= 500 || status === 429) return "retry";
  if (status >= 200 && status < 300) return "saved";
  if (status === 401 || status === 403) return "sign_in";
  return "look";
}
