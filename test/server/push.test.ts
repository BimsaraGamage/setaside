import { env } from "cloudflare:workers";
import { describe, expect, it } from "vitest";
import { MAX_PUSHES_PER_RUN, sendReminders } from "../../src/worker/reminders-cron";
import { call } from "./helpers";
import { decrypt, RFC } from "./push-phone";

// Item 26 · Phone notifications (spec 12): devices with alerts on, and the reminder cron.

const TZ = "Asia/Colombo"; // UTC+5:30
/** 08:00 in Colombo on Fri 20 Nov 2026: the morning summary's default time. */
const MORNING = Date.UTC(2026, 10, 20, 2, 30);
/** 21:00 in Colombo the same day: the spend nudge's default time. */
const EVENING = Date.UTC(2026, 10, 20, 15, 30);
const DAY = 24 * 3600 * 1000;

/** A user of its own, signed in. */
async function freshUser() {
  const name = crypto.randomUUID().slice(0, 12);
  const res = await call("/api/auth/demo/sign-in", { method: "POST", body: JSON.stringify({ fresh: name }) });
  expect(res.status).toBe(200);
  const cookie = res.headers
    .getSetCookie()
    .map((c) => c.split(";")[0])
    .join("; ");
  const { user } = await res.json<{ user: { id: string } }>();
  return { cookie, id: user.id };
}

/** A device's subscription; the RFC's keys, so the test can read what was sent. */
const device = (n = crypto.randomUUID()) => ({
  endpoint: `https://fcm.googleapis.com/fcm/send/${n}`,
  p256dh: RFC.uaPublic,
  auth: RFC.auth,
});

const subscribe = (cookie: string, body: unknown) =>
  call("/api/push-subscriptions", { method: "POST", body: JSON.stringify(body) }, cookie);

const devices = async (userId: string) =>
  (
    await env.DB.prepare("select endpoint from push_subscription where user_id = ? order by endpoint")
      .bind(userId)
      .all<{ endpoint: string }>()
  ).results.map((r) => r.endpoint);

/**
 * A user in their second cycle (salary entered) with Rent due today and the phone
 * bill in 2 days, on Fri 20 Nov, and one device with alerts on.
 */
async function cycleWithBills(more: { spendToday?: boolean; settings?: string } = {}) {
  const u = await freshUser();
  const s = crypto.randomUUID();
  const c = crypto.randomUUID();
  const now = Date.now();
  await env.DB.batch([
    env.DB.prepare(
      `insert into settings (id, user_id, salary_currency, spending_currency, home_time_zone, usual_pay_day, created_at, updated_at) values (?, ?, 'LKR', 'LKR', '${TZ}', 25, ?, ?)`,
    ).bind(s, u.id, now, now),
    env.DB.prepare(
      "insert into cycle (id, user_id, started_on, expected_salary_on, created_at, updated_at) values (?, ?, '2026-11-10', '2026-12-10', ?, ?)",
    ).bind(c, u.id, now, now),
    env.DB.prepare(
      "insert into income (id, user_id, cycle_id, kind, currency, amount_minor, received_on, created_at, updated_at) values (?, ?, ?, 'salary', 'LKR', 30000000, '2026-11-10', ?, ?)",
    ).bind(crypto.randomUUID(), u.id, c, now, now),
    env.DB.prepare(
      "insert into commitment (id, user_id, cycle_id, name, kind, currency, planned_minor, due_on, state, created_at, updated_at) values (?, ?, ?, 'Rent', 'bill', 'LKR', 5000000, '2026-11-20', 'open', ?, ?)",
    ).bind(crypto.randomUUID(), u.id, c, now, now),
    env.DB.prepare(
      "insert into commitment (id, user_id, cycle_id, name, kind, currency, planned_minor, due_on, state, created_at, updated_at) values (?, ?, ?, 'Phone', 'bill', 'LKR', 300000, '2026-11-22', 'open', ?, ?)",
    ).bind(crypto.randomUUID(), u.id, c, now, now),
  ]);
  if (more.spendToday) {
    await env.DB.prepare(
      "insert into spend (id, user_id, cycle_id, spent_on, amount_minor, currency, created_at, updated_at) values (?, ?, ?, '2026-11-20', 50000, 'LKR', ?, ?)",
    )
      .bind(crypto.randomUUID(), u.id, c, now, now)
      .run();
  }
  if (more.settings) await env.DB.prepare(`update settings set ${more.settings} where id = ?`).bind(s).run();
  // Only this test's user has devices: the cron sends to everyone whose time it is.
  await env.DB.prepare("delete from push_subscription").run();
  const d = device();
  expect((await subscribe(u.cookie, d)).status).toBe(201);
  return { ...u, device: d };
}

/** A push service that answers `status` and keeps what it was sent. */
function pushService(status = 201) {
  const sent: { endpoint: string; message: { title: string; body: string; url: string } }[] = [];
  const fetcher = async (input: string, init: RequestInit) => {
    const body = new Uint8Array(init.body as Uint8Array);
    sent.push({
      endpoint: input,
      message: JSON.parse(await decrypt(body, RFC.uaPublic, RFC.uaPrivate, RFC.auth)),
    });
    return new Response(null, { status });
  };
  return { sent, fetcher };
}

/** Pushes to one user's device (other test users may be due at the same time). */
const to = (sent: ReturnType<typeof pushService>["sent"], d: { endpoint: string }) =>
  sent.filter((s) => s.endpoint === d.endpoint);

describe("turn on reminders on a device (item 26, spec 12)", () => {
  it("gives the key the phone subscribes with", async () => {
    const { cookie } = await freshUser();
    const res = await call("/api/push/key", {}, cookie);
    expect(await res.json()).toEqual({ publicKey: env.VAPID_PUBLIC_KEY });
  });

  it("saves the device once, refreshes its keys, and removes it when turned off", async () => {
    const u = await freshUser();
    const d = device();
    expect((await subscribe(u.cookie, d)).status).toBe(201);
    expect((await subscribe(u.cookie, { ...d, auth: "AAAAAAAAAAAAAAAAAAAAAA" })).status).toBe(200);
    const row = await env.DB.prepare("select auth from push_subscription where endpoint = ?")
      .bind(d.endpoint)
      .first<{ auth: string }>();
    expect(row?.auth).toBe("AAAAAAAAAAAAAAAAAAAAAA");
    const other = device();
    await subscribe(u.cookie, other);
    expect(await devices(u.id)).toEqual([d.endpoint, other.endpoint].sort());
    const off = await call(
      "/api/push-subscriptions/remove",
      { method: "POST", body: JSON.stringify({ endpoint: d.endpoint }) },
      u.cookie,
    );
    expect(off.status).toBe(200);
    expect(await devices(u.id)).toEqual([other.endpoint]);
  });

  it("leaves another user's device alone", async () => {
    const a = await freshUser();
    const b = await freshUser();
    const d = device();
    await subscribe(a.cookie, d);
    expect((await subscribe(b.cookie, d)).status).toBe(409);
    await call("/api/push-subscriptions/remove", { method: "POST", body: JSON.stringify(d) }, b.cookie);
    expect(await devices(a.id)).toEqual([d.endpoint]);
    expect(await devices(b.id)).toEqual([]);
  });

  it("takes at most 5 devices per user, and sign out everywhere removes them all", async () => {
    const u = await freshUser();
    for (let i = 0; i < 5; i++) expect((await subscribe(u.cookie, device())).status).toBe(201);
    const sixth = await subscribe(u.cookie, device());
    expect(sixth.status).toBe(409);
    expect(await sixth.json()).toEqual({ error: "too_many_devices" });
    const all = await call("/api/push-subscriptions/remove-all", { method: "POST" }, u.cookie);
    expect(all.status).toBe(200);
    expect(await devices(u.id)).toEqual([]);
  });

  it("takes only a browser push service address and real keys", async () => {
    const { cookie } = await freshUser();
    for (const bad of [
      { ...device(), endpoint: "http://fcm.googleapis.com/fcm/send/x" },
      { ...device(), endpoint: "https://evil.example/fcm.googleapis.com" },
      { ...device(), endpoint: "https://fcm.googleapis.com.evil.example/x" },
      { ...device(), endpoint: "https://fcm.googleapis.com:8443/x" },
      { ...device(), p256dh: "short" },
      { ...device(), auth: "" },
    ]) {
      expect((await subscribe(cookie, bad)).status).toBe(400);
    }
  });
});

describe("the reminder cron (item 26, spec 12)", () => {
  it("sends the morning summary at the user's morning time, to every device, opening Today", async () => {
    const u = await cycleWithBills();
    const second = device();
    await subscribe(u.cookie, second);
    const svc = pushService();
    const r = await sendReminders(env, MORNING, svc.fetcher);
    expect(r.users).toBeGreaterThanOrEqual(1);
    const mine = [...to(svc.sent, u.device), ...to(svc.sent, second)];
    expect(mine).toHaveLength(2);
    expect(mine[0]?.message).toEqual({
      title: "Setaside",
      url: "/",
      body: expect.stringContaining("Rent due today · Rs 50,000 · Phone in 2 days · Rs 3,000"),
    });
  });

  it("sends nothing at other times, and sends in the first cycle (no salary yet) too", async () => {
    const u = await cycleWithBills();
    const svc = pushService();
    await sendReminders(env, MORNING + 15 * 60 * 1000, svc.fetcher);
    expect(to(svc.sent, u.device)).toEqual([]);
    await env.DB.prepare("update income set kind = 'opening' where user_id = ?").bind(u.id).run();
    await sendReminders(env, MORNING, svc.fetcher);
    expect(to(svc.sent, u.device)[0]?.message.body).toContain("Rent due today");
  });

  it("follows the user's own morning time and switches", async () => {
    const u = await cycleWithBills({ settings: "morning_at = '07:15', remind_due_soon = 0" });
    const svc = pushService();
    await sendReminders(env, MORNING, svc.fetcher);
    expect(to(svc.sent, u.device)).toEqual([]);
    await sendReminders(env, MORNING - 45 * 60 * 1000, svc.fetcher);
    const [push] = to(svc.sent, u.device);
    expect(push?.message.body).toContain("Rent due today");
    expect(push?.message.body).not.toContain("Phone");
  });

  it("sends the morning summary once a day and a bill's due soon once", async () => {
    const u = await cycleWithBills();
    const svc = pushService();
    await sendReminders(env, MORNING, svc.fetcher);
    await sendReminders(env, MORNING, svc.fetcher);
    expect(to(svc.sent, u.device)).toHaveLength(1);
    // Next morning: Rent is a day late (repeats), the phone bill's due soon was sent already.
    await sendReminders(env, MORNING + DAY, svc.fetcher);
    const next = to(svc.sent, u.device)[1];
    expect(next?.message.body).toContain("Rent 1 day late");
    expect(next?.message.body).not.toContain("Phone");
  });

  it("sends the spend nudge at its time on a day with no spend", async () => {
    const u = await cycleWithBills();
    const svc = pushService();
    await sendReminders(env, EVENING, svc.fetcher);
    await sendReminders(env, EVENING, svc.fetcher);
    expect(to(svc.sent, u.device).map((s) => s.message.body)).toEqual(["Any spends today? Add them with +"]);
    const spent = await cycleWithBills({ spendToday: true });
    await sendReminders(env, EVENING, svc.fetcher);
    expect(to(svc.sent, spent.device)).toEqual([]);
  });

  it("removes a device the push service says is gone, and tries again tomorrow", async () => {
    const u = await cycleWithBills();
    const gone = pushService(410);
    const r = await sendReminders(env, MORNING, gone.fetcher);
    expect(r.gone).toBeGreaterThanOrEqual(1);
    expect(await devices(u.id)).toEqual([]);
    const sent = await env.DB.prepare("select count(*) as n from reminder_sent where user_id = ?")
      .bind(u.id)
      .first<{ n: number }>();
    expect(sent?.n).toBe(0);
  });

  it("keeps a device on a refused push and records when one was taken", async () => {
    const u = await cycleWithBills();
    await sendReminders(env, MORNING, pushService(500).fetcher);
    expect(await devices(u.id)).toEqual([u.device.endpoint]);
    await sendReminders(env, MORNING, pushService(201).fetcher);
    const row = await env.DB.prepare("select last_ok_at from push_subscription where user_id = ?")
      .bind(u.id)
      .first<{ last_ok_at: number }>();
    expect(row?.last_ok_at).toBe(MORNING);
  });

  it("sends nothing without the VAPID keys", async () => {
    const svc = pushService();
    const r = await sendReminders({ DB: env.DB, APP_URL: env.APP_URL }, MORNING, svc.fetcher);
    expect(r).toEqual({ users: 0, pushes: 0, gone: 0, failed: 0, skipped: 0 });
    expect(svc.sent).toEqual([]);
  });

  it("stops at the run's push limit, kept under the 10 ms CPU limit", async () => {
    expect(MAX_PUSHES_PER_RUN * 0.8).toBeLessThan(10);
    const u = await cycleWithBills();
    await subscribe(u.cookie, device());
    await subscribe(u.cookie, device());
    const svc = pushService();
    const r = await sendReminders(env, MORNING, svc.fetcher, 2);
    expect(r).toMatchObject({ pushes: 2, skipped: 1 });
    expect(svc.sent).toHaveLength(2);
  });
});
