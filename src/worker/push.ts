import { and, count, eq } from "drizzle-orm";
import { Hono } from "hono";
import * as z from "zod";
import { pushSubscription } from "./db/schema";
import { json } from "./json";
import { vapidOf } from "./push/vapid";
import type { SignedIn } from "./user-check";

/** Devices with alerts on, per user: keeps one user from filling a cron run (8 pushes). */
export const MAX_DEVICES = 5;

/**
 * The browsers' push services. The cron POSTs to the saved address, so only these
 * hosts are taken: the Worker never sends to an address of the user's choosing.
 */
const PUSH_HOSTS = ["fcm.googleapis.com", "updates.push.services.mozilla.com", "web.push.apple.com"];
const PUSH_HOST_ENDINGS = [".push.apple.com", ".notify.windows.com"];

export function isPushService(endpoint: string): boolean {
  let url: URL;
  try {
    url = new URL(endpoint);
  } catch {
    return false;
  }
  if (url.protocol !== "https:" || url.port !== "" || url.username || url.password) return false;
  const host = url.hostname;
  return PUSH_HOSTS.includes(host) || PUSH_HOST_ENDINGS.some((end) => host.endsWith(end));
}

const subscriptionBody = z.object({
  endpoint: z.string().max(2000).refine(isPushService),
  p256dh: z.string().regex(/^[A-Za-z0-9_-]{80,100}$/),
  auth: z.string().regex(/^[A-Za-z0-9_-]{16,32}$/),
});

/**
 * Phone alerts per device (item 26, spec 12): the key a phone subscribes with, and
 * its push subscription saved or removed. The cron sends the reminders.
 */
export const push = new Hono<SignedIn>()
  /** The Worker's VAPID public key; null when phone alerts are not set up on this server. */
  .get("/push/key", (c) => c.json({ publicKey: vapidOf(c.env)?.publicKey ?? null }))
  /** Turn on reminders on this device: saves (or refreshes) its subscription. */
  .post("/push-subscriptions", json(subscriptionBody), async (c) => {
    const { db, mine, userId } = c.var;
    const b = c.req.valid("json");
    const found = await db.query.pushSubscription.findFirst({
      where: eq(pushSubscription.endpoint, b.endpoint),
      columns: { id: true, userId: true },
    });
    // Another user's device: left alone (signing out turns alerts off, so this is rare).
    if (found && found.userId !== userId) return c.json({ error: "in_use" as const }, 409);
    if (found) {
      await db
        .update(pushSubscription)
        .set({ p256dh: b.p256dh, auth: b.auth })
        .where(eq(pushSubscription.id, found.id));
      return c.json({ ok: true as const }, 200);
    }
    const [had] = await db.select({ n: count() }).from(pushSubscription).where(mine(pushSubscription));
    if ((had?.n ?? 0) >= MAX_DEVICES) return c.json({ error: "too_many_devices" as const }, 409);
    await db.insert(pushSubscription).values({ id: crypto.randomUUID(), userId, ...b });
    return c.json({ ok: true as const }, 201);
  })
  /** Turn off reminders on this device (and on signing out). */
  .post("/push-subscriptions/remove", json(z.object({ endpoint: z.string().max(2000) })), async (c) => {
    const { db, mine } = c.var;
    const { endpoint } = c.req.valid("json");
    await db
      .delete(pushSubscription)
      .where(and(mine(pushSubscription), eq(pushSubscription.endpoint, endpoint)));
    return c.json({ ok: true as const }, 200);
  })
  /** Sign out everywhere: alerts go off on every device of the user. */
  .post("/push-subscriptions/remove-all", async (c) => {
    const { db, mine } = c.var;
    await db.delete(pushSubscription).where(mine(pushSubscription));
    return c.json({ ok: true as const }, 200);
  });
