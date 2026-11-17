import { and, eq, inArray } from "drizzle-orm";
import { drizzle } from "drizzle-orm/d1";
import { type Reminder, reminderSubject, remindersOfCurrent, reminderText, timeIn, todayIn } from "../money";
import * as schema from "./db/schema";
import { pushSubscription, reminderSent, settings } from "./db/schema";
import { currentData } from "./first-use";
import { type PushSecrets, vapidOf } from "./push/vapid";
import { type PushMessage, sendPush } from "./push/web-push";
import type { SignedIn } from "./user-check";

type Fetch = (input: string, init: RequestInit) => Promise<Response>;

/**
 * Pushes per run at most (spec 12). A push costs about 0.8 ms CPU (encrypting and
 * signing, measured 2026-11-17) and the free plan allows 10 ms per run, with the
 * database reads and money rules on top. Pushes past it are skipped (counted in
 * `skipped`); with one or two people on the app it is never reached.
 */
export const MAX_PUSHES_PER_RUN = 8;

export interface CronResult {
  /** Users whose morning or nudge time it was. */
  users: number;
  /** Pushes sent (each device counts). */
  pushes: number;
  /** Devices removed after a 404 or 410. */
  gone: number;
  /** Pushes the push service refused for another reason. */
  failed: number;
  /** Pushes not sent: the run's limit was reached. */
  skipped: number;
}

/**
 * The reminder cron (item 26, spec 12): runs every 15 minutes. For each user with a
 * device that has alerts on and whose morning or nudge time it is in their home time
 * zone, it works out today's reminders with the money rules (the same as Today's
 * list) and sends one notification to every device: the morning summary (reminders
 * 1–5 together, nothing due means none) or the spend nudge. What was sent is recorded:
 * each notification once a day, a bill's "due soon" once.
 */
export async function sendReminders(
  env: Pick<Env, "DB" | "APP_URL"> & PushSecrets,
  at: number,
  fetcher?: Fetch,
  maxPushes = MAX_PUSHES_PER_RUN,
): Promise<CronResult> {
  const result: CronResult = { users: 0, pushes: 0, gone: 0, failed: 0, skipped: 0 };
  const vapid = vapidOf(env);
  if (!vapid) return result;
  const db = drizzle(env.DB, { schema });
  // Only users with a device that has alerts on.
  const people = await db
    .select({
      userId: settings.userId,
      homeTimeZone: settings.homeTimeZone,
      morningAt: settings.morningAt,
      nudgeAt: settings.nudgeAt,
    })
    .from(settings)
    .where(
      inArray(settings.userId, db.selectDistinct({ id: pushSubscription.userId }).from(pushSubscription)),
    );

  for (const person of people) {
    const time = timeIn(person.homeTimeZone, at);
    const morning = time === person.morningAt;
    const nudge = time === person.nudgeAt;
    if (!morning && !nudge) continue;
    result.users++;
    const userId = person.userId;
    const mine: SignedIn["Variables"]["mine"] = (table) => eq(table.userId, userId);
    const c = { var: { db, mine, userId, user: { id: userId, name: "", email: "" } } };
    const data = await currentData(c);
    if (!data.settings || !data.cycle) continue;
    const today = todayIn(person.homeTimeZone, at);
    const list = remindersOfCurrent({ ...data, settings: data.settings, cycle: data.cycle }, today, time);

    const sentToday = await db.query.reminderSent.findMany({
      where: and(mine(reminderSent), eq(reminderSent.sentOn, today)),
      columns: { kind: true },
    });
    const already = new Set(sentToday.map((r) => r.kind));
    const messages: { message: PushMessage; records: Reminder[]; kind: "morning" | "spend_nudge" }[] = [];

    if (morning && !already.has("morning")) {
      let items = list.filter((r) => r.kind !== "spend_nudge");
      // A bill's "due soon" is sent once.
      const soonIds = items.flatMap((r) => (r.kind === "due_soon" ? [r.id] : []));
      if (soonIds.length > 0) {
        const done = await db.query.reminderSent.findMany({
          where: and(
            mine(reminderSent),
            eq(reminderSent.kind, "due_soon"),
            inArray(reminderSent.subjectId, soonIds),
          ),
          columns: { subjectId: true },
        });
        const sent = new Set(done.map((r) => r.subjectId));
        items = items.filter((r) => r.kind !== "due_soon" || !sent.has(r.id));
      }
      if (items.length > 0) {
        messages.push({ kind: "morning", records: items, message: morningMessage(items) });
      }
    }
    if (nudge && !already.has("spend_nudge")) {
      const n = list.find((r) => r.kind === "spend_nudge");
      if (n)
        messages.push({ kind: "spend_nudge", records: [], message: { ...TITLE, body: reminderText(n) } });
    }
    if (messages.length === 0) continue;

    const devices = await db.query.pushSubscription.findMany({ where: mine(pushSubscription) });
    for (const { message, records, kind } of messages) {
      let delivered = false;
      for (const d of devices) {
        if (result.pushes >= maxPushes) {
          result.skipped++;
          continue;
        }
        result.pushes++;
        const status = await sendPush(d, message, vapid, fetcher).catch(() => 0);
        if (status >= 200 && status < 300) {
          delivered = true;
          await db
            .update(pushSubscription)
            .set({ lastOkAt: new Date(at) })
            .where(eq(pushSubscription.id, d.id));
        } else if (status === 404 || status === 410) {
          result.gone++;
          await db.delete(pushSubscription).where(eq(pushSubscription.id, d.id));
        } else {
          result.failed++;
        }
      }
      // Recorded only once a device took it, so a failed morning is tried again tomorrow.
      if (!delivered) continue;
      await db.insert(reminderSent).values([
        { id: crypto.randomUUID(), userId, kind, subjectId: null, sentOn: today },
        ...records.flatMap((r) =>
          r.kind === "due_soon" || r.kind === "running_out"
            ? [
                {
                  id: crypto.randomUUID(),
                  userId,
                  kind: r.kind,
                  subjectId: reminderSubject(r),
                  sentOn: today,
                },
              ]
            : [],
        ),
      ]);
    }
  }
  return result;
}

const TITLE = { title: "Setaside", url: "/" } as const;

/** The morning summary (spec 12): reminders 1–5 together; tapping it opens Today. */
export function morningMessage(items: Reminder[]): PushMessage {
  return { ...TITLE, body: items.map(reminderText).join(" · ") };
}
