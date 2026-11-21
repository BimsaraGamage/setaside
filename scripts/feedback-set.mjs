// Where a feedback is (ticket SAB-60, spec 14 "Feedback"): the checks `npm run feedback -- --set` makes before it
// writes anything, and the one SQL line it then runs. Kept apart so they are tested without a database.

/** The same list as `FEEDBACK_STATUSES` in `src/worker/db/schema.ts`. */
export const STATUSES = ["new", "seen", "planned", "building", "ready", "done", "not doing"];
export const REPLY_MAX = 280;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const TICKET = /^SAB-\d{1,4}$/;

/**
 * Checks one `--set`: a feedback id, a status from the list, a reply of one line and at most 280 characters, a
 * ticket code like `SAB-61`. Returns the problems, or none.
 */
export function checkSet({ id, status, reply, ticket }) {
  const problems = [];
  if (!UUID.test(String(id ?? ""))) problems.push("--set takes a feedback id (a UUID).");
  if (!STATUSES.includes(status)) problems.push(`--status is one of: ${STATUSES.join(", ")}.`);
  if (reply !== undefined) {
    if (reply.trim().length === 0) problems.push("--reply is empty.");
    if ([...reply].length > REPLY_MAX) problems.push(`--reply is at most ${REPLY_MAX} characters.`);
    if (/[\u0000-\u001f\u007f]/.test(reply)) problems.push("--reply is one line of plain text.");
  }
  if (ticket !== undefined && !TICKET.test(ticket)) problems.push("--ticket looks like SAB-61.");
  return problems;
}

/** Text as an SQL value that nothing in it can end: its UTF-8 bytes in hex. */
const sqlText = (t) => `cast(x'${Buffer.from(t, "utf8").toString("hex")}' as text)`;

/** The update for a checked `--set`. A reply or ticket left out stays as it is; a wait note goes (SAB-66). */
export function setSql({ id, status, reply, ticket }, now = Date.now()) {
  const parts = [`status = ${sqlText(status)}`, `updated_at = ${Math.trunc(now)}`, "waiting = null"];
  if (reply !== undefined) parts.push(`reply = ${sqlText(reply.trim())}`);
  if (ticket !== undefined) parts.push(`ticket = ${sqlText(ticket)}`);
  return `update feedback set ${parts.join(", ")} where id = '${id.toLowerCase()}'`;
}

/** Why new feedback waits, in plain words for Settings → Your feedback (ticket SAB-66), by why a pass skipped. */
export const WAIT_WORDS = {
  quota: "Waiting: paused while Claude is busy. Checked every 5 minutes.",
  login: "Waiting: the feedback job needs a fresh Claude login.",
};

/**
 * The feedback job's note on every new feedback (ticket SAB-66): why it waits and when it last looked; with no
 * reason, the note cleared (only on rows that have one).
 */
export function waitSql(reason, now = Date.now()) {
  if (reason === null)
    return "update feedback set waiting = null where status = 'new' and waiting is not null";
  return `update feedback set waiting = ${sqlText(reason)}, checked_at = ${Math.trunc(now)} where status = 'new'`;
}
